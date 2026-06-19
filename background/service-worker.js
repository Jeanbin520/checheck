import { getSites, updateSiteStatus, getConfig, saveConfig } from '../lib/storage.js';
import { getAdapterForSite } from '../adapters/registry.js';

const LOG_KEY = 'logs';
const MAX_LOGS = 200;
const ALARM_NAME = 'dailyCheckin';
const DAY_IN_MINUTES = 24 * 60;
const LDC_CREDIT_KEY = 'ldcCredit';
const LDC_CREDIT_HOME_URL = 'https://credit.linux.do/home';

// 防止定时签到与手动签到并发（单次签到可能耗时较长）
let scheduledRunInProgress = false;

async function log(level, message) {
  const ts = new Date().toLocaleTimeString('zh-CN');
  const entry = { ts, level, message };
  console.log(`[签到助手] [${level}] ${message}`);

  try {
    const result = await chrome.storage.local.get(LOG_KEY);
    const logs = result[LOG_KEY] || [];
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    await chrome.storage.local.set({ [LOG_KEY]: logs });
  } catch {}
}

console.log('[签到助手] Service Worker 已加载');

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// 根据 config 重建每日定时签到闹钟。MV3 闹钟在浏览器重启后可能失效，
// 因此在 onInstalled / onStartup 以及用户改设置后都调用一次。
async function scheduleAlarm() {
  const config = await getConfig();
  if (!config.scheduleEnabled) {
    await chrome.alarms.clear(ALARM_NAME);
    log('info', '定时签到已关闭，闹钟已清除');
    return;
  }

  // 计算 scheduleTime ("HH:MM") 距离当前的分钟数；已过则顺延到明天
  const [h, m] = String(config.scheduleTime || '09:00').split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h || 0, m || 0, 0, 0);
  let delayMs = target.getTime() - now.getTime();
  if (delayMs <= 0) delayMs += DAY_IN_MINUTES * 60 * 1000;
  const delayInMinutes = Math.max(1, Math.round(delayMs / 60000));

  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes,
    periodInMinutes: DAY_IN_MINUTES
  });
  log('info', `定时签到已启用：每日 ${config.scheduleTime}，约 ${delayInMinutes} 分钟后首次执行`);
}

// 签到完成后的桌面通知
function notifyResults(results) {
  const total = results.length;
  const ok = results.filter(r => r && r.success).length;
  const fail = total - ok;
  const title = fail === 0 ? '✅ 定时签到完成' : (ok === 0 ? '❌ 定时签到失败' : '⚠️ 定时签到部分完成');
  const message = `共 ${total} 个站点：成功 ${ok}，失败 ${fail}`;
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message
    });
  } catch (err) {
    log('error', `发送通知失败: ${err.message}`);
  }
}

// 闹钟触发：后台静默执行全部签到
chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm || alarm.name !== ALARM_NAME) return;
  if (scheduledRunInProgress) {
    log('warn', '定时签到触发，但上一次签到仍在进行，跳过本次');
    return;
  }
  scheduledRunInProgress = true;
  log('info', '⏰ 定时签到触发，开始执行...');
  handleCheckinAll({ silent: true })
    .then(results => {
      log('info', `定时签到完成，共 ${results.length} 个站点`);
      if (results.length > 0) notifyResults(results);
      // 记录本次执行时间，便于排查
      return saveConfig({ lastScheduledRun: Date.now() });
    })
    .catch(err => {
      log('error', `定时签到异常: ${err.message}`);
    })
    .finally(() => {
      scheduledRunInProgress = false;
    });
});

// 浏览器启动 / 扩展安装更新时重建闹钟
chrome.runtime.onInstalled.addListener(() => { scheduleAlarm(); });
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  console.log('[签到助手] 收到消息:', message.action, message);

  if (message.action === 'checkinAll') {
    log('info', '开始全部签到...');
    handleCheckinAll()
      .then(results => {
        log('info', `签到完成，共 ${results.length} 个站点`);
        sendResponse(results);
      })
      .catch(err => {
        log('error', `签到异常: ${err.message}`);
        sendResponse([{ success: false, message: '签到异常: ' + err.message }]);
      });
    return true;
  }
  if (message.action === 'checkinSingle') {
    handleCheckinSingle(message.siteId)
      .then(sendResponse)
      .catch(err => {
        log('error', `单站点签到异常: ${err.message}`);
        sendResponse({ success: false, message: err.message });
      });
    return true;
  }
  if (message.action === 'updateSchedule') {
    // popup 改完定时设置后通知后台立即重同步闹钟
    scheduleAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, message: err.message }));
    return true;
  }
  if (message.action === 'refreshLdcCredit') {
    refreshLdcCredit()
      .then(sendResponse)
      .catch(async err => {
        const result = {
          ok: false,
          status: 'error',
          message: `读取 LDC 失败: ${err.message}`,
          updatedAt: Date.now()
        };
        await chrome.storage.local.set({ [LDC_CREDIT_KEY]: result });
        sendResponse(result);
      });
    return true;
  }
  if (message.action === 'openLdcCredit') {
    openLdcCreditPage()
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, message: err.message }));
    return true;
  }
  if (message.action === 'detectedCheckin') {
    chrome.storage.session.set({
      [`detected:${message.url}`]: {
        url: message.url,
        title: message.title,
        detectedAt: Date.now()
      }
    });
  }
  if (message.action === 'clearLogs') {
    chrome.storage.local.set({ [LOG_KEY]: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.action === 'getLogs') {
    chrome.storage.local.get(LOG_KEY).then(r => sendResponse(r[LOG_KEY] || []));
    return true;
  }
});

async function findLdcCreditTab() {
  const tabs = await chrome.tabs.query({ url: ['https://credit.linux.do/*'] });
  return tabs.find(tab => tab.id && tab.url && !tab.url.includes('/cdn-cgi/')) || tabs[0] || null;
}

async function focusTab(tab) {
  if (!tab || !tab.id) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  }
}

async function openLdcCreditPage() {
  let tab = await findLdcCreditTab();
  if (tab?.id) {
    tab = await chrome.tabs.update(tab.id, { url: LDC_CREDIT_HOME_URL, active: true });
    await focusTab(tab);
    return { ok: true, message: '已打开 LDC 页面', url: tab.url || LDC_CREDIT_HOME_URL };
  }

  tab = await chrome.tabs.create({ url: LDC_CREDIT_HOME_URL, active: true });
  return { ok: true, message: '已打开 LDC 页面', url: tab.url || LDC_CREDIT_HOME_URL };
}

function waitForTabLoadQuiet(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    let stableTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (stableTimer) clearTimeout(stableTimer);
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const timer = setTimeout(finish, timeout);

    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading' && stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
      if (info.status === 'complete') {
        if (stableTimer) clearTimeout(stableTimer);
        stableTimer = setTimeout(finish, 1200);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId)
      .then(tab => {
        if (tab.status === 'complete') {
          stableTimer = setTimeout(finish, 800);
        }
      })
      .catch(finish);
  });
}

async function refreshLdcCredit() {
  let tab = await findLdcCreditTab();
  let createdTab = false;

  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: LDC_CREDIT_HOME_URL, active: false });
    createdTab = true;
  } else if (!tab.url || !tab.url.includes('/home')) {
    tab = await chrome.tabs.update(tab.id, { url: LDC_CREDIT_HOME_URL, active: false });
  }

  await waitForTabLoadQuiet(tab.id, 35000);
  await new Promise(resolve => setTimeout(resolve, 2000));

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeLdcCreditPage
  });

  const currentTab = await chrome.tabs.get(tab.id).catch(() => tab);
  const result = {
    ...(results?.[0]?.result || {
      ok: false,
      status: 'no-response',
      message: 'LDC 页面没有返回可读取结果'
    }),
    url: currentTab?.url || tab.url || LDC_CREDIT_HOME_URL,
    updatedAt: Date.now()
  };

  await chrome.storage.local.set({ [LDC_CREDIT_KEY]: result });

  if (result.ok && createdTab) {
    try { await chrome.tabs.remove(tab.id); } catch {}
  }

  if (!result.ok && currentTab?.id) {
    await focusTab(currentTab);
  }

  return result;
}

function scrapeLdcCreditPage() {
  const url = location.href;
  const title = document.title || '';
  const body = document.body;
  const bodyText = (body?.innerText || '').replace(/\r/g, '').trim();
  const lowerText = bodyText.toLowerCase();
  const lowerTitle = title.toLowerCase();

  if (
    lowerTitle.includes('just a moment') ||
    lowerText.includes('enable javascript and cookies') ||
    lowerText.includes('checking your browser') ||
    lowerText.includes('checking if the site connection is secure')
  ) {
    return {
      ok: false,
      status: 'cloudflare',
      message: '需要先在 LDC 页面完成 Cloudflare 验证'
    };
  }

  if (
    location.pathname.includes('/login') ||
    (/(sign in|login|登录|登入)/i.test(bodyText) && /(linux|oauth|callbackurl)/i.test(bodyText + url))
  ) {
    return {
      ok: false,
      status: 'login-required',
      message: '需要先登录 credit.linux.do'
    };
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0.05;
  }

  function textOf(element) {
    return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function compact(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, '').replace(/[：:]/g, '');
  }

  function containsAnyLabel(text, labels) {
    const lower = String(text || '').toLowerCase();
    const compactText = compact(text);
    return labels.some(label => lower.includes(label.toLowerCase()) || compactText.includes(compact(label)));
  }

  function extractNumbers(text, ignorePlainSeven) {
    const matches = String(text || '').match(/[+-]?\d[\d,]*(?:\.\d+)?/g) || [];
    return matches
      .map(value => value.trim())
      .filter(value => {
        if (!ignorePlainSeven) return true;
        return value.replace(/[,+]/g, '') !== '7';
      });
  }

  function numberAfterLabel(text, labels, ignorePlainSeven) {
    const lower = String(text || '').toLowerCase();
    for (const label of labels) {
      const index = lower.indexOf(label.toLowerCase());
      if (index < 0) continue;
      const after = String(text).slice(index + label.length, index + label.length + 100);
      const values = extractNumbers(after, ignorePlainSeven);
      if (values.length) return values[0];
    }
    return '';
  }

  function metricFromElement(element, labels, ignorePlainSeven) {
    const candidates = [];
    const ownText = textOf(element);
    if (ownText) candidates.push({ text: ownText, labelText: true });

    for (const sibling of [element.nextElementSibling, element.previousElementSibling]) {
      const siblingText = textOf(sibling);
      if (siblingText && siblingText.length <= 120) {
        candidates.push({ text: siblingText, labelText: false });
      }
    }

    let parent = element.parentElement;
    for (let depth = 0; depth < 3 && parent; depth++) {
      const parentText = textOf(parent);
      if (parentText && parentText.length <= 260) {
        candidates.push({ text: parentText, labelText: true });
      }
      parent = parent.parentElement;
    }

    for (const candidate of candidates) {
      if (candidate.labelText) {
        const after = numberAfterLabel(candidate.text, labels, ignorePlainSeven);
        if (after) return after;
      }
      const cleaned = labels.reduce(
        (text, label) => text.split(label).join(' '),
        candidate.text.replace(/7\s*天/g, ' ').replace(/7\s*day[s]?/gi, ' ')
      );
      const values = extractNumbers(cleaned, ignorePlainSeven);
      if (values.length) return values[0];
    }

    return '';
  }

  function fallbackMetric(patterns, ignorePlainSeven) {
    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return '';
  }

  function findMetric(labels, fallbackPatterns, ignorePlainSeven = false) {
    const elements = Array.from(document.querySelectorAll('body *'))
      .filter(element => isVisible(element))
      .filter(element => {
        const text = textOf(element);
        return text && text.length <= 180 && containsAnyLabel(text, labels);
      });

    for (const element of elements) {
      const value = metricFromElement(element, labels, ignorePlainSeven);
      if (value) return value;
    }

    return fallbackMetric(fallbackPatterns, ignorePlainSeven);
  }

  function hasTodayDate(text) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const normalized = String(text || '').replace(/\s+/g, '');
    const patterns = [
      new RegExp(`${year}[-/.年]0?${month}[-/.月]0?${day}日?`),
      new RegExp(`0?${month}[-/月]0?${day}日?`)
    ];
    return patterns.some(pattern => pattern.test(normalized));
  }

  function dateLikeCount(text) {
    const matches = String(text || '').match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/月]\d{1,2}日?/g);
    return matches ? matches.length : 0;
  }

  function removeDateText(text) {
    return String(text || '')
      .replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, ' ')
      .replace(/\d{1,2}[-/月]\d{1,2}日?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function incomeFromSevenDayRowText(text) {
    const withoutDate = removeDateText(text)
      .replace(/七天统计收入|七天收入统计|7\s*天统计收入|7\s*天收入统计|7-day\s*income\s*statistics/gi, ' ')
      .replace(/日期|收入|credits?|ldc|linux\s*do/gi, ' ');
    const values = extractNumbers(withoutDate, false);
    return values[0] || '';
  }

  function findSevenDayTodayIncome() {
    const sectionLabels = [
      '7天收入统计',
      '7 天收入统计',
      '七天收入统计',
      '七天统计收入',
      '7 天统计收入',
      '7天统计收入',
      '7-day income statistics'
    ];
    const visibleElements = Array.from(document.querySelectorAll('body *')).filter(isVisible);
    const sectionAnchors = visibleElements.filter(element => {
      const text = textOf(element);
      return text && containsAnyLabel(text, sectionLabels);
    });
    const containers = [];

    for (const anchor of sectionAnchors) {
      let current = anchor;
      for (let depth = 0; depth < 6 && current; depth++) {
        const text = textOf(current);
        if (text && text.length <= 3000 && hasTodayDate(text)) {
          containers.push(current);
        }
        current = current.parentElement;
      }
    }

    if (containers.length === 0) {
      containers.push(document.body);
    }

    const selectors = [
      'tr',
      '[role="row"]',
      'li',
      '[class*="row"]',
      '[class*="item"]',
      '[class*="card"]',
      'div',
      'p',
      'span'
    ].join(',');

    for (const container of containers) {
      const candidates = Array.from(container.querySelectorAll(selectors))
        .filter(isVisible)
        .map(element => textOf(element))
        .filter(text => text && text.length <= 260 && hasTodayDate(text) && dateLikeCount(text) <= 1);

      for (const text of candidates) {
        const value = incomeFromSevenDayRowText(text);
        if (value) return value;
      }

      const lines = textOf(container).split(/\n|(?=\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)|(?=\d{1,2}[-/月]\d{1,2}日?)/);
      for (const line of lines) {
        if (!hasTodayDate(line)) continue;
        const value = incomeFromSevenDayRowText(line);
        if (value) return value;
      }
    }

    return '';
  }

  const availableLdc = findMetric(
    [
      '可用 LINUX DO Credits',
      '可用LINUX DO Credits',
      '可用 LINUXDO Credits',
      '可用 Linux Do Credits',
      'Available LINUX DO Credits',
      'Available Linux Do Credits'
    ],
    [
      /可用\s*LINUX\s*DO\s*Credits[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /Available\s*LINUX\s*DO\s*Credits[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i
    ]
  );

  const sevenDayIncome = findMetric(
    [
      '7天收入统计',
      '7 天收入统计',
      '七天收入统计',
      '7 天收入',
      '7天收入',
      '七天收入',
      '近 7 天收入',
      '近7天收入',
      '7-day income',
      '7 day income'
    ],
    [
      /7\s*天收入统计[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /七天收入统计[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /7\s*天收入[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /七天收入[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /近\s*7\s*天收入[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /7[-\s]*day\s*income[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i
    ],
    true
  );

  const yesterdayIncome = findSevenDayTodayIncome() || findMetric(
    ['昨日收入', '昨天收入', 'Yesterday income', 'Previous day income'],
    [
      /昨日收入[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /昨天收入[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /Yesterday\s*income[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i,
      /Previous\s*day\s*income[^\d+-]{0,60}([+-]?\d[\d,]*(?:\.\d+)?)/i
    ]
  );

  if (availableLdc || sevenDayIncome || yesterdayIncome) {
    return {
      ok: true,
      status: 'ok',
      message: 'LDC 已刷新',
      availableLdc,
      sevenDayIncome,
      yesterdayIncome
    };
  }

  if (/立即开始|开始|start|get started/i.test(bodyText)) {
    return {
      ok: false,
      status: 'need-start',
      message: '请先在 LDC 页面点击立即开始'
    };
  }

  return {
    ok: false,
    status: 'no-data',
    message: '没有在页面上识别到可用 LINUX DO Credits、7 天收入和昨日收入'
  };
}

async function handleCheckinAll(options = {}) {
  const sites = await getSites();
  log('info', `共有 ${sites.length} 个站点`);

  if (sites.length === 0) {
    log('warn', '没有站点，请先添加');
    return [];
  }

  const results = [];

  for (const site of sites) {
    log('info', `正在签到: ${site.name} (${site.url})`);
    const result = await doCheckin(site, options);
    log(result.success ? 'info' : 'error', `${site.name}: ${result.message}`);
    results.push(result);
  }

  return results;
}

async function handleCheckinSingle(siteId) {
  const sites = await getSites();
  const site = sites.find(s => s.id === siteId);
  if (!site) return { success: false, message: '站点不存在' };
  return doCheckin(site);
}

async function doCheckin(site, options = {}) {
  log('info', `开始签到: ${site.name}`);
  const adapter = getAdapterForSite(site);
  if (!adapter) {
    log('warn', `无匹配适配器: ${site.url}`);
    const status = { success: false, message: '无匹配适配器' };
    await updateSiteStatus(site.id, status);
    return { site, ...status };
  }
  log('info', `使用适配器: ${adapter.name}`);

  if (adapter.getFlow) {
    return doFlowCheckin(site, adapter, options);
  }

  return doSimpleCheckin(site, adapter);
}

async function doFlowCheckin(site, adapter, options = {}) {
  const silent = !!options.silent;
  const flow = adapter.getFlow();
  log('info', `流程签到: ${site.name}, URL: ${flow.url}${silent ? '（后台静默）' : ''}`);

  let tab;
  let shouldCloseTab = true;
  try {
    // silent（定时触发）时后台打开，不打扰当前浏览；手动点击时前台显示
    tab = await chrome.tabs.create({ url: flow.url, active: !silent });
    log('info', `标签页已创建: ${tab.id}`);

    await waitForTabLoad(tab.id, 30000);
    log('info', '页面加载完成，等待2s...');
    await new Promise(r => setTimeout(r, 2000));

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      log('info', `执行步骤 ${i + 1}/${flow.steps.length}: ${step.type}`);

      if (step.type === 'checkUrl') {
        const currentTab = await chrome.tabs.get(tab.id);
        const url = currentTab.url || '';
        log('info', `当前URL: ${url}`);

        if (url.includes(flow.successPattern)) {
          log('info', '已在目标页面，签到成功');
          const config = await getConfig();
          if (config.closeDelay > 0) {
            log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
            await new Promise(r => setTimeout(r, config.closeDelay * 1000));
          }
          const status = { success: true, message: '已登录，自动签到成功' };
          await updateSiteStatus(site.id, status);
          return { site, ...status };
        }
        log('info', '需要登录，继续...');
        continue;
      }

      if (step.type === 'checkLoginAndSkip') {
        const currentTab = await chrome.tabs.get(tab.id);
        const url = currentTab.url || '';
        log('info', `检查登录状态，当前URL: ${url}`);

        if (url.includes(step.loginPattern)) {
          log('info', '已登录，跳过登录步骤，直接签到');
          continue;
        }

        if (url.includes('/login') || url.includes('/signin')) {
          log('info', '未登录，在登录页面，继续...');
          continue;
        }

        log('info', '页面状态未知，继续尝试登录...');
        continue;
      }

      if (step.type === 'linuxdoOAuth') {
        log('info', `${step.description}`);
        const currentTab = await chrome.tabs.get(tab.id);
        const url = currentTab.url || '';
        const shouldRun = (step.onlyIfUrlIncludes || []).some(pattern => url.includes(pattern));

        if (!shouldRun) {
          log('info', '当前不是登录页，跳过 LinuxDO 授权登录');
          continue;
        }

        let authUrl = '';
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (clientId) => {
              try {
                await fetch('/api/user/logout', { credentials: 'include' });
              } catch {}

              const stateResponse = await fetch('/api/oauth/state', { credentials: 'include' });
              const stateJson = await stateResponse.json();
              if (!stateJson.success || !stateJson.data) {
                return { success: false, message: stateJson.message || '获取 OAuth state 失败' };
              }

              const state = `${stateJson.data}|${btoa(window.location.host)}`;
              const authUrl = new URL('https://connect.linux.do/oauth2/authorize');
              authUrl.searchParams.set('response_type', 'code');
              authUrl.searchParams.set('client_id', clientId);
              authUrl.searchParams.set('state', state);
              return { success: true, authUrl: authUrl.toString() };
            },
            args: [step.clientId]
          });

          const result = results?.[0]?.result;
          if (!result?.success || !result.authUrl) {
            throw new Error(result?.message || '生成 LinuxDO 授权地址失败');
          }
          authUrl = result.authUrl;
        } catch (e) {
          throw new Error(`生成 LinuxDO 授权地址失败: ${e.message}`);
        }

        log('info', '已生成 LinuxDO 授权地址，正在跳转...');
        await chrome.tabs.update(tab.id, { url: authUrl });
        try {
          const nextUrl = await pollTabUrlAny(tab.id, ['connect.linux.do', '/oauth/linuxdo', '/console'], 30000);
          log('info', `LinuxDO 授权跳转后URL: ${nextUrl}`);
        } catch (e) {
          log('warn', `等待 LinuxDO 授权页超时，继续检查当前页面: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      if (step.type === 'click') {
        log('info', `查找按钮: ${step.description}`);

        if (step.onlyIfUrlIncludes) {
          const currentTab = await chrome.tabs.get(tab.id);
          const url = currentTab.url || '';
          const shouldRun = step.onlyIfUrlIncludes.some(pattern => url.includes(pattern));
          if (!shouldRun) {
            log('info', `当前不需要执行${step.description}，继续后续步骤`);
            continue;
          }
        }

        let newTabPromise = null;
        if (step.watchNewTab) {
          newTabPromise = new Promise((resolve) => {
            const listener = (newTab) => {
              chrome.tabs.onCreated.removeListener(listener);
              resolve(newTab);
            };
            chrome.tabs.onCreated.addListener(listener);
            setTimeout(() => {
              chrome.tabs.onCreated.removeListener(listener);
              resolve(null);
            }, step.newTabTimeout || 30000);
          });
        }

        let clickResult = null;
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (selector, matchTexts, exactMatchTexts, excludeTexts) => {
              const normalizedMatchTexts = (matchTexts || []).map(t => String(t).toLowerCase());
              const normalizedExactTexts = (exactMatchTexts || []).map(t => String(t).toLowerCase());
              const normalizedExcludeTexts = (excludeTexts || []).map(t => String(t).toLowerCase());
              const candidates = [];

              const isClickable = (el) => {
                if (!el || el.disabled || el.getAttribute?.('aria-disabled') === 'true') return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                  return false;
                }
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                if (centerX < 0 || centerY < 0 || centerX > window.innerWidth || centerY > window.innerHeight) return false;
                const topEl = document.elementFromPoint(centerX, centerY);
                return topEl === el || el.contains(topEl) || topEl?.contains(el);
              };

              const getCandidateText = (el, fallbackText = '') => [
                fallbackText,
                el.textContent || '',
                el.getAttribute?.('aria-label') || '',
                el.getAttribute?.('title') || '',
                el.getAttribute?.('data-provider') || '',
                el.getAttribute?.('data-testid') || '',
                el.value || '',
                el.href || ''
              ].join(' ').trim();

              for (const span of document.querySelectorAll('span')) {
                const target = span.closest('button') || span.closest('a') || span.parentElement;
                if (target) candidates.push({ el: target, text: getCandidateText(target, span.textContent || '') });
              }

              for (const el of document.querySelectorAll(selector)) {
                candidates.push({ el, text: getCandidateText(el) });
              }

              const seen = new Set();
              const uniqueCandidates = candidates.filter(({ el }) => {
                if (seen.has(el)) return false;
                seen.add(el);
                return true;
              });

              const isExcluded = (text) => normalizedExcludeTexts.some(t => text.includes(t));
              const clickCandidate = (candidate) => {
                const rect = candidate.el.getBoundingClientRect();
                candidate.el.scrollIntoView({ block: 'center', inline: 'center' });
                candidate.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                candidate.el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                candidate.el.click();
                return {
                  clicked: true,
                  text: candidate.text,
                  tag: candidate.el.tagName,
                  className: candidate.el.className,
                  href: candidate.el.href || '',
                  rect: { width: Math.round(rect.width), height: Math.round(rect.height) }
                };
              };

              for (const candidate of uniqueCandidates) {
                const text = candidate.text.toLowerCase();
                if (!text || isExcluded(text) || !isClickable(candidate.el)) continue;
                if (normalizedExactTexts.some(t => text === t)) {
                  return clickCandidate(candidate);
                }
              }

              for (const candidate of uniqueCandidates) {
                const text = candidate.text.toLowerCase();
                if (!text || isExcluded(text) || !isClickable(candidate.el)) continue;
                if (normalizedMatchTexts.some(t => text.includes(t))) {
                  return clickCandidate(candidate);
                }
              }

              return { clicked: false };
            },
            args: [step.selector, step.matchText, step.exactMatchText, step.excludeText]
          });
          clickResult = results?.[0]?.result;
        } catch (scriptErr) {
          log('warn', `脚本执行异常(可能页面已跳转): ${scriptErr.message}`);
        }

        log('info', `点击结果: ${JSON.stringify(clickResult)}`);

        if (clickResult && !clickResult.clicked) {
          if (step.completeText?.length) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (completeTexts) => {
                const normalizedCompleteTexts = (completeTexts || []).map(t => String(t).toLowerCase());
                const isVisible = (el) => {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
                    style.visibility !== 'hidden' && Number(style.opacity) !== 0;
                };
                for (const el of document.querySelectorAll('button, a, [role="button"], [aria-label], [title], span')) {
                  if (!isVisible(el)) continue;
                  const text = [
                    el.textContent || '',
                    el.getAttribute?.('aria-label') || '',
                    el.getAttribute?.('title') || '',
                    el.value || ''
                  ].join(' ').trim();
                  const normalizedText = text.toLowerCase();
                  if (normalizedText && normalizedCompleteTexts.some(t => normalizedText.includes(t))) {
                    return { completed: true, text, tag: el.tagName, disabled: !!el.disabled };
                  }
                }
                return { completed: false };
              },
              args: [step.completeText]
            });
            const completeResult = results?.[0]?.result;
            log('info', `完成状态检查结果: ${JSON.stringify(completeResult)}`);
            if (completeResult?.completed) {
              const config = await getConfig();
              if (config.closeDelay > 0) {
                log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
                await new Promise(r => setTimeout(r, config.closeDelay * 1000));
              }
              shouldCloseTab = true;
              const status = { success: true, message: completeResult.text || '今日已签到，无需重复签到' };
              await updateSiteStatus(site.id, status);
              return { site, ...status };
            }
          }
          throw new Error(`未找到${step.description}`);
        }

        if (clickResult && clickResult.clicked) {
          log('info', `已点击 "${clickResult.text}"`);
        } else {
          log('info', '脚本已执行');
        }

        if (step.completeAfterClick) {
          await new Promise(r => setTimeout(r, 1000));
          const config = await getConfig();
          if (config.closeDelay > 0) {
            log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
            await new Promise(r => setTimeout(r, config.closeDelay * 1000));
          }
          shouldCloseTab = true;
          const clickedText = clickResult?.text || step.description;
          const status = { success: true, message: `已点击${clickedText}，签到完成` };
          await updateSiteStatus(site.id, status);
          return { site, ...status };
        }

        if (step.continueAfterClick) {
          if (step.waitAfterClickUrlIncludes) {
            log('info', `点击完成，等待跳转到: ${step.waitAfterClickUrlIncludes.join(' / ')}`);
            try {
              const nextUrl = await pollTabUrlAny(tab.id, step.waitAfterClickUrlIncludes, step.waitAfterClickTimeout || 30000);
              log('info', `页面已跳转: ${nextUrl}`);
            } catch (e) {
              log('warn', `等待指定跳转超时，继续检查当前页面: ${e.message}`);
            }
          } else {
            log('info', '点击完成，等待页面跳转后继续执行后续步骤...');
            await waitForTabLoad(tab.id, 15000);
          }
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        shouldCloseTab = false;

        if (step.watchNewTab && newTabPromise) {
          log('info', '等待新标签页打开...');
          const newTab = await newTabPromise;
          if (newTab) {
            log('info', `检测到新标签页: ${newTab.id}, URL: ${newTab.url}`);
            await waitForTabLoad(newTab.id, 30000);
            log('info', '新标签页加载完成，查找授权按钮...');

            await new Promise(r => setTimeout(r, 1500));

            if (step.authorizeSelector) {
              log('info', `在授权页面查找按钮: ${step.authorizeSelector}`);
              let authorizeClicked = false;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const results = await chrome.scripting.executeScript({
                    target: { tabId: newTab.id },
                    func: (selector, matchTexts) => {
                      const elements = document.querySelectorAll(selector);
                      for (const el of elements) {
                        const text = (el.textContent || '').toLowerCase();
                        const value = (el.value || '').toLowerCase();
                        if (matchTexts.some(t => text.includes(t) || value.includes(t))) {
                          el.click();
                          return { clicked: true, text: el.textContent.trim() || el.value };
                        }
                      }
                      return { clicked: false };
                    },
                    args: [step.authorizeSelector, step.authorizeText || ['allow', 'authorize', 'agree', '同意', '允许', '授权']]
                  });
                  const authorizeResult = results?.[0]?.result;
                  log('info', `授权按钮点击结果: ${JSON.stringify(authorizeResult)}`);
                  if (authorizeResult?.clicked) {
                    authorizeClicked = true;
                    break;
                  }
                } catch (scriptErr) {
                  log('warn', `授权按钮脚本执行异常(第${attempt + 1}次): ${scriptErr.message}`);
                }
                await new Promise(r => setTimeout(r, 2000));
              }
              if (!authorizeClicked) {
                log('warn', '未找到授权按钮，继续等待...');
              }
            }

            const finalUrl = await pollTabUrlEither([tab.id, newTab.id], step.successPattern || flow.successPattern, 120000);
            log('info', `跳转成功: ${finalUrl}`);
            
            if (step.continueAfterAuthorize) {
              log('info', '授权成功，继续执行后续步骤...');
              try { await chrome.tabs.remove(newTab.id); } catch {}
              await waitForTabLoad(tab.id, 15000);
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            
            const config = await getConfig();
            if (config.closeDelay > 0) {
              log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
              await new Promise(r => setTimeout(r, config.closeDelay * 1000));
            }
            shouldCloseTab = true;
            const status = { success: true, message: `已点击${step.description}，OAuth 登录签到成功` };
            await updateSiteStatus(site.id, status);
            try { await chrome.tabs.remove(newTab.id); } catch {}
            return { site, ...status };
          }

          log('info', '未检测到新标签页，改为在当前标签页继续等待授权/回跳...');
          if (step.waitAfterClickUrlIncludes) {
            try {
              const nextUrl = await pollTabUrlAny(tab.id, step.waitAfterClickUrlIncludes, step.waitAfterClickTimeout || 10000);
              log('info', `当前页已跳转: ${nextUrl}`);
            } catch (e) {
              const currentTab = await chrome.tabs.get(tab.id);
              throw new Error(`点击${step.description}后页面未跳转，当前URL: ${currentTab.url || ''}`);
            }
          }
          await waitForTabLoad(tab.id, 15000);
          await new Promise(r => setTimeout(r, 1500));

          if (step.authorizeSelector) {
            let authorizeClicked = false;
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const results = await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: (selector, matchTexts) => {
                    const elements = document.querySelectorAll(selector);
                    for (const el of elements) {
                      const text = (el.textContent || '').toLowerCase();
                      const value = (el.value || '').toLowerCase();
                      if (matchTexts.some(t => text.includes(t) || value.includes(t))) {
                        el.click();
                        return { clicked: true, text: el.textContent.trim() || el.value };
                      }
                    }
                    return { clicked: false };
                  },
                  args: [step.authorizeSelector, step.authorizeText || ['allow', 'authorize', 'agree', '同意', '允许', '授权', 'approve']]
                });
                const authorizeResult = results?.[0]?.result;
                log('info', `当前页授权按钮点击结果: ${JSON.stringify(authorizeResult)}`);
                if (authorizeResult?.clicked) {
                  authorizeClicked = true;
                  await waitForTabLoad(tab.id, 15000);
                  break;
                }
              } catch (scriptErr) {
                log('warn', `当前页授权按钮脚本执行异常(第${attempt + 1}次): ${scriptErr.message}`);
              }
              await new Promise(r => setTimeout(r, 1500));
            }
            if (!authorizeClicked) {
              log('info', '当前页未发现授权按钮，继续等待回跳...');
            }
          }
        }

        if (step.continueAfterClick) {
          log('info', '点击完成，继续执行后续步骤...');
          await waitForTabLoad(tab.id, 15000);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        try {
          const finalUrl = await pollTabUrl(tab.id, step.successPattern || flow.successPattern, 60000);
          log('info', `跳转成功: ${finalUrl}`);
          if (step.continueAfterAuthorize) {
            log('info', '登录成功，继续执行后续步骤...');
            await waitForTabLoad(tab.id, 15000);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          const config = await getConfig();
          if (config.closeDelay > 0) {
            log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
            await new Promise(r => setTimeout(r, config.closeDelay * 1000));
          }
          shouldCloseTab = true;
          const status = { success: true, message: `已点击${step.description}，登录签到成功` };
          await updateSiteStatus(site.id, status);
          return { site, ...status };
        } catch (pollErr) {
          log('error', `等待跳转失败: ${pollErr.message}`);
          shouldCloseTab = true;
          throw pollErr;
        }
      }

      if (step.type === 'checkGotoLogin') {
        const currentTab = await chrome.tabs.get(tab.id);
        const url = currentTab.url || '';
        log('info', `检查是否需要跳转登录，当前URL: ${url}`);

        if (url.includes('/login') || url.includes('/signin')) {
          log('info', '已在登录页面，继续...');
          continue;
        }

        if (url.includes(flow.successPattern)) {
          log('info', '已登录，跳过登录步骤');
          continue;
        }

        log('info', '尝试点击登录按钮...');
        let loginClicked = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const spans = document.querySelectorAll('span');
                for (const span of spans) {
                  const text = (span.textContent || '').trim();
                  if (text === '登录' || text === 'Login' || text === 'Sign In') {
                    const btn = span.closest('button') || span.closest('a') || span.parentElement;
                    if (btn) {
                      btn.click();
                      return { clicked: true, text: text };
                    }
                  }
                }
                const allLinks = document.querySelectorAll('a, button');
                for (const link of allLinks) {
                  const text = (link.textContent || '').trim();
                  const href = (link.href || '').toLowerCase();
                  if (text.includes('登录') || text.includes('login') || text.includes('sign in') || 
                      href.includes('/login') || href.includes('/signin')) {
                    link.click();
                    return { clicked: true, text: text, href: link.href };
                  }
                }
                return { clicked: false };
              }
            });
            const result = results?.[0]?.result;
            log('info', `登录按钮点击结果(第${attempt + 1}次): ${JSON.stringify(result)}`);
            if (result?.clicked) {
              loginClicked = true;
              await waitForTabLoad(tab.id, 15000);
              await new Promise(r => setTimeout(r, 1000));
              break;
            }
          } catch (e) {
            log('warn', `点击登录按钮异常(第${attempt + 1}次): ${e.message}`);
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        if (!loginClicked) {
          log('warn', '未找到登录按钮，继续...');
        }
        continue;
      }

      if (step.type === 'closeAnnouncement') {
        log('info', `${step.description}`);
        await new Promise(r => setTimeout(r, 1000));

        let closed = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (selector, matchTexts, fallbackCloseSelector) => {
                const isVisible = (el) => {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                };
                const getLabel = (el) => [
                  el.textContent || '',
                  el.getAttribute?.('aria-label') || '',
                  el.getAttribute?.('title') || '',
                  el.value || '',
                  el.className || '',
                  el.getAttribute?.('role') || ''
                ].join(' ').trim();
                const normalize = (text) => String(text || '').toLowerCase().replace(/\s+/g, '');
                const normalizedMatchTexts = (matchTexts || []).map(normalize);
                const isCloseControl = (el) => {
                  const label = getLabel(el);
                  const normalizedLabel = normalize(label);
                  if (normalizedMatchTexts.some(t => t && normalizedLabel.includes(t))) return true;
                  if (['x', '×', '✕', '╳'].includes(label.trim())) return true;
                  if (normalizedLabel.includes('close') || normalizedLabel.includes('modal-close') || normalizedLabel.includes('semimodalclose') || normalizedLabel.includes('关闭')) return true;
                  return false;
                };
                const modalSelectors = [
                  '[role="dialog"]',
                  '[aria-modal="true"]',
                  '.semi-modal',
                  '.semi-modal-content',
                  '.semi-modal-wrap',
                  '[class*="modal" i]',
                  '[class*="dialog" i]',
                  '[class*="drawer" i]',
                  '[class*="portal" i]',
                  '[class*="notice" i]',
                  '[class*="announcement" i]'
                ].join(',');
                const looksLikeAnnouncement = (el) => {
                  const text = el.textContent || '';
                  const lowered = text.toLowerCase();
                  return text.includes('系统公告') || text.includes('公告') ||
                    text.includes('快速开始') || lowered.includes('announcement') ||
                    lowered.includes('notice');
                };
                const findAnnouncementContainers = () => {
                  const containers = [];
                  for (const el of document.querySelectorAll(modalSelectors)) {
                    if (isVisible(el)) containers.push(el);
                  }
                  for (const el of document.querySelectorAll('body *')) {
                    if (!isVisible(el) || !looksLikeAnnouncement(el)) continue;
                    let node = el;
                    for (let i = 0; i < 6 && node && node !== document.body; i++) {
                      const rect = node.getBoundingClientRect();
                      if (rect.width >= 280 && rect.height >= 160) {
                        containers.push(node);
                        break;
                      }
                      node = node.parentElement;
                    }
                  }
                  return [...new Set(containers)];
                };
                const clickWithin = (container) => {
                  const rawControls = [
                    ...container.querySelectorAll(selector),
                    ...(fallbackCloseSelector ? [...container.querySelectorAll(fallbackCloseSelector)] : [])
                  ];
                  const controls = [...new Set(rawControls.map(el => el.closest?.('button, a, [role="button"]') || el))];
                  for (const el of controls) {
                    if (!isVisible(el)) continue;
                    const className = String(el.className || '').toLowerCase();
                    if (className.includes('close') || className.includes('modal-close')) {
                      el.click();
                      return { clicked: true, text: getLabel(el) || 'modal close control' };
                    }
                  }
                  for (const el of controls) {
                    if (isVisible(el) && isCloseControl(el)) {
                      el.click();
                      return { clicked: true, text: getLabel(el) || 'announcement close control' };
                    }
                  }
                  const rect = container.getBoundingClientRect();
                  for (const el of controls) {
                    if (!isVisible(el)) continue;
                    const elRect = el.getBoundingClientRect();
                    const nearTopRight = elRect.left > rect.left + rect.width * 0.7 &&
                      elRect.top < rect.top + rect.height * 0.25;
                    if (nearTopRight) {
                      el.click();
                      return { clicked: true, text: getLabel(el) || 'top-right close control' };
                    }
                  }
                  return { clicked: false };
                };

                for (const container of findAnnouncementContainers()) {
                  const result = clickWithin(container);
                  if (result.clicked) return result;
                }

                for (const el of document.querySelectorAll(selector)) {
                  if (isVisible(el) && isCloseControl(el)) {
                    el.click();
                    return { clicked: true, text: getLabel(el) };
                  }
                }
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                return { clicked: true, text: 'Escape' };
              },
              args: [step.selector, step.matchText, step.fallbackCloseSelector || null]
            });
            const result = results?.[0]?.result;
            log('info', `关闭公告结果(第${attempt + 1}次): ${JSON.stringify(result)}`);
            if (result?.clicked) {
              closed = true;
              await new Promise(r => setTimeout(r, 500));
              break;
            }
          } catch (e) {
            log('warn', `关闭公告异常(第${attempt + 1}次): ${e.message}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }
        if (!closed) {
          log('info', '未发现系统公告，继续...');
        }
        continue;
      }

      if (step.type === 'waitForElement') {
        log('info', `${step.description}`);
        const timeout = step.timeout || 10000;
        const startTime = Date.now();
        let found = false;
        
        while (Date.now() - startTime < timeout) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (selector) => {
                const elements = document.querySelectorAll(selector);
                return elements.length > 0;
              },
              args: [step.selector]
            });
            if (results?.[0]?.result) {
              found = true;
              log('info', `找到元素: ${step.selector}`);
              break;
            }
          } catch (e) {}
          await new Promise(r => setTimeout(r, 500));
        }
        
        if (!found) {
          log('warn', `等待元素超时: ${step.selector}`);
        }
        continue;
      }

      if (step.type === 'checkAndClick') {
        log('info', `${step.description}`);
        await new Promise(r => setTimeout(r, 1000));

        let clicked = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (selector) => {
                const checkbox = document.querySelector(selector);
                if (checkbox && !checkbox.checked) {
                  checkbox.click();
                  return { clicked: true, checked: checkbox.checked };
                }
                return { clicked: false, checked: checkbox?.checked || false };
              },
              args: [step.selector]
            });
            const result = results?.[0]?.result;
            log('info', `勾选结果: ${JSON.stringify(result)}`);
            if (result?.clicked || result?.checked) {
              clicked = true;
              break;
            }
          } catch (e) {
            log('warn', `勾选异常(第${attempt + 1}次): ${e.message}`);
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        if (!clicked) {
          log('warn', '未找到复选框或已勾选，继续...');
        }
        continue;
      }

      if (step.type === 'waitAuthorize') {
        log('info', `${step.description}`);
        let authorizeClicked = false;
        let sawAuthorizePage = false;

        for (let attempt = 0; attempt < 15; attempt++) {
          const currentTab = await chrome.tabs.get(tab.id);
          const url = currentTab.url || '';
          log('info', `授权检查(${attempt + 1}/15)，当前URL: ${url}`);

          const successUrlIncludes = step.successUrlIncludes || ['/console'];
          if (successUrlIncludes.some(pattern => url.includes(pattern))) {
            log('info', '已回到目标页面，跳过授权按钮检查');
            authorizeClicked = true;
            break;
          }

          sawAuthorizePage = sawAuthorizePage || url.includes('authorize') || url.includes('oauth') || url.includes('linux.do');

          if ((url.includes('/login') || url.includes('/signin')) && !sawAuthorizePage) {
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                  const matchTexts = ['linuxdo', 'linux do', 'linux.do', 'oauth'];
                  const elements = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
                  for (const el of elements) {
                    const text = [
                      el.textContent || '',
                      el.getAttribute?.('aria-label') || '',
                      el.getAttribute?.('title') || '',
                      el.getAttribute?.('data-provider') || '',
                      el.getAttribute?.('data-testid') || '',
                      el.value || '',
                      el.href || ''
                    ].join(' ').toLowerCase();
                    if (matchTexts.some(t => text.includes(t))) {
                      el.click();
                      return { clicked: true, text: text.trim().slice(0, 120) };
                    }
                  }
                  return { clicked: false };
                }
              });
              const loginResult = results?.[0]?.result;
              log('info', `LinuxDO 登录入口补点结果: ${JSON.stringify(loginResult)}`);
              if (loginResult?.clicked) {
                await waitForTabLoad(tab.id, 15000);
                await new Promise(r => setTimeout(r, 1000));
                continue;
              }
            } catch (scriptErr) {
              log('warn', `LinuxDO 登录入口补点异常(第${attempt + 1}次): ${scriptErr.message}`);
            }
          }

          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (selector, matchTexts) => {
                const isVisible = (el) => {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    Number(style.opacity) !== 0;
                };
                const textOf = (el) => [
                  el.textContent || '',
                  el.getAttribute?.('aria-label') || '',
                  el.getAttribute?.('title') || '',
                  el.value || '',
                  el.name || '',
                  el.id || '',
                  el.href || ''
                ].join(' ').trim();
                const normalizedMatches = (matchTexts || []).map(t => String(t).toLowerCase());
                const negativeTexts = ['deny', 'denied', 'cancel', 'reject', 'decline', 'disallow', '拒绝', '取消', '不同意'];
                const elements = Array.from(document.querySelectorAll(selector))
                  .filter(el => isVisible(el) && !el.disabled && el.getAttribute?.('aria-disabled') !== 'true');
                const candidates = elements.map(el => {
                  const text = textOf(el);
                  const lower = text.toLowerCase();
                  let score = 0;
                  if (el.matches('button[type="submit"], input[type="submit"]')) score += 5;
                  if (el.closest('form')) score += 3;
                  if (normalizedMatches.some(t => t && lower.includes(t))) score += 4;
                  if (/allow|authorize|approve|agree|允许|授权|同意|确认|继续/i.test(text)) score += 6;
                  if (/linux|oauth/i.test(document.body.innerText || '')) score += 1;
                  if (negativeTexts.some(t => lower.includes(t))) score -= 20;
                  return { el, text, score };
                }).filter(item => item.score > 0)
                  .sort((a, b) => b.score - a.score);

                const candidate = candidates[0];
                if (!candidate) {
                  return {
                    clicked: false,
                    visible: elements.map(el => textOf(el)).filter(Boolean).slice(0, 8)
                  };
                }

                candidate.el.scrollIntoView({ block: 'center', inline: 'center' });
                candidate.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                candidate.el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                candidate.el.click();

                const form = candidate.el.closest('form');
                if (form && typeof form.requestSubmit === 'function') {
                  try { form.requestSubmit(candidate.el); } catch {}
                }

                return {
                  clicked: true,
                  text: candidate.text,
                  tag: candidate.el.tagName,
                  type: candidate.el.getAttribute('type') || '',
                  score: candidate.score
                };
              },
              args: [step.authorizeSelector, step.authorizeText || ['allow', 'authorize', 'agree', '同意', '允许', '授权', 'approve']]
            });
            const authorizeResult = results?.[0]?.result;
            log('info', `授权按钮点击结果: ${JSON.stringify(authorizeResult)}`);
            if (authorizeResult?.clicked) {
              authorizeClicked = true;
              break;
            }
          } catch (scriptErr) {
            log('warn', `授权按钮脚本执行异常(第${attempt + 1}次): ${scriptErr.message}`);
          }
          await new Promise(r => setTimeout(r, 2000));
        }

        if (!authorizeClicked) {
          if (sawAuthorizePage) {
            throw new Error('未找到授权按钮');
          }
          log('info', '未进入授权页面，继续后续步骤');
          continue;
        }

        log('info', '已点击授权按钮，等待跳转...');
        try {
          const nextUrl = await pollTabUrlAny(tab.id, step.successUrlIncludes || ['/console', '/login'], step.successWaitTimeout || 30000);
          log('info', `授权后页面已跳转: ${nextUrl}`);
        } catch (e) {
          log('warn', `授权后等待跳转超时，继续后续步骤: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      if (step.type === 'navigateToSettings') {
        log('info', `${step.description}`);
        const currentTab = await chrome.tabs.get(tab.id);
        const url = currentTab.url || '';
        log('info', `当前URL: ${url}`);

        if (step.targetUrl && !url.includes(step.targetUrl)) {
          log('info', `直接进入个人设置页: ${step.targetUrl}`);
          await chrome.tabs.update(tab.id, { url: step.targetUrl });
          await waitForTabLoad(tab.id, 15000);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        if (url.includes('/console/personal') || url.includes('/settings') || url.includes('/profile')) {
          log('info', '已在个人设置页面，继续...');
          continue;
        }

        if (url.includes('/console') || url.includes('/dashboard')) {
          log('info', '已在控制台，查找设置入口...');
        }

        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const links = document.querySelectorAll('a, button');
              for (const link of links) {
                const text = (link.textContent || '').toLowerCase();
                const href = (link.href || '').toLowerCase();
                if (text.includes('设置') || text.includes('setting') || text.includes('个人') || text.includes('profile') || href.includes('setting') || href.includes('profile') || href.includes('personal')) {
                  link.click();
                  return { clicked: true, text: link.textContent.trim(), href: link.href };
                }
              }
              return { clicked: false };
            }
          });
          const result = results?.[0]?.result;
          log('info', `设置入口点击结果: ${JSON.stringify(result)}`);
          if (result?.clicked) {
            await waitForTabLoad(tab.id, 15000);
            await new Promise(r => setTimeout(r, 1500));
          }
        } catch (e) {
          log('warn', `点击设置入口异常: ${e.message}`);
        }
        continue;
      }

      if (step.type === 'inject') {
        let results;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: async (code) => {
                const result = eval(code);
                return await result;
              },
              args: [step.code]
            });
            break;
          } catch (injectErr) {
            log('warn', `脚本注入失败(第${attempt + 1}次): ${injectErr.message}`);
            if (attempt < 2) {
              log('info', '等待页面稳定后重试...');
              await waitForTabLoad(tab.id, 10000);
              await new Promise(r => setTimeout(r, 1000));
            } else {
              log('error', '脚本注入3次均失败');
              throw injectErr;
            }
          }
        }

        const result = results?.[0]?.result;
        log('info', `步骤结果: ${JSON.stringify(result)}`);

        if (!result) {
          throw new Error('脚本无返回，可能页面未加载完成');
        }

        if (result.action === 'done') {
          const config = await getConfig();
          if (config.closeDelay > 0) {
            log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
            await new Promise(r => setTimeout(r, config.closeDelay * 1000));
          }
          const status = { success: result.success, message: result.message };
          await updateSiteStatus(site.id, status);
          return { site, ...status };
        }

        if (result.action === 'waitRedirect') {
          log('info', `等待页面跳转到: ${flow.successPattern} (最多60s)`);
          shouldCloseTab = false;
          try {
            const finalUrl = await pollTabUrl(tab.id, flow.successPattern, 60000);
            log('info', `跳转成功: ${finalUrl}`);
            const config = await getConfig();
            if (config.closeDelay > 0) {
              log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
              await new Promise(r => setTimeout(r, config.closeDelay * 1000));
            }
            shouldCloseTab = true;
            const status = { success: true, message: result.message || '登录签到成功' };
            await updateSiteStatus(site.id, status);
            return { site, ...status };
          } catch (pollErr) {
            log('error', `等待跳转失败: ${pollErr.message}`);
            shouldCloseTab = true;
            throw pollErr;
          }
        }

        if (result.action === 'error') {
          throw new Error(result.message);
        }
      }

      if (step.type === 'injectFunction') {
        log('info', `${step.description}`);
        let results;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              world: step.world || 'ISOLATED',
              func: step.func,
              args: step.args || []
            });
            break;
          } catch (injectErr) {
            log('warn', `函数脚本注入失败(第${attempt + 1}次): ${injectErr.message}`);
            if (attempt < 2) {
              log('info', '等待页面稳定后重试...');
              await waitForTabLoad(tab.id, 10000);
              await new Promise(r => setTimeout(r, 1000));
            } else {
              log('error', '函数脚本注入3次均失败');
              throw injectErr;
            }
          }
        }

        const result = results?.[0]?.result;
        log('info', `步骤结果: ${JSON.stringify(result)}`);

        if (!result) {
          throw new Error('脚本无返回，可能页面未加载完成');
        }

        if (result.action === 'done') {
          const config = await getConfig();
          if (config.closeDelay > 0) {
            log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
            await new Promise(r => setTimeout(r, config.closeDelay * 1000));
          }
          const status = { success: result.success, message: result.message };
          await updateSiteStatus(site.id, status);
          return { site, ...status };
        }

        if (result.action === 'waitRedirect') {
          log('info', `等待页面跳转到: ${flow.successPattern} (最多60s)`);
          shouldCloseTab = false;
          try {
            const finalUrl = await pollTabUrl(tab.id, flow.successPattern, 60000);
            log('info', `跳转成功: ${finalUrl}`);
            const config = await getConfig();
            if (config.closeDelay > 0) {
              log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
              await new Promise(r => setTimeout(r, config.closeDelay * 1000));
            }
            shouldCloseTab = true;
            const status = { success: true, message: result.message || '登录签到成功' };
            await updateSiteStatus(site.id, status);
            return { site, ...status };
          } catch (pollErr) {
            log('error', `等待跳转失败: ${pollErr.message}`);
            shouldCloseTab = true;
            throw pollErr;
          }
        }

        if (result.action === 'error') {
          throw new Error(result.message);
        }

        if (result.action === 'continue') {
          log('info', result.message || '继续后续步骤');
          await new Promise(r => setTimeout(r, step.waitAfter || 1500));
          continue;
        }
      }
    }

    throw new Error('流程执行完毕但未完成签到');
  } catch (err) {
    log('error', `流程签到异常: ${err.message}`);
    const status = { success: false, message: err.message };
    await updateSiteStatus(site.id, status);
    return { site, ...status };
  } finally {
    if (tab && shouldCloseTab) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}

function waitForTabLoad(tabId, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      log('warn', '页面加载超时，继续执行...');
      resolve();
    }, timeout);

    let stableTimer = null;

    const listener = (id, info) => {
      if (id !== tabId) return;

      if (info.status === 'loading') {
        if (stableTimer) {
          clearTimeout(stableTimer);
          stableTimer = null;
        }
      }

      if (info.status === 'complete') {
        if (stableTimer) clearTimeout(stableTimer);
        stableTimer = setTimeout(async () => {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          try {
            const tab = await chrome.tabs.get(tabId);
            log('info', `页面稳定: ${tab.url}`);
          } catch {}
          resolve();
        }, 1500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function pollTabUrl(tabId, pattern, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('等待跳转超时'));
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && tab.url.includes(pattern)) {
          clearInterval(interval);
          resolve(tab.url);
        }
      } catch (e) {
        clearInterval(interval);
        reject(new Error('标签页已关闭'));
      }
    }, 500);
  });
}

function pollTabUrlAny(tabId, patterns, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('等待跳转超时'));
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && patterns.some(pattern => tab.url.includes(pattern))) {
          clearInterval(interval);
          resolve(tab.url);
        }
      } catch (e) {
        clearInterval(interval);
        reject(new Error('标签页已关闭'));
      }
    }, 500);
  });
}

function pollTabUrlEither(tabIds, pattern, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('等待跳转超时'));
        return;
      }
      for (const tabId of tabIds) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url && tab.url.includes(pattern)) {
            clearInterval(interval);
            resolve(tab.url);
            return;
          }
        } catch {}
      }
    }, 500);
  });
}

async function doSimpleCheckin(site, adapter) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: site.url, active: false });
    log('info', `标签页已创建: ${tab.id}`);

    await waitForTabLoad(tab.id, 20000);
    log('info', '页面加载完成，等待1.5s...');
    await new Promise(r => setTimeout(r, 1500));

    const code = adapter.getCheckinCode();
    log('info', `注入脚本, 代码长度: ${code.length}`);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (code) => eval(code),
      args: [code]
    });

    const status = results?.[0]?.result || { success: false, message: '执行无返回' };
    log('info', `脚本执行结果: ${JSON.stringify(status)}`);
    const config = await getConfig();
    if (config.closeDelay > 0 && status.success) {
      log('info', `等待 ${config.closeDelay} 秒后关闭页面...`);
      await new Promise(r => setTimeout(r, config.closeDelay * 1000));
    }
    await updateSiteStatus(site.id, status);
    return { site, ...status };
  } catch (err) {
    log('error', `签到异常: ${err.message}`);
    const status = { success: false, message: err.message };
    await updateSiteStatus(site.id, status);
    return { site, ...status };
  } finally {
    if (tab) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}
