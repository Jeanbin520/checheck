import { getSites, addSite, removeSite, getConfig, saveConfig } from '../lib/storage.js';
import { PRESET_SITES } from '../lib/preset-sites.js';

const $ = (sel) => document.querySelector(sel);
const LINUXDO_READING_STORAGE_KEY = 'linuxdoReadingHelper';
const LINUXDO_READING_DEFAULTS = {
  speed: 'normal',
  maxMinutes: 8,
  pauseOnUserInput: true
};
const LINUXDO_READING_UI_DEFAULTS = {
  enabled: false,
  ...LINUXDO_READING_DEFAULTS
};
const LINUXDO_READING_STATUS_LABELS = {
  idle: '待机中',
  started: '已开始',
  reading: '正在慢速滚动',
  'reading-marker-visible': '检测到蓝点，继续阅读',
  'paused-by-user': '检测到手动操作，短暂停顿',
  completed: '已完成，本页蓝点已消失',
  stopped: '已停止',
  disabled: '已关闭',
  'not-topic-page': '请在 linux.do 主题页使用',
  'time-limit': '已达到最长时间限制'
};
const LINUXDO_READING_STOPPED_STATUSES = new Set([
  'completed',
  'stopped',
  'disabled',
  'not-topic-page',
  'time-limit'
]);
const LDC_CREDIT_STORAGE_KEY = 'ldcCredit';
const SETTINGS_PANEL_ID = 'settings-panel';

let linuxdoReadingActiveTabId = null;
let linuxdoReadingActiveTabUrl = '';
let linuxdoReadingSettings = { ...LINUXDO_READING_UI_DEFAULTS };
let lastMainPanelId = 'reading-panel';

function normalizeReadingSpeedForUi(speed) {
  return speed === 'slow' ? 'randomSlow' : speed;
}

async function renderSites() {
  const sites = await getSites();
  const list = $('#site-list');
  list.innerHTML = '';

  if (sites.length === 0) {
    list.innerHTML = '<li style="text-align:center;color:#999;padding:20px;">暂无站点，请从下拉列表添加</li>';
  }

  for (const site of sites) {
    const li = document.createElement('li');
    li.className = 'site-item';
    li.innerHTML = `
      <div class="site-info">
        <div class="site-name">${escapeHtml(site.name)}</div>
        <div class="site-url">${escapeHtml(site.url)}</div>
        ${site.lastStatus ? `<div class="site-status ${site.lastStatus.success ? 'success' : 'fail'}">${escapeHtml(site.lastStatus.message)}</div>` : ''}
      </div>
      <button class="btn-delete" data-id="${site.id}">✕</button>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removeSite(btn.dataset.id);
      renderSites();
      renderDropdown();
    });
  });
}

async function renderDropdown() {
  const sites = await getSites();
  const addedUrls = new Set(sites.map(s => s.url));
  const select = $('#site-select');

  select.innerHTML = '<option value="">-- 选择站点 --</option>';

  for (const preset of PRESET_SITES) {
    if (addedUrls.has(preset.url)) continue;
    const opt = document.createElement('option');
    opt.value = preset.url;
    opt.textContent = `${preset.name} (${preset.url})`;
    select.appendChild(opt);
  }

  if (select.options.length <= 1) {
    select.innerHTML = '<option value="">所有站点已添加</option>';
    $('#add-site').disabled = true;
  } else {
    $('#add-site').disabled = false;
  }
}

async function renderDetected() {
  const existing = $('#detected-sites-section');
  if (existing) existing.remove();

  const items = await chrome.storage.session.get(null);
  const detected = Object.values(items)
    .filter(v => v.detectedAt && Date.now() - v.detectedAt < 3600000)
    .slice(0, 5);

  if (detected.length === 0) return;

  const section = document.createElement('div');
  section.id = 'detected-sites-section';
  section.className = 'section';
  section.innerHTML = `<h2>检测到的签到站点</h2>`;

  for (const d of detected) {
    const div = document.createElement('div');
    div.className = 'site-item';
    div.innerHTML = `
      <div class="site-info">
        <div class="site-name">${escapeHtml(d.title || d.url)}</div>
        <div class="site-url">${escapeHtml(d.url)}</div>
      </div>
      <button class="btn-secondary add-detected" data-url="${escapeHtml(d.url)}" data-title="${escapeHtml(d.title || d.url)}">添加</button>
    `;
    section.appendChild(div);
  }

  const anchor = $('#site-management-section') || $('#checkin-panel .section');
  if (anchor) anchor.before(section);

  section.querySelectorAll('.add-detected').forEach(btn => {
    btn.addEventListener('click', async () => {
      await addSite({ url: btn.dataset.url, name: btn.dataset.title });
      renderSites();
      renderDropdown();
      section.remove();
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setActiveTab(panelId) {
  const buttons = document.querySelectorAll('.tab-button');
  const panels = document.querySelectorAll('.tab-panel');
  const settingsButton = $('#open-settings');

  if (panelId !== SETTINGS_PANEL_ID) {
    lastMainPanelId = panelId;
  }

  buttons.forEach(button => {
    const active = button.dataset.tabTarget === panelId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (settingsButton) {
    const settingsActive = panelId === SETTINGS_PANEL_ID;
    settingsButton.classList.toggle('active', settingsActive);
    settingsButton.setAttribute('aria-pressed', settingsActive ? 'true' : 'false');
  }

  panels.forEach(panel => {
    const active = panel.id === panelId;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });

  if (panelId === 'reading-panel') {
    refreshLinuxdoReadingHelper();
    loadStoredLdcCredit();
  }
  if (panelId === 'checkin-panel') {
    renderLogs();
  }
}

function initSettingsPanel() {
  const settingsButton = $('#open-settings');
  const backButton = $('#settings-back');

  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      const isOpen = $('#settings-panel')?.classList.contains('active');
      setActiveTab(isOpen ? lastMainPanelId : SETTINGS_PANEL_ID);
    });
  }

  if (backButton) {
    backButton.addEventListener('click', () => {
      setActiveTab(lastMainPanelId);
    });
  }
}

function initTabs() {
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      setActiveTab(button.dataset.tabTarget);
    });
  });
}

function getLdcElements() {
  return {
    statusText: $('#ldc-status'),
    availableText: $('#ldc-available'),
    sevenDayLabel: $('#ldc-seven-day-label'),
    sevenDayText: $('#ldc-seven-day'),
    refreshButton: $('#ldc-refresh'),
    openButton: $('#ldc-open')
  };
}

function formatLdcMetric(value) {
  const text = value == null ? '' : String(value).trim();
  return text || '--';
}

function formatLdcTime(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function renderLdcCredit(state) {
  const { statusText, availableText, sevenDayLabel, sevenDayText } = getLdcElements();
  if (!statusText || !availableText || !sevenDayLabel || !sevenDayText) return;

  if (!state) {
    statusText.textContent = '尚未刷新';
    availableText.textContent = '--';
    sevenDayLabel.textContent = '7 天收入（昨日收入：--）';
    sevenDayText.textContent = '--';
    return;
  }

  availableText.textContent = formatLdcMetric(state.availableLdc);
  sevenDayLabel.textContent = `7 天收入（昨日收入：${formatLdcMetric(state.yesterdayIncome)}）`;
  sevenDayText.textContent = formatLdcMetric(state.sevenDayIncome);

  const timeText = formatLdcTime(state.updatedAt);
  const message = state.message || (state.ok ? '已刷新' : '读取失败');
  statusText.textContent = timeText ? `${message} · ${timeText}` : message;
}

async function loadStoredLdcCredit() {
  const result = await chrome.storage.local.get(LDC_CREDIT_STORAGE_KEY);
  renderLdcCredit(result[LDC_CREDIT_STORAGE_KEY]);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function refreshLdcCredit() {
  const { refreshButton, statusText } = getLdcElements();
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = '刷新中...';
  }
  if (statusText) statusText.textContent = '正在读取 credit.linux.do...';

  try {
    const response = await sendRuntimeMessage({ action: 'refreshLdcCredit' });
    renderLdcCredit(response);
  } catch (error) {
    renderLdcCredit({
      ok: false,
      message: `读取失败: ${error.message}`,
      updatedAt: Date.now()
    });
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = '刷新';
    }
  }
}

async function openLdcCreditPage() {
  const { openButton, statusText } = getLdcElements();
  if (openButton) openButton.disabled = true;
  if (statusText) statusText.textContent = '正在打开 LDC 页面...';

  try {
    await sendRuntimeMessage({ action: 'openLdcCredit' });
    const result = await chrome.storage.local.get(LDC_CREDIT_STORAGE_KEY);
    renderLdcCredit(result[LDC_CREDIT_STORAGE_KEY] || {
      ok: false,
      message: '已打开 LDC 页面',
      updatedAt: Date.now()
    });
  } catch (error) {
    renderLdcCredit({
      ok: false,
      message: `打开失败: ${error.message}`,
      updatedAt: Date.now()
    });
  } finally {
    if (openButton) openButton.disabled = false;
  }
}

function initLdcCreditTools() {
  const { refreshButton, openButton } = getLdcElements();
  if (refreshButton) refreshButton.addEventListener('click', refreshLdcCredit);
  if (openButton) openButton.addEventListener('click', openLdcCreditPage);
  loadStoredLdcCredit();
}

function getLinuxdoReadingElements() {
  return {
    enabledInput: $('#linuxdo-reading-enabled'),
    speedInput: $('#linuxdo-reading-speed'),
    maxMinutesInput: $('#linuxdo-reading-max-minutes'),
    pauseInput: $('#linuxdo-reading-pause'),
    startButton: $('#linuxdo-reading-start'),
    stopButton: $('#linuxdo-reading-stop'),
    statusText: $('#linuxdo-reading-status')
  };
}

function isLinuxdoUrl(url) {
  return /^https:\/\/linux\.do\//.test(url || '');
}

function setLinuxdoReadingStatus(status, fallback) {
  const { enabledInput, statusText } = getLinuxdoReadingElements();
  if (statusText) {
    statusText.textContent = LINUXDO_READING_STATUS_LABELS[status] || fallback || '状态未知';
  }

  if (enabledInput && LINUXDO_READING_STOPPED_STATUSES.has(status)) {
    enabledInput.checked = false;
    linuxdoReadingSettings.enabled = false;
  }
}

function setLinuxdoReadingButtonsEnabled(enabled) {
  const { enabledInput, startButton, stopButton } = getLinuxdoReadingElements();
  if (enabledInput) enabledInput.disabled = !enabled;
  if (startButton) startButton.disabled = !enabled;
  if (stopButton) stopButton.disabled = !enabled;
}

function readLinuxdoReadingForm() {
  const { enabledInput, speedInput, maxMinutesInput, pauseInput } = getLinuxdoReadingElements();
  return {
    enabled: !!enabledInput?.checked,
    speed: speedInput?.value || LINUXDO_READING_DEFAULTS.speed,
    maxMinutes: Number(maxMinutesInput?.value || LINUXDO_READING_DEFAULTS.maxMinutes),
    pauseOnUserInput: pauseInput?.checked !== false
  };
}

function writeLinuxdoReadingForm(nextSettings) {
  const { enabledInput, speedInput, maxMinutesInput, pauseInput } = getLinuxdoReadingElements();
  linuxdoReadingSettings = { ...LINUXDO_READING_UI_DEFAULTS, ...(nextSettings || {}) };
  linuxdoReadingSettings.speed = normalizeReadingSpeedForUi(linuxdoReadingSettings.speed);
  if (enabledInput) enabledInput.checked = !!linuxdoReadingSettings.enabled;
  if (speedInput) speedInput.value = linuxdoReadingSettings.speed;
  if (maxMinutesInput) maxMinutesInput.value = String(linuxdoReadingSettings.maxMinutes);
  if (pauseInput) pauseInput.checked = linuxdoReadingSettings.pauseOnUserInput !== false;
}

function sendLinuxdoReadingMessage(message) {
  if (!linuxdoReadingActiveTabId) return Promise.reject(new Error('No active tab'));
  return chrome.tabs.sendMessage(linuxdoReadingActiveTabId, message);
}

async function ensureLinuxdoReadingContentScript() {
  if (!linuxdoReadingActiveTabId || !isLinuxdoUrl(linuxdoReadingActiveTabUrl)) {
    throw new Error('当前标签页不是 linux.do 页面');
  }

  await chrome.scripting.executeScript({
    target: { tabId: linuxdoReadingActiveTabId },
    files: ['content/linuxdo-reading-helper.js']
  });
}

async function sendLinuxdoReadingMessageWithInjection(message) {
  try {
    return await sendLinuxdoReadingMessage(message);
  } catch (error) {
    await ensureLinuxdoReadingContentScript();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return sendLinuxdoReadingMessage(message);
  }
}

async function saveLinuxdoReadingSettings(nextSettings) {
  linuxdoReadingSettings = { ...linuxdoReadingSettings, ...nextSettings };
  const persistentSettings = {
    speed: linuxdoReadingSettings.speed,
    maxMinutes: linuxdoReadingSettings.maxMinutes,
    pauseOnUserInput: linuxdoReadingSettings.pauseOnUserInput
  };

  await chrome.storage.local.set({ [LINUXDO_READING_STORAGE_KEY]: persistentSettings });

  if (!linuxdoReadingActiveTabId || !isLinuxdoUrl(linuxdoReadingActiveTabUrl)) {
    setLinuxdoReadingStatus('not-topic-page');
    return;
  }

  try {
    const response = await sendLinuxdoReadingMessageWithInjection({
      type: 'linuxdo-reading-helper-save-settings',
      settings: linuxdoReadingSettings
    });
    if (response?.settings) {
      writeLinuxdoReadingForm({ ...response.settings, enabled: linuxdoReadingSettings.enabled });
    }
    setLinuxdoReadingStatus(response?.status);
  } catch (error) {
    setLinuxdoReadingStatus('not-topic-page');
  }
}

async function refreshLinuxdoReadingHelper() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  linuxdoReadingActiveTabId = tab ? tab.id : null;
  linuxdoReadingActiveTabUrl = tab ? tab.url || '' : '';

  const stored = await chrome.storage.local.get({
    [LINUXDO_READING_STORAGE_KEY]: LINUXDO_READING_DEFAULTS
  });
  writeLinuxdoReadingForm({
    ...stored[LINUXDO_READING_STORAGE_KEY],
    enabled: false
  });

  if (!tab || !isLinuxdoUrl(tab.url)) {
    setLinuxdoReadingButtonsEnabled(false);
    setLinuxdoReadingStatus('not-topic-page');
    return;
  }

  try {
    const response = await sendLinuxdoReadingMessageWithInjection({
      type: 'linuxdo-reading-helper-get-status'
    });
    if (response?.ok) {
      writeLinuxdoReadingForm({
        ...response.settings,
        enabled: response.running
      });
      setLinuxdoReadingButtonsEnabled(!!response.isTopicPage);
      setLinuxdoReadingStatus(response.isTopicPage ? response.status : 'not-topic-page');
      return;
    }
  } catch (error) {
    // Fall through to the disabled state below.
  }

  setLinuxdoReadingButtonsEnabled(false);
  setLinuxdoReadingStatus('not-topic-page');
}

function initLinuxdoReadingHelper() {
  const {
    enabledInput,
    speedInput,
    maxMinutesInput,
    pauseInput,
    startButton,
    stopButton
  } = getLinuxdoReadingElements();

  if (!enabledInput || !speedInput || !maxMinutesInput || !pauseInput || !startButton || !stopButton) {
    return;
  }

  enabledInput.addEventListener('change', () => saveLinuxdoReadingSettings(readLinuxdoReadingForm()));
  speedInput.addEventListener('change', () => saveLinuxdoReadingSettings(readLinuxdoReadingForm()));
  maxMinutesInput.addEventListener('change', () => saveLinuxdoReadingSettings(readLinuxdoReadingForm()));
  pauseInput.addEventListener('change', () => saveLinuxdoReadingSettings(readLinuxdoReadingForm()));

  startButton.addEventListener('click', async () => {
    enabledInput.checked = true;
    await saveLinuxdoReadingSettings({ ...readLinuxdoReadingForm(), enabled: true });
  });

  stopButton.addEventListener('click', async () => {
    enabledInput.checked = false;
    await saveLinuxdoReadingSettings({ ...readLinuxdoReadingForm(), enabled: false });
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== 'linuxdo-reading-helper-status') return;
    if (sender?.tab?.id && linuxdoReadingActiveTabId && sender.tab.id !== linuxdoReadingActiveTabId) {
      return;
    }
    setLinuxdoReadingStatus(message.status);
  });

  refreshLinuxdoReadingHelper();
}

$('#add-site').addEventListener('click', async () => {
  const select = $('#site-select');
  const url = select.value;

  if (!url) {
    alert('请先选择一个站点');
    return;
  }

  const preset = PRESET_SITES.find(s => s.url === url);
  if (!preset) return;

  console.log('[签到助手 Popup] 添加站点:', preset.name, preset.url);

  try {
    const site = await addSite({ name: preset.name, url: preset.url });
    console.log('[签到助手 Popup] 站点添加成功:', site);
    renderSites();
    renderDropdown();
  } catch (e) {
    console.error('[签到助手 Popup] 添加站点失败:', e);
    alert(e.message);
  }
});

$('#checkin-all').addEventListener('click', async () => {
  console.log('[签到助手 Popup] 一键签到按钮被点击');

  const btn = $('#checkin-all');
  btn.disabled = true;
  btn.textContent = '签到中...';
  $('#results').classList.remove('hidden');
  $('#results').innerHTML = '<div style="text-align:center;color:#999;">正在签到，请稍候...</div>';

  try {
    const sites = await getSites();
    console.log('[签到助手 Popup] 当前存储的站点:', sites);
    if (sites.length === 0) {
      btn.disabled = false;
      btn.textContent = '一键签到全部';
      $('#results').innerHTML = '<div style="color:#999;">没有站点，请先从下拉列表添加</div>';
      return;
    }
  } catch (e) {
    console.error('[签到助手 Popup] 读取站点失败:', e);
  }

  try {
    console.log('[签到助手 Popup] 发送 checkinAll 消息...');

    const results = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Service Worker 响应超时(120s)，请检查扩展是否正常加载'));
      }, 120000);

      chrome.runtime.sendMessage({ action: 'checkinAll' }, (response) => {
        clearTimeout(timer);
        console.log('[签到助手 Popup] 收到响应:', response);
        console.log('[签到助手 Popup] lastError:', chrome.runtime.lastError);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

    btn.disabled = false;
    btn.textContent = '一键签到全部';

    if (!results || results.length === 0) {
      $('#results').innerHTML = '<div style="color:#999;">没有站点或签到结果为空</div>';
      return;
    }

    const html = results.map(r => `
      <div class="result-item">
        <strong>${escapeHtml(r.site.name)}</strong>:
        <span style="color:${r.success ? '#34a853' : '#ea4335'}">${escapeHtml(r.message)}</span>
      </div>
    `).join('');
    $('#results').innerHTML = html;

    renderSites();
  } catch (err) {
    console.error('[签到助手 Popup] 异常:', err);
    btn.disabled = false;
    btn.textContent = '一键签到全部';
    $('#results').innerHTML = `<div style="color:red;">错误: ${err.message}</div>`;
  }
});

async function renderLogs() {
  try {
    const logs = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getLogs' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(response || []);
      });
    });

    const area = $('#log-area');
    if (!area) return;

    const wasAtBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 20;

    area.innerHTML = logs.map(entry => {
      const cls = entry.level || 'info';
      return `<div class="log-entry ${cls}"><span class="ts">[${entry.ts}]</span> <span class="msg">${escapeHtml(entry.message)}</span></div>`;
    }).join('');

    if (wasAtBottom) {
      area.scrollTop = area.scrollHeight;
    }
  } catch {}
}

$('#clear-logs').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ action: 'clearLogs' }, () => {
    renderLogs();
  });
});

$('#copy-logs').addEventListener('click', async () => {
  const area = $('#log-area');
  const text = area.innerText || area.textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $('#copy-logs');
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制'; }, 1500);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    const btn = $('#copy-logs');
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制'; }, 1500);
  }
});

// 通知后台根据最新配置重同步定时闹钟
function syncSchedule() {
  try {
    chrome.runtime.sendMessage({ action: 'updateSchedule' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    void e;
  }
}

async function renderConfig() {
  const config = await getConfig();
  const input = $('#close-delay');
  input.value = config.closeDelay;

  input.addEventListener('change', async () => {
    const value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) {
      input.value = 0;
    }
    if (value > 30) {
      input.value = 30;
    }
    await saveConfig({ closeDelay: parseInt(input.value, 10) });
  });

  // 定时自动签到开关
  const scheduleEnabled = $('#schedule-enabled');
  scheduleEnabled.checked = !!config.scheduleEnabled;
  scheduleEnabled.addEventListener('change', async () => {
    await saveConfig({ scheduleEnabled: scheduleEnabled.checked });
    syncSchedule();
  });

  // 每日执行时间
  const scheduleTime = $('#schedule-time');
  scheduleTime.value = config.scheduleTime || '09:00';
  scheduleTime.addEventListener('change', async () => {
    const value = scheduleTime.value || '09:00';
    await saveConfig({ scheduleTime: value });
    // 仅在开关已开启时才需要重同步闹钟
    if (scheduleEnabled.checked) syncSchedule();
  });

  const base64DecoderEnabled = $('#base64-decoder-enabled');
  if (base64DecoderEnabled) {
    base64DecoderEnabled.checked = !!config.base64DecoderEnabled;
    base64DecoderEnabled.addEventListener('change', async () => {
      await saveConfig({ base64DecoderEnabled: base64DecoderEnabled.checked });
    });
  }
}

console.log('[签到助手] Side Panel 已加载');
initTabs();
initSettingsPanel();
renderSites();
renderDropdown();
renderDetected();
renderLogs();
renderConfig();
initLinuxdoReadingHelper();
initLdcCreditTools();
setInterval(renderLogs, 2000);
