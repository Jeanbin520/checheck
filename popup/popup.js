import { getSites, addSite, updateSite, removeSite, getConfig, saveConfig } from '../lib/storage.js';
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
const LINUXDO_UNREAD_STORAGE_KEY = 'linuxdoUnread';
const SETTINGS_PANEL_ID = 'settings-panel';
const LINUXDO_TOPIC_LIMIT = 10;
const LINUXDO_BOARD_UI_STORAGE_KEY = 'linuxdoBoardUi';
const LINUXDO_URLS = {
  home: 'https://linux.do/',
  notifications: 'https://linux.do/notifications',
  messages: 'https://linux.do/my/messages'
};

let linuxdoReadingActiveTabId = null;
let linuxdoReadingActiveTabUrl = '';
let linuxdoReadingSettings = { ...LINUXDO_READING_UI_DEFAULTS };
let lastMainPanelId = 'reading-panel';
let currentPanelId = 'reading-panel';
let showLogsPanel = false;
let linuxdoBoardActiveView = 'latest';
let linuxdoBoardCollapsed = true;
let linuxdoBoardReady = false;
let linuxdoBoardCategoryFilter = 'all';
let linuxdoLatestTopics = [];
let linuxdoTopTopics = [];
let linuxdoBoardCategories = [];
let linuxdoKeywords = [];
let linuxdoKeywordMatches = [];
let linuxdoReadLaterItems = [];
let linuxdoReadLaterFilter = 'all';
let linuxdoReadLaterSearch = '';
let linuxdoCurrentTopic = null;
let linuxdoCurrentResources = { links: [], codeBlocks: [] };
let linuxdoResourceFilter = 'all';
let linuxdoSensitiveRisks = [];
let editingSiteId = null;

const CHECKIN_RULE_TEMPLATES = {
  'generic-button-checkin': '通用按钮签到',
  'new-api-linuxdo-button': 'New API + LinuxDO 按钮签到'
};

const DEFAULT_RULE_VALUES = {
  template: 'generic-button-checkin',
  startPath: '/',
  selector: 'button, a, [role="button"]',
  exactMatchText: '',
  matchText: '签到, 立即签到, checkin, check in',
  excludeText: '每日签到',
  completeText: '今日已签到, 已签到, already checked, checked in',
  linuxdoClientId: '',
  loginPaths: '/login, /signin, /sign-in',
  successUrlIncludes: '/console/personal',
  agreementSelector: 'input[type="checkbox"]',
  closeAnnouncement: true
};

const CHECKIN_RULE_PRESETS = {
  generic: {
    template: 'generic-button-checkin',
    startPath: '/',
    selector: 'button, a, [role="button"]',
    exactMatchText: '',
    matchText: '签到, 立即签到, checkin, check in',
    excludeText: '每日签到, 签到记录, 签到说明',
    completeText: '今日已签到, 已签到, checked in, 签到成功',
    linuxdoClientId: '',
    loginPaths: '/login, /signin, /sign-in',
    successUrlIncludes: '',
    agreementSelector: 'input[type="checkbox"]',
    closeAnnouncement: true
  },
  'new-api-linuxdo': {
    template: 'new-api-linuxdo-button',
    startPath: '/console/personal',
    selector: 'button, a, [role="button"]',
    exactMatchText: '立即签到',
    matchText: '签到, 立即签到, checkin, check in',
    excludeText: '每日签到, 签到记录, 签到说明',
    completeText: '今日已签到, 已签到, checked in, 签到成功',
    linuxdoClientId: '',
    loginPaths: '/login, /signin, /sign-in',
    successUrlIncludes: '/console/personal, /dashboard, /console',
    agreementSelector: 'input[type="checkbox"]',
    closeAnnouncement: true
  },
  chybenzun: {
    siteName: 'CHY公益站',
    siteUrl: 'https://chybenzun.top/',
    template: 'new-api-linuxdo-button',
    startPath: '/profile',
    selector: 'button, a, [role="button"]',
    exactMatchText: '立即签到',
    matchText: '立即签到, 签到, check in now, check-in now',
    excludeText: '每日签到, 签到记录, 签到说明',
    completeText: '今日已签到, 已签到, checked in, 签到成功',
    linuxdoClientId: '',
    loginPaths: '/sign-in, /login, /signin',
    successUrlIncludes: '/profile, /dashboard, /console',
    agreementSelector: 'input[type="checkbox"]',
    closeAnnouncement: true
  }
};

function normalizeReadingSpeedForUi(speed) {
  return speed === 'slow' ? 'randomSlow' : speed;
}

function splitRuleList(value) {
  return String(value || '')
    .split(/[,，\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function joinRuleList(value, fallback = '') {
  if (Array.isArray(value)) return value.join(', ');
  return value || fallback;
}

function getRuleValue(rule, field) {
  if (!rule) return DEFAULT_RULE_VALUES[field] || '';
  if (field === 'matchText') return joinRuleList(rule.matchText || rule.checkinText, DEFAULT_RULE_VALUES.matchText);
  if (field === 'exactMatchText') return joinRuleList(rule.exactMatchText, DEFAULT_RULE_VALUES.exactMatchText);
  if (field === 'excludeText') return joinRuleList(rule.excludeText, DEFAULT_RULE_VALUES.excludeText);
  if (field === 'completeText') return joinRuleList(rule.completeText, DEFAULT_RULE_VALUES.completeText);
  if (field === 'loginPaths') return joinRuleList(rule.loginPaths, DEFAULT_RULE_VALUES.loginPaths);
  if (field === 'successUrlIncludes') return joinRuleList(rule.successUrlIncludes, DEFAULT_RULE_VALUES.successUrlIncludes);
  if (field === 'closeAnnouncement') return rule.closeAnnouncement !== false;
  return rule[field] ?? DEFAULT_RULE_VALUES[field] ?? '';
}

function readRuleFromForm(form) {
  const data = new FormData(form);
  const template = data.get('template') || DEFAULT_RULE_VALUES.template;
  const rule = {
    template,
    startPath: String(data.get('startPath') || DEFAULT_RULE_VALUES.startPath).trim() || DEFAULT_RULE_VALUES.startPath,
    selector: String(data.get('selector') || DEFAULT_RULE_VALUES.selector).trim() || DEFAULT_RULE_VALUES.selector,
    exactMatchText: splitRuleList(data.get('exactMatchText')),
    matchText: splitRuleList(data.get('matchText')),
    excludeText: splitRuleList(data.get('excludeText')),
    completeText: splitRuleList(data.get('completeText'))
  };

  if (template === 'new-api-linuxdo-button') {
    rule.linuxdoClientId = String(data.get('linuxdoClientId') || '').trim();
    rule.loginPaths = splitRuleList(data.get('loginPaths'));
    rule.successUrlIncludes = splitRuleList(data.get('successUrlIncludes'));
    rule.agreementSelector = String(data.get('agreementSelector') || '').trim();
    rule.closeAnnouncement = !!data.get('closeAnnouncement');
  }

  return rule;
}

function getSitePayloadFromForm(form) {
  const data = new FormData(form);
  return {
    name: String(data.get('siteName') || '').trim(),
    url: String(data.get('siteUrl') || '').trim(),
    checkinRule: readRuleFromForm(form)
  };
}

function updateRuleTemplateFields(root = document) {
  const template = root.querySelector('[data-rule-template]')?.value || DEFAULT_RULE_VALUES.template;
  root.querySelectorAll('[data-template-only]').forEach(section => {
    section.hidden = section.dataset.templateOnly !== template;
  });
}

function applyRulePreset(form, presetName) {
  const preset = CHECKIN_RULE_PRESETS[presetName];
  if (!preset) return;

  Object.entries(preset).forEach(([key, value]) => {
    const input = form.querySelector(`[name="${key}"]`);
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = !!value;
    } else {
      input.value = value;
    }
  });

  updateRuleTemplateFields(form);
}

function getTemplateName(template) {
  return CHECKIN_RULE_TEMPLATES[template] || '专用/默认适配器';
}

function renderSiteRuleForm(site) {
  const rule = site.checkinRule || { template: DEFAULT_RULE_VALUES.template };
  const template = rule.template || DEFAULT_RULE_VALUES.template;
  return `
    <form class="site-rule-form site-edit-form" data-site-edit-form="${escapeHtml(site.id)}">
      <label>
        站点名称
        <input name="siteName" type="text" value="${escapeHtml(site.name || '')}" required>
      </label>
      <label>
        站点 URL
        <input name="siteUrl" type="url" value="${escapeHtml(site.url || '')}" required>
      </label>
      <label>
        签到模板
        <select name="template" data-rule-template required>
          <option value="generic-button-checkin" ${template === 'generic-button-checkin' ? 'selected' : ''}>通用按钮签到</option>
          <option value="new-api-linuxdo-button" ${template === 'new-api-linuxdo-button' ? 'selected' : ''}>New API + LinuxDO 按钮签到</option>
        </select>
      </label>
      <label>
        签到页面路径
        <input name="startPath" type="text" placeholder="/profile" value="${escapeHtml(getRuleValue(rule, 'startPath'))}">
        <span class="site-rule-hint">填登录后真正出现签到按钮的页面，例如 <code>/profile</code>、<code>/console/personal</code>、<code>/</code>。</span>
      </label>
      <details class="site-rule-advanced">
        <summary>高级规则（通常不用改）</summary>
        <div class="site-rule-fields">
          <label>
            控件选择器
            <input name="selector" type="text" value="${escapeHtml(getRuleValue(rule, 'selector'))}">
          </label>
          <label>
            精确匹配文字
            <input name="exactMatchText" type="text" value="${escapeHtml(getRuleValue(rule, 'exactMatchText'))}">
          </label>
          <label>
            匹配文字
            <input name="matchText" type="text" value="${escapeHtml(getRuleValue(rule, 'matchText'))}">
          </label>
          <label>
            排除文字
            <input name="excludeText" type="text" value="${escapeHtml(getRuleValue(rule, 'excludeText'))}">
          </label>
          <label>
            完成状态文字
            <input name="completeText" type="text" value="${escapeHtml(getRuleValue(rule, 'completeText'))}">
          </label>
          <div class="new-api-rule-fields" data-template-only="new-api-linuxdo-button" ${template === 'new-api-linuxdo-button' ? '' : 'hidden'}>
          <label>
            LinuxDO client_id
            <input name="linuxdoClientId" type="text" value="${escapeHtml(getRuleValue(rule, 'linuxdoClientId'))}">
          </label>
          <label>
            登录页路径
            <input name="loginPaths" type="text" value="${escapeHtml(getRuleValue(rule, 'loginPaths'))}">
          </label>
          <label>
            授权成功路径
            <input name="successUrlIncludes" type="text" value="${escapeHtml(getRuleValue(rule, 'successUrlIncludes'))}">
          </label>
          <label>
            协议复选框选择器
            <input name="agreementSelector" type="text" value="${escapeHtml(getRuleValue(rule, 'agreementSelector'))}">
          </label>
          <label class="site-rule-checkbox">
            <input name="closeAnnouncement" type="checkbox" ${getRuleValue(rule, 'closeAnnouncement') ? 'checked' : ''}>
            自动关闭公告
          </label>
          </div>
        </div>
      </details>
      <div class="site-rule-actions">
        <button class="btn-secondary" type="submit">保存</button>
        <button class="btn-secondary" type="button" data-site-cancel-edit="${escapeHtml(site.id)}">取消</button>
      </div>
    </form>
  `;
}

async function renderSites() {
  const sites = await getSites();
  const list = $('#site-list');
  list.innerHTML = '';

  if (sites.length === 0) {
    list.innerHTML = '<li style="text-align:center;color:#999;padding:20px;">暂无站点，请从下拉列表添加</li>';
    return;
  }

  for (const site of sites) {
    const enabled = site.enabled !== false;
    const li = document.createElement('li');
    li.className = `site-item site-item-editable ${enabled ? '' : 'site-disabled'}`;
    li.innerHTML = `
      <div class="site-info">
        <div class="site-name">${escapeHtml(site.name)}</div>
        <div class="site-url">${escapeHtml(site.url)}</div>
        <div class="site-rule-badge">${site.checkinRule ? escapeHtml(getTemplateName(site.checkinRule.template)) : '专用/默认适配器'}</div>
        ${enabled ? '' : '<div class="site-status muted">已停用：一键签到会跳过</div>'}
        ${site.lastStatus ? `<div class="site-status ${site.lastStatus.success ? 'success' : 'fail'}">${escapeHtml(site.lastStatus.message)}</div>` : ''}
        ${editingSiteId === site.id ? renderSiteRuleForm(site) : ''}
      </div>
      <div class="site-actions">
        <div class="site-enable-toggle" title="关闭后，一键签到会跳过该站点">
          <span>启用</span>
          <label class="reading-switch site-switch">
            <input type="checkbox" data-site-enabled="${escapeHtml(site.id)}" ${enabled ? 'checked' : ''}>
            <span></span>
          </label>
        </div>
        <button class="btn-secondary" type="button" data-site-edit="${escapeHtml(site.id)}">编辑</button>
        <button class="btn-delete" type="button" data-site-delete="${escapeHtml(site.id)}" title="删除">✕</button>
      </div>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll('[data-rule-template]').forEach(select => {
    select.addEventListener('change', () => updateRuleTemplateFields(select.closest('form')));
  });

  list.querySelectorAll('[data-site-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingSiteId = btn.dataset.siteEdit;
      renderSites();
    });
  });

  list.querySelectorAll('[data-site-cancel-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingSiteId = null;
      renderSites();
    });
  });

  list.querySelectorAll('[data-site-enabled]').forEach(input => {
    input.addEventListener('change', async () => {
      await updateSite(input.dataset.siteEnabled, { enabled: input.checked });
      renderSites();
    });
  });

  list.querySelectorAll('[data-site-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const site = sites.find(item => item.id === btn.dataset.siteDelete);
      if (!confirm(`确定删除「${site?.name || '该站点'}」吗？`)) return;
      await removeSite(btn.dataset.siteDelete);
      if (editingSiteId === btn.dataset.siteDelete) editingSiteId = null;
      renderSites();
      renderDropdown();
    });
  });

  list.querySelectorAll('[data-site-edit-form]').forEach(form => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await updateSite(form.dataset.siteEditForm, getSitePayloadFromForm(form));
        editingSiteId = null;
        renderSites();
        renderDropdown();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

async function renderDropdown() {
  const sites = await getSites();
  const addedUrls = new Set(sites.map(s => {
    try {
      const url = new URL(s.url);
      url.hash = '';
      return url.href;
    } catch {
      return s.url;
    }
  }));
  const select = $('#site-select');

  select.innerHTML = '<option value="">-- 选择站点 --</option>';

  for (const preset of PRESET_SITES) {
    let presetUrl = preset.url;
    try {
      const url = new URL(preset.url);
      url.hash = '';
      presetUrl = url.href;
    } catch {}
    if (addedUrls.has(presetUrl)) continue;
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
  currentPanelId = panelId;

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

  updateLogSectionVisibility();

  if (panelId === 'reading-panel') {
    refreshLinuxdoReadingHelper();
    loadStoredLdcCredit();
    refreshLinuxdoDashboard({ silent: true });
  }
  if (panelId === 'checkin-panel') {
    renderLogs();
  }
}

// 运行日志面板：仅在阅读/签到面板显示，且受设置开关控制（设置面板始终不显示）
function updateLogSectionVisibility() {
  const section = $('#log-section');
  if (!section) return;
  const allowedPanels = currentPanelId === 'reading-panel' || currentPanelId === 'checkin-panel';
  const shouldShow = showLogsPanel && allowedPanels;
  section.hidden = !shouldShow;
  if (shouldShow) {
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
  // 抓不到真实数据时给出可操作的提示，而不是显示误导性的 0。
  let message;
  if (state.ok) {
    message = state.message || '已刷新';
  } else if (state.status === 'cloudflare') {
    message = 'LDC 页面需完成 Cloudflare 验证，已打开页面请处理';
  } else if (state.status === 'login-required') {
    message = '需先登录 credit.linux.do，已打开页面请登录';
  } else if (state.status === 'need-start') {
    message = '请在 LDC 页面点击“立即开始”';
  } else if (state.status === 'no-data') {
    message = '未抓取到数据，已打开 LDC 页面，可手动确认';
  } else {
    message = state.message || '读取失败';
  }
  statusText.textContent = timeText ? `${message} · ${timeText}` : message;
}

async function loadStoredLdcCredit() {
  const result = await chrome.storage.local.get(LDC_CREDIT_STORAGE_KEY);
  renderLdcCredit(result[LDC_CREDIT_STORAGE_KEY]);
}

function renderLinuxdoUnread(state) {
  const button = $('#linuxdo-unread');
  const countText = $('#linuxdo-unread-count');
  if (!button || !countText) return;

  const count = Math.max(0, Math.floor(Number(state?.count) || 0));
  button.hidden = count <= 0;
  countText.textContent = count > 99 ? '99+' : String(count);
}

async function loadLinuxdoUnread() {
  const result = await chrome.storage.local.get(LINUXDO_UNREAD_STORAGE_KEY);
  renderLinuxdoUnread(result[LINUXDO_UNREAD_STORAGE_KEY]);
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

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  }
}

function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getLinuxdoDashboardElements() {
  return {
    statusText: $('#linuxdo-status'),
    unreadText: $('#linuxdo-status-unread'),
    messagesText: $('#linuxdo-status-messages'),
    boardStatusText: $('#linuxdo-board-status'),
    refreshButton: $('#linuxdo-refresh-board'),
    boardRefreshButton: $('#linuxdo-board-refresh'),
    boardBody: $('#linuxdo-board-body'),
    boardToggle: $('#linuxdo-board-toggle'),
    categorySelect: $('#linuxdo-board-category'),
    latestList: $('#linuxdo-latest-topics'),
    topList: $('#linuxdo-top-topics')
  };
}

function getTopicCategoryValue(topic) {
  return String(topic?.categoryName || '').trim() || '未分类';
}

function getTopicCategoryFilterValue(topic) {
  if (topic?.categoryId != null) return String(topic.categoryId);
  return `name:${getTopicCategoryValue(topic)}`;
}

function getAllLinuxdoBoardCategories() {
  if (linuxdoBoardCategories.length > 0) {
    return linuxdoBoardCategories.map(category => ({
      value: String(category.id),
      label: category.name || category.slug || `分类 ${category.id}`
    }));
  }

  const categories = new Map();
  [...linuxdoLatestTopics, ...linuxdoTopTopics].forEach(topic => {
    const label = getTopicCategoryValue(topic);
    categories.set(getTopicCategoryFilterValue(topic), label);
  });
  return Array.from(categories, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function getFilteredLinuxdoTopics(topics) {
  if (linuxdoBoardCategoryFilter === 'all') return topics;
  return topics.filter(topic => (
    getTopicCategoryFilterValue(topic) === linuxdoBoardCategoryFilter ||
    getTopicCategoryValue(topic) === linuxdoBoardCategoryFilter
  ));
}

function getLinuxdoCategoryFilterLabel() {
  if (linuxdoBoardCategoryFilter === 'all') return '全部类别';
  const matched = getAllLinuxdoBoardCategories().find(category => category.value === linuxdoBoardCategoryFilter);
  if (matched) return matched.label;
  if (linuxdoBoardCategoryFilter.startsWith('name:')) return linuxdoBoardCategoryFilter.slice(5);
  return linuxdoBoardCategoryFilter;
}

function renderLinuxdoCategoryFilter() {
  const { categorySelect } = getLinuxdoDashboardElements();
  if (!categorySelect) return;

  const categories = getAllLinuxdoBoardCategories();
  const values = new Set(['all', ...categories.map(category => category.value)]);
  if (!values.has(linuxdoBoardCategoryFilter)) {
    categories.push({
      value: linuxdoBoardCategoryFilter,
      label: getLinuxdoCategoryFilterLabel()
    });
  }

  categorySelect.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = '全部类别';
  categorySelect.appendChild(allOption);

  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category.value;
    option.textContent = category.label;
    categorySelect.appendChild(option);
  });
  categorySelect.value = linuxdoBoardCategoryFilter;
}

function renderLinuxdoBoardCollapsedState() {
  const { boardBody, boardToggle } = getLinuxdoDashboardElements();
  const effectiveCollapsed = !linuxdoBoardReady || linuxdoBoardCollapsed;
  if (boardBody) boardBody.hidden = effectiveCollapsed;
  if (boardToggle) {
    boardToggle.disabled = !linuxdoBoardReady;
    boardToggle.textContent = effectiveCollapsed ? '⌄' : '⌃';
    boardToggle.setAttribute('aria-label', effectiveCollapsed ? '展开社区看板' : '折叠社区看板');
    boardToggle.setAttribute('aria-expanded', effectiveCollapsed ? 'false' : 'true');
    boardToggle.title = linuxdoBoardReady ? (effectiveCollapsed ? '展开社区看板' : '折叠社区看板') : '刷新成功后可展开';
  }
}

async function saveLinuxdoBoardUiState() {
  await chrome.storage.local.set({
    [LINUXDO_BOARD_UI_STORAGE_KEY]: {
      collapsed: linuxdoBoardCollapsed,
      categoryFilter: linuxdoBoardCategoryFilter,
      activeView: linuxdoBoardActiveView
    }
  });
}

async function loadLinuxdoBoardUiState() {
  const result = await chrome.storage.local.get({
    [LINUXDO_BOARD_UI_STORAGE_KEY]: {
      collapsed: true,
      categoryFilter: 'all',
      activeView: 'latest'
    }
  });
  const state = result[LINUXDO_BOARD_UI_STORAGE_KEY] || {};
  linuxdoBoardCollapsed = !!state.collapsed;
  linuxdoBoardCategoryFilter = state.categoryFilter || 'all';
  linuxdoBoardActiveView = state.activeView === 'top' ? 'top' : 'latest';
  renderLinuxdoBoardCollapsedState();
  renderLinuxdoCategoryFilter();
}

function formatTopicTime(timestamp) {
  if (!timestamp) return '--';
  const diffMs = Date.now() - Number(timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return '刚刚';
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;

  try {
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    return '--';
  }
}

function formatTopicNumber(value) {
  const number = Number(value) || 0;
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  if (number >= 1000) return `${(number / 1000).toFixed(1)}k`;
  return String(number);
}

function normalizeTopicTagForUi(tag) {
  if (typeof tag === 'string') return tag.trim();
  if (tag == null) return '';
  if (typeof tag === 'object') {
    return String(tag.name || tag.text || tag.slug || tag.id || '').trim();
  }
  return String(tag).trim();
}

function renderLinuxdoUserStatus(state) {
  const { statusText, unreadText, messagesText } = getLinuxdoDashboardElements();
  if (!statusText || !unreadText || !messagesText) return;

  if (!state) {
    statusText.textContent = '尚未刷新';
    unreadText.textContent = '--';
    messagesText.textContent = '--';
    return;
  }

  unreadText.textContent = String(Math.max(0, Number(state.unreadCount) || 0));
  messagesText.textContent = String(Math.max(0, Number(state.privateMessageCount) || 0));

  const timeText = formatLdcTime(state.updatedAt);
  if (!state.ok) {
    statusText.textContent = `状态读取失败：${state.message || '请打开网页确认'}${timeText ? ` · ${timeText}` : ''}`;
    return;
  }

  if (!state.loggedIn) {
    statusText.textContent = `未登录或登录态不可用，可打开 Linux.do 登录${timeText ? ` · ${timeText}` : ''}`;
    return;
  }

  const name = state.username ? ` @${state.username}` : '';
  statusText.textContent = `已登录${name}${timeText ? ` · ${timeText}` : ''}`;
}

function renderLinuxdoTopicList(container, topics, emptyText) {
  if (!container) return;
  if (!Array.isArray(topics) || topics.length === 0) {
    container.innerHTML = `<div class="linuxdo-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }

  container.innerHTML = topics.map(topic => {
    const tags = (topic.tags || [])
      .map(normalizeTopicTagForUi)
      .filter(Boolean)
      .slice(0, 3)
      .map(tag => `<span class="linuxdo-tag">#${escapeHtml(tag)}</span>`)
      .join('');
    const category = topic.categoryName ? `<span>${escapeHtml(topic.categoryName)}</span>` : '';
    const author = topic.lastPosterUsername ? `<span>@${escapeHtml(topic.lastPosterUsername)}</span>` : '';
    const updatedAt = formatTopicTime(topic.bumpedAt || topic.lastPostedAt);

    return `
      <article class="linuxdo-topic-card">
        <div class="linuxdo-topic-title-row">
          <button class="linuxdo-topic-title" type="button" data-linuxdo-open-url="${escapeHtml(topic.url)}">
            ${escapeHtml(topic.title)}
          </button>
          <button class="linuxdo-topic-icon-button linuxdo-read-later" type="button" data-linuxdo-read-later-id="${escapeHtml(topic.id)}" aria-label="加入稍后读" title="加入稍后读">＋</button>
        </div>
        <div class="linuxdo-topic-meta">
          ${category}
          ${author}
          <span>${formatTopicNumber(topic.replyCount)} 回复</span>
          <span>${formatTopicNumber(topic.views)} 浏览</span>
          <span>${escapeHtml(updatedAt)}</span>
        </div>
        ${tags ? `<div class="linuxdo-topic-tags">${tags}</div>` : ''}
      </article>
    `;
  }).join('');
}

function renderLinuxdoBoardLists(latestEmptyText = '暂无最新主题', topEmptyText = '暂无今日热门') {
  const { latestList, topList } = getLinuxdoDashboardElements();
  const suffix = linuxdoBoardCategoryFilter === 'all' ? '' : `（${getLinuxdoCategoryFilterLabel()}）`;

  renderLinuxdoCategoryFilter();
  renderLinuxdoTopicList(
    latestList,
    getFilteredLinuxdoTopics(linuxdoLatestTopics),
    linuxdoBoardCategoryFilter === 'all' ? latestEmptyText : `当前类别暂无最新主题${suffix}`
  );
  renderLinuxdoTopicList(
    topList,
    getFilteredLinuxdoTopics(linuxdoTopTopics),
    linuxdoBoardCategoryFilter === 'all' ? topEmptyText : `当前类别暂无今日热门${suffix}`
  );
  switchLinuxdoBoard(linuxdoBoardActiveView);
}

function mergeLinuxdoCategories(...categoryLists) {
  const categoryMap = new Map();
  categoryLists.flat().filter(Boolean).forEach(category => {
    if (category?.id == null) return;
    categoryMap.set(String(category.id), category);
  });
  return Array.from(categoryMap.values())
    .sort((a, b) => Number(a.position || 9999) - Number(b.position || 9999) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
}

function hasLinuxdoBoardPayload(response) {
  if (!response?.ok) return false;
  return Array.isArray(response.topics) || Array.isArray(response.categories);
}

function renderLinuxdoBoardResponse(latestResponse, topResponse) {
  const { boardStatusText } = getLinuxdoDashboardElements();

  linuxdoBoardReady = hasLinuxdoBoardPayload(latestResponse) || hasLinuxdoBoardPayload(topResponse);
  linuxdoLatestTopics = latestResponse?.ok ? latestResponse.topics || [] : [];
  linuxdoTopTopics = topResponse?.ok ? topResponse.topics || [] : [];
  linuxdoBoardCategories = mergeLinuxdoCategories(
    latestResponse?.categories || [],
    topResponse?.categories || []
  );

  renderLinuxdoBoardLists(
    latestResponse?.message ? `最新主题读取失败：${latestResponse.message}` : '暂无最新主题',
    topResponse?.message ? `热门主题读取失败：${topResponse.message}` : '暂无今日热门'
  );
  renderLinuxdoBoardCollapsedState();

  if (boardStatusText) {
    if (latestResponse?.ok || topResponse?.ok) {
      const updatedAt = latestResponse?.updatedAt || topResponse?.updatedAt;
      const timeText = formatLdcTime(updatedAt);
      const usedFallback = latestResponse?.source === 'tab-fallback' || topResponse?.source === 'tab-fallback';
      boardStatusText.textContent = `已刷新${usedFallback ? '（通过 Linux.do 页面兜底）' : ''}${timeText ? ` · ${timeText}` : ''}`;
    } else {
      boardStatusText.textContent = `Linux.do 暂时无法读取：${latestResponse?.message || topResponse?.message || '请打开网页确认'}`;
    }
  }
}

function setLinuxdoBoardLoading(loading) {
  const { refreshButton, boardRefreshButton, boardStatusText } = getLinuxdoDashboardElements();
  if (refreshButton) {
    refreshButton.disabled = loading;
    refreshButton.textContent = loading ? '…' : '↻';
    refreshButton.setAttribute('aria-label', loading ? '正在刷新 Linux.do 状态和社区看板' : '刷新 Linux.do 状态和社区看板');
    refreshButton.title = loading ? '正在刷新 Linux.do 状态和社区看板' : '刷新 Linux.do 状态和社区看板';
  }
  if (boardRefreshButton) {
    boardRefreshButton.disabled = loading;
    boardRefreshButton.textContent = loading ? '…' : '↻';
    boardRefreshButton.setAttribute('aria-label', loading ? '正在刷新社区看板' : '刷新社区看板');
    boardRefreshButton.title = loading ? '正在刷新社区看板' : '刷新社区看板';
  }
  if (loading && boardStatusText) {
    boardStatusText.textContent = '正在读取 Linux.do 社区主题...';
  }
}

async function refreshLinuxdoDashboard({ silent = false } = {}) {
  if (!silent) setLinuxdoBoardLoading(true);

  try {
    const [userStatus, latestResponse, topResponse] = await Promise.all([
      sendRuntimeMessage({ action: 'linuxdoGetCurrentUser' }),
      sendRuntimeMessage({ action: 'linuxdoGetLatestTopics', limit: LINUXDO_TOPIC_LIMIT }),
      sendRuntimeMessage({ action: 'linuxdoGetTopTopics', period: 'daily', limit: LINUXDO_TOPIC_LIMIT })
    ]);

    renderLinuxdoUserStatus(userStatus);
    if (userStatus?.ok) {
      renderLinuxdoUnread({ count: userStatus.unreadCount });
    }
    renderLinuxdoBoardResponse(latestResponse, topResponse);
    loadLinuxdoKeywords().catch(() => {});
  } catch (error) {
    renderLinuxdoUserStatus({
      ok: false,
      loggedIn: false,
      unreadCount: 0,
      privateMessageCount: 0,
      message: error.message,
      updatedAt: Date.now()
    });
    renderLinuxdoBoardResponse(
      { ok: false, topics: [], message: error.message },
      { ok: false, topics: [], message: error.message }
    );
  } finally {
    setLinuxdoBoardLoading(false);
  }
}

async function openLinuxdoUrl(url) {
  await sendRuntimeMessage({ action: 'linuxdoOpenUrl', url });
}

function findLinuxdoBoardTopic(topicId) {
  return [...linuxdoLatestTopics, ...linuxdoTopTopics]
    .find(topic => String(topic.id) === String(topicId));
}

async function addLinuxdoTopicReadLater(topicId, button) {
  const topic = findLinuxdoBoardTopic(topicId);
  if (!topic) throw new Error('未找到主题数据，请刷新后重试');

  if (button) {
    button.disabled = true;
    button.textContent = '…';
  }

  try {
    const response = await sendRuntimeMessage({
      action: 'linuxdoAddReadLater',
      topic
    });
    if (!response?.ok) {
      throw new Error(response?.message || '保存失败');
    }
    if (button) {
      button.textContent = '✓';
      button.title = response.created ? '已加入稍后读' : '已更新稍后读';
      setTimeout(() => {
        button.disabled = false;
        button.textContent = '＋';
        button.title = '加入稍后读';
      }, 1400);
    }
    loadLinuxdoReadLater().catch(() => {});
  } catch (error) {
    if (button) {
      button.textContent = '!';
      button.title = error.message;
      setTimeout(() => {
        button.disabled = false;
        button.textContent = '＋';
        button.title = '加入稍后读';
      }, 1800);
    }
    throw error;
  }
}

function switchLinuxdoBoard(view) {
  linuxdoBoardActiveView = view === 'top' ? 'top' : 'latest';
  document.querySelectorAll('.linuxdo-board-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.linuxdoBoard === linuxdoBoardActiveView);
  });

  const { latestList, topList } = getLinuxdoDashboardElements();
  if (latestList) latestList.hidden = linuxdoBoardActiveView !== 'latest';
  if (topList) topList.hidden = linuxdoBoardActiveView !== 'top';
}

async function initLinuxdoDashboard() {
  const { refreshButton, boardRefreshButton, latestList, topList, boardToggle, categorySelect } = getLinuxdoDashboardElements();
  if (refreshButton) refreshButton.addEventListener('click', () => refreshLinuxdoDashboard());
  if (boardRefreshButton) boardRefreshButton.addEventListener('click', () => refreshLinuxdoDashboard());
  if (boardToggle) {
    boardToggle.addEventListener('click', async () => {
      if (!linuxdoBoardReady) return;
      linuxdoBoardCollapsed = !linuxdoBoardCollapsed;
      renderLinuxdoBoardCollapsedState();
      await saveLinuxdoBoardUiState();
    });
  }
  if (categorySelect) {
    categorySelect.addEventListener('change', async () => {
      linuxdoBoardCategoryFilter = categorySelect.value || 'all';
      renderLinuxdoBoardLists();
      await saveLinuxdoBoardUiState();
    });
  }

  $('#linuxdo-open-home')?.addEventListener('click', () => openLinuxdoUrl(LINUXDO_URLS.home).catch(console.error));
  $('#linuxdo-open-notifications')?.addEventListener('click', () => openLinuxdoUrl(LINUXDO_URLS.notifications).catch(console.error));
  $('#linuxdo-open-messages')?.addEventListener('click', () => openLinuxdoUrl(LINUXDO_URLS.messages).catch(console.error));

  document.querySelectorAll('.linuxdo-board-tab').forEach(button => {
    button.addEventListener('click', async () => {
      switchLinuxdoBoard(button.dataset.linuxdoBoard);
      await saveLinuxdoBoardUiState();
    });
  });

  [latestList, topList].forEach(list => {
    list?.addEventListener('click', (event) => {
      const readLaterTarget = event.target.closest('[data-linuxdo-read-later-id]');
      if (readLaterTarget) {
        addLinuxdoTopicReadLater(readLaterTarget.dataset.linuxdoReadLaterId, readLaterTarget).catch(console.error);
        return;
      }

      const target = event.target.closest('[data-linuxdo-open-url]');
      const url = target?.dataset?.linuxdoOpenUrl;
      if (url) openLinuxdoUrl(url).catch(console.error);
    });
  });

  await loadLinuxdoBoardUiState();
  switchLinuxdoBoard(linuxdoBoardActiveView);
  refreshLinuxdoDashboard({ silent: true });
}

function getLinuxdoKeywordElements() {
  return {
    form: $('#linuxdo-keyword-form'),
    input: $('#linuxdo-keyword-input'),
    refreshButton: $('#linuxdo-keyword-refresh'),
    statusText: $('#linuxdo-keyword-status'),
    keywordList: $('#linuxdo-keyword-list'),
    matchesList: $('#linuxdo-keyword-matches')
  };
}

function renderLinuxdoKeywords() {
  const { keywordList, matchesList, statusText } = getLinuxdoKeywordElements();
  if (keywordList) {
    if (!linuxdoKeywords.length) {
      keywordList.innerHTML = '<div class="linuxdo-empty">还没有关键词，先添加一个你关心的话题吧。</div>';
    } else {
      keywordList.innerHTML = linuxdoKeywords.map(keyword => `
        <span class="linuxdo-chip ${keyword.enabled ? '' : 'disabled'}">
          ${escapeHtml(keyword.text)}
          <button type="button" data-linuxdo-keyword-toggle="${escapeHtml(keyword.id)}" title="${keyword.enabled ? '禁用' : '启用'}">${keyword.enabled ? '●' : '○'}</button>
          <button type="button" data-linuxdo-keyword-delete="${escapeHtml(keyword.id)}" title="删除">×</button>
        </span>
      `).join('');
    }
  }

  if (matchesList) {
    const visibleMatches = linuxdoKeywordMatches.filter(match => match.status !== 'ignored').slice(0, 30);
    if (!visibleMatches.length) {
      matchesList.innerHTML = '<div class="linuxdo-empty">暂无关键词命中。</div>';
    } else {
      matchesList.innerHTML = visibleMatches.map(match => `
        <article class="linuxdo-list-item">
          <button class="linuxdo-list-title" type="button" data-linuxdo-open-url="${escapeHtml(match.url)}">${escapeHtml(match.title)}</button>
          <div class="linuxdo-list-meta">
            <span>关键词：${escapeHtml(match.keyword)}</span>
            <span>${escapeHtml(match.categoryName || '未分类')}</span>
            <span>${match.status === 'read' ? '已读' : '未读'}</span>
          </div>
          <div class="linuxdo-list-actions">
            <button class="btn-secondary" type="button" data-linuxdo-match-status="${escapeHtml(match.id)}" data-status="read">已读</button>
            <button class="btn-secondary" type="button" data-linuxdo-match-status="${escapeHtml(match.id)}" data-status="ignored">忽略</button>
            <button class="btn-secondary" type="button" data-linuxdo-open-url="${escapeHtml(match.url)}">打开</button>
          </div>
        </article>
      `).join('');
    }
  }

  if (statusText) {
    const unread = linuxdoKeywordMatches.filter(match => match.status === 'unread').length;
    statusText.textContent = `已配置 ${linuxdoKeywords.length} 个关键词，${unread} 条未读命中`;
  }
}

async function loadLinuxdoKeywords() {
  const response = await sendRuntimeMessage({ action: 'linuxdoGetKeywords' });
  linuxdoKeywords = response?.keywords || [];
  linuxdoKeywordMatches = response?.matches || [];
  renderLinuxdoKeywords();
}

async function refreshLinuxdoKeywordMatchesUi() {
  const { refreshButton, statusText } = getLinuxdoKeywordElements();
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = '…';
  }
  if (statusText) statusText.textContent = '正在扫描最新主题...';
  try {
    const response = await sendRuntimeMessage({ action: 'linuxdoRefreshKeywordMatches', limit: 50 });
    if (!response?.ok) throw new Error(response?.message || '刷新失败');
    linuxdoKeywords = response.keywords || [];
    linuxdoKeywordMatches = response.matches || [];
    renderLinuxdoKeywords();
    if (statusText) statusText.textContent = `已扫描 ${response.topicCount || 0} 个主题，新增 ${response.created || 0} 条命中`;
  } catch (error) {
    if (statusText) statusText.textContent = `关键词刷新失败：${error.message}`;
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = '刷新命中';
    }
  }
}

function initLinuxdoKeywords() {
  const { form, input, refreshButton, keywordList, matchesList } = getLinuxdoKeywordElements();
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input?.value.trim();
    if (!text) return;
    const response = await sendRuntimeMessage({ action: 'linuxdoSaveKeyword', text, enabled: true });
    if (response?.ok) {
      if (input) input.value = '';
      await loadLinuxdoKeywords();
    }
  });
  refreshButton?.addEventListener('click', refreshLinuxdoKeywordMatchesUi);
  keywordList?.addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-linuxdo-keyword-toggle]');
    const remove = event.target.closest('[data-linuxdo-keyword-delete]');
    if (toggle) {
      const keyword = linuxdoKeywords.find(item => item.id === toggle.dataset.linuxdoKeywordToggle);
      if (!keyword) return;
      await sendRuntimeMessage({ action: 'linuxdoSaveKeyword', keyword: { ...keyword, enabled: !keyword.enabled } });
      await loadLinuxdoKeywords();
    }
    if (remove) {
      await sendRuntimeMessage({ action: 'linuxdoDeleteKeyword', id: remove.dataset.linuxdoKeywordDelete });
      await loadLinuxdoKeywords();
    }
  });
  matchesList?.addEventListener('click', async (event) => {
    const statusButton = event.target.closest('[data-linuxdo-match-status]');
    if (statusButton) {
      await sendRuntimeMessage({
        action: 'linuxdoUpdateKeywordMatchStatus',
        id: statusButton.dataset.linuxdoMatchStatus,
        status: statusButton.dataset.status
      });
      await loadLinuxdoKeywords();
      return;
    }
    const openTarget = event.target.closest('[data-linuxdo-open-url]');
    if (openTarget?.dataset?.linuxdoOpenUrl) openLinuxdoUrl(openTarget.dataset.linuxdoOpenUrl).catch(console.error);
  });
  loadLinuxdoKeywords().catch(console.error);
}

function getLinuxdoReadLaterElements() {
  return {
    statusText: $('#linuxdo-read-later-status'),
    refreshButton: $('#linuxdo-read-later-refresh'),
    list: $('#linuxdo-read-later-list'),
    searchInput: $('#linuxdo-read-later-search'),
    filterSelect: $('#linuxdo-read-later-filter'),
    exportMarkdownButton: $('#linuxdo-read-later-export-md'),
    exportJsonButton: $('#linuxdo-read-later-export-json')
  };
}

function getFilteredReadLaterItems() {
  const needle = linuxdoReadLaterSearch.trim().toLowerCase();
  return linuxdoReadLaterItems.filter(item => {
    const statusMatched = linuxdoReadLaterFilter === 'all' || item.status === linuxdoReadLaterFilter;
    if (!statusMatched) return false;
    if (!needle) return true;
    return [
      item.title,
      item.url,
      item.categoryName,
      item.note,
      ...(item.tags || []),
      ...(item.customTags || [])
    ].join(' ').toLowerCase().includes(needle);
  });
}

function renderLinuxdoReadLater() {
  const { list, statusText } = getLinuxdoReadLaterElements();
  const items = getFilteredReadLaterItems();
  if (statusText) statusText.textContent = `共 ${linuxdoReadLaterItems.length} 条收藏，当前显示 ${items.length} 条`;
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="linuxdo-empty">暂无稍后读条目。</div>';
    return;
  }

  list.innerHTML = items.map(item => `
    <article class="linuxdo-list-item" data-read-later-item="${escapeHtml(item.id)}">
      <button class="linuxdo-list-title" type="button" data-linuxdo-open-url="${escapeHtml(item.url)}">${escapeHtml(item.title)}</button>
      <div class="linuxdo-list-meta">
        <span>${escapeHtml(item.categoryName || '未分类')}</span>
        <span>${escapeHtml(item.status || 'unread')}</span>
        <span>${formatLdcTime(item.updatedAt) || '--'}</span>
      </div>
      <div class="linuxdo-read-later-edit">
        <textarea data-read-later-note="${escapeHtml(item.id)}" placeholder="私人备注">${escapeHtml(item.note || '')}</textarea>
        <input data-read-later-tags="${escapeHtml(item.id)}" type="text" placeholder="自定义标签，用逗号分隔" value="${escapeHtml((item.customTags || []).join(', '))}">
        <select data-read-later-status="${escapeHtml(item.id)}">
          <option value="unread" ${item.status === 'unread' ? 'selected' : ''}>未读</option>
          <option value="read" ${item.status === 'read' ? 'selected' : ''}>已读</option>
          <option value="archived" ${item.status === 'archived' ? 'selected' : ''}>归档</option>
        </select>
      </div>
      <div class="linuxdo-list-actions">
        <button class="btn-secondary" type="button" data-read-later-save="${escapeHtml(item.id)}">保存</button>
        <button class="btn-secondary" type="button" data-linuxdo-open-url="${escapeHtml(item.url)}">打开</button>
        <button class="btn-secondary" type="button" data-read-later-remove="${escapeHtml(item.id)}">移除</button>
      </div>
    </article>
  `).join('');
}

async function loadLinuxdoReadLater() {
  const response = await sendRuntimeMessage({ action: 'linuxdoListReadLater' });
  linuxdoReadLaterItems = response?.items || [];
  renderLinuxdoReadLater();
}

function getReadLaterPatch(id) {
  const note = document.querySelector(`[data-read-later-note="${CSS.escape(id)}"]`)?.value || '';
  const customTags = (document.querySelector(`[data-read-later-tags="${CSS.escape(id)}"]`)?.value || '')
    .split(/[,，]/)
    .map(item => item.trim())
    .filter(Boolean);
  const status = document.querySelector(`[data-read-later-status="${CSS.escape(id)}"]`)?.value || 'unread';
  return { note, customTags, status };
}

async function exportLinuxdoReadLaterUi(format) {
  const response = await sendRuntimeMessage({ action: 'linuxdoExportReadLater', format });
  if (!response?.ok) throw new Error(response?.message || '导出失败');
  downloadTextFile(response.filename || `linuxdo-read-later.${format === 'json' ? 'json' : 'md'}`, response.content || '', format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8');
}

function initLinuxdoReadLater() {
  const { refreshButton, list, searchInput, filterSelect, exportMarkdownButton, exportJsonButton } = getLinuxdoReadLaterElements();
  refreshButton?.addEventListener('click', () => loadLinuxdoReadLater().catch(console.error));
  searchInput?.addEventListener('input', () => {
    linuxdoReadLaterSearch = searchInput.value || '';
    renderLinuxdoReadLater();
  });
  filterSelect?.addEventListener('change', () => {
    linuxdoReadLaterFilter = filterSelect.value || 'all';
    renderLinuxdoReadLater();
  });
  exportMarkdownButton?.addEventListener('click', () => exportLinuxdoReadLaterUi('markdown').catch(console.error));
  exportJsonButton?.addEventListener('click', () => exportLinuxdoReadLaterUi('json').catch(console.error));
  list?.addEventListener('click', async (event) => {
    const save = event.target.closest('[data-read-later-save]');
    const remove = event.target.closest('[data-read-later-remove]');
    const open = event.target.closest('[data-linuxdo-open-url]');
    if (save) {
      await sendRuntimeMessage({ action: 'linuxdoUpdateReadLater', id: save.dataset.readLaterSave, patch: getReadLaterPatch(save.dataset.readLaterSave) });
      await loadLinuxdoReadLater();
      return;
    }
    if (remove) {
      await sendRuntimeMessage({ action: 'linuxdoRemoveReadLater', id: remove.dataset.readLaterRemove });
      await loadLinuxdoReadLater();
      return;
    }
    if (open?.dataset?.linuxdoOpenUrl) openLinuxdoUrl(open.dataset.linuxdoOpenUrl).catch(console.error);
  });
  loadLinuxdoReadLater().catch(console.error);
}

function getLinuxdoCurrentTopicElements() {
  return {
    statusText: $('#linuxdo-current-topic-status'),
    card: $('#linuxdo-current-topic-card'),
    refreshButton: $('#linuxdo-current-topic-refresh'),
    addButton: $('#linuxdo-current-add-read-later'),
    quoteButton: $('#linuxdo-current-copy-quote'),
    extractButton: $('#linuxdo-current-extract'),
    resourceFilter: $('#linuxdo-resource-filter'),
    resourceCopyButton: $('#linuxdo-resource-copy'),
    resourceList: $('#linuxdo-resource-list')
  };
}

async function sendActiveLinuxdoContentMessage(message) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !isLinuxdoUrl(tab.url)) throw new Error('当前活动标签页不是 Linux.do 页面');
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/linuxdo-reading-helper.js'] });
    await new Promise(resolve => setTimeout(resolve, 150));
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

function renderLinuxdoCurrentTopic() {
  const { statusText, card, addButton, quoteButton, extractButton } = getLinuxdoCurrentTopicElements();
  const usable = !!(linuxdoCurrentTopic?.ok && linuxdoCurrentTopic.isTopicPage && linuxdoCurrentTopic.topicId);
  if (addButton) addButton.disabled = !usable;
  if (quoteButton) quoteButton.disabled = !usable;
  if (extractButton) extractButton.disabled = !usable;

  if (!card) return;
  if (!linuxdoCurrentTopic) {
    card.innerHTML = '<div class="linuxdo-empty">点击刷新读取当前活动标签页。</div>';
    return;
  }
  if (!linuxdoCurrentTopic.isTopicPage) {
    card.innerHTML = `<div class="linuxdo-empty">${escapeHtml(linuxdoCurrentTopic.message || '当前标签页不是 Linux.do 主题页。')}</div>`;
    if (statusText) statusText.textContent = linuxdoCurrentTopic.message || '请切换到 Linux.do 主题页';
    return;
  }
  card.innerHTML = `
    <button class="linuxdo-list-title" type="button" data-linuxdo-open-url="${escapeHtml(linuxdoCurrentTopic.canonicalUrl || linuxdoCurrentTopic.url)}">${escapeHtml(linuxdoCurrentTopic.title || '未命名主题')}</button>
    <div class="linuxdo-list-meta">
      <span>Topic #${escapeHtml(linuxdoCurrentTopic.topicId)}</span>
      <span>楼层 ${escapeHtml(linuxdoCurrentTopic.currentPostNumber || '--')}</span>
    </div>
    <div class="site-url">${escapeHtml(linuxdoCurrentTopic.canonicalUrl || linuxdoCurrentTopic.url)}</div>
  `;
  if (statusText) statusText.textContent = '已读取当前主题';
}

function formatResourcesMarkdown(resources = linuxdoCurrentResources, filter = linuxdoResourceFilter) {
  const lines = ['## Linux.do 资源摘录', ''];
  const links = (resources.links || []).filter(link => filter === 'all' || filter === link.type);
  if (filter === 'all' || filter !== 'code') {
    for (const link of links) {
      lines.push(`- [${link.text || link.url}](${link.url})${link.type ? ` · ${link.type}` : ''}${link.postNumber ? ` · #${link.postNumber}` : ''}`);
    }
  }
  const codeBlocks = (resources.codeBlocks || []);
  if (filter === 'all' || filter === 'code') {
    codeBlocks.forEach((block, index) => {
      lines.push('', `### 代码块 ${index + 1}${block.postNumber ? ` · #${block.postNumber}` : ''}`, '', `\`\`\`${block.language || ''}`, block.text || '', '```');
    });
  }
  return lines.join('\n').trim() + '\n';
}

function renderLinuxdoResources() {
  const { resourceList, resourceCopyButton } = getLinuxdoCurrentTopicElements();
  const links = (linuxdoCurrentResources.links || []).filter(link => linuxdoResourceFilter === 'all' || linuxdoResourceFilter === link.type);
  const codeBlocks = linuxdoResourceFilter === 'all' || linuxdoResourceFilter === 'code' ? (linuxdoCurrentResources.codeBlocks || []) : [];
  if (resourceCopyButton) resourceCopyButton.disabled = links.length + codeBlocks.length === 0;
  if (!resourceList) return;
  if (links.length + codeBlocks.length === 0) {
    resourceList.innerHTML = '<div class="linuxdo-empty">暂无可显示资源。</div>';
    return;
  }
  resourceList.innerHTML = [
    ...links.map(link => `
      <article class="linuxdo-list-item linuxdo-resource-item">
        <button class="linuxdo-list-title" type="button" data-linuxdo-open-url="${escapeHtml(link.url)}">${escapeHtml(link.text || link.url)}</button>
        <div class="linuxdo-list-meta"><span>${escapeHtml(link.type)}</span><span>#${escapeHtml(link.postNumber || '--')}</span></div>
      </article>
    `),
    ...codeBlocks.map((block, index) => `
      <article class="linuxdo-list-item linuxdo-resource-item">
        <div class="linuxdo-list-title">代码块 ${index + 1}${block.language ? ` · ${escapeHtml(block.language)}` : ''}</div>
        <div class="linuxdo-list-meta"><span>#${escapeHtml(block.postNumber || '--')}</span></div>
        <code>${escapeHtml((block.text || '').slice(0, 1200))}${(block.text || '').length > 1200 ? '\n... 已截断预览' : ''}</code>
      </article>
    `)
  ].join('');
}

async function refreshLinuxdoCurrentTopic() {
  const { statusText } = getLinuxdoCurrentTopicElements();
  if (statusText) statusText.textContent = '正在读取当前标签页...';
  try {
    linuxdoCurrentTopic = await sendActiveLinuxdoContentMessage({ type: 'linuxdo-current-topic-get' });
    renderLinuxdoCurrentTopic();
  } catch (error) {
    linuxdoCurrentTopic = { ok: false, isTopicPage: false, message: error.message };
    renderLinuxdoCurrentTopic();
    if (statusText) statusText.textContent = error.message;
  }
}

async function extractLinuxdoCurrentResources() {
  const { statusText } = getLinuxdoCurrentTopicElements();
  if (statusText) statusText.textContent = '正在提取当前可见资源...';
  try {
    const response = await sendActiveLinuxdoContentMessage({ type: 'linuxdo-current-topic-extract-resources' });
    linuxdoCurrentResources = {
      links: response?.links || [],
      codeBlocks: response?.codeBlocks || []
    };
    await sendRuntimeMessage({
      action: 'linuxdoSaveCurrentTopicCache',
      cache: { ...linuxdoCurrentTopic, resources: linuxdoCurrentResources }
    });
    renderLinuxdoResources();
    if (statusText) statusText.textContent = `已提取 ${linuxdoCurrentResources.links.length} 个链接、${linuxdoCurrentResources.codeBlocks.length} 个代码块`;
  } catch (error) {
    if (statusText) statusText.textContent = `资源提取失败：${error.message}`;
  }
}

async function addCurrentTopicReadLater() {
  if (!linuxdoCurrentTopic?.isTopicPage) return;
  const response = await sendRuntimeMessage({
    action: 'linuxdoAddReadLater',
    topic: {
      id: linuxdoCurrentTopic.topicId,
      title: linuxdoCurrentTopic.title,
      url: linuxdoCurrentTopic.canonicalUrl || linuxdoCurrentTopic.url
    }
  });
  if (!response?.ok) throw new Error(response?.message || '保存失败');
  await loadLinuxdoReadLater();
}

function initLinuxdoCurrentTopic() {
  const { refreshButton, addButton, quoteButton, extractButton, resourceFilter, resourceCopyButton, card, resourceList } = getLinuxdoCurrentTopicElements();
  refreshButton?.addEventListener('click', refreshLinuxdoCurrentTopic);
  addButton?.addEventListener('click', () => addCurrentTopicReadLater().catch(console.error));
  quoteButton?.addEventListener('click', () => {
    if (!linuxdoCurrentTopic?.isTopicPage) return;
    const text = `[${linuxdoCurrentTopic.title || 'Linux.do 主题'}](${linuxdoCurrentTopic.canonicalUrl || linuxdoCurrentTopic.url})`;
    writeClipboard(text).catch(console.error);
  });
  extractButton?.addEventListener('click', extractLinuxdoCurrentResources);
  resourceFilter?.addEventListener('change', () => {
    linuxdoResourceFilter = resourceFilter.value || 'all';
    renderLinuxdoResources();
  });
  resourceCopyButton?.addEventListener('click', () => writeClipboard(formatResourcesMarkdown()).catch(console.error));
  card?.addEventListener('click', (event) => {
    const open = event.target.closest('[data-linuxdo-open-url]');
    if (open?.dataset?.linuxdoOpenUrl) openLinuxdoUrl(open.dataset.linuxdoOpenUrl).catch(console.error);
  });
  resourceList?.addEventListener('click', (event) => {
    const open = event.target.closest('[data-linuxdo-open-url]');
    if (open?.dataset?.linuxdoOpenUrl) openLinuxdoUrl(open.dataset.linuxdoOpenUrl).catch(console.error);
  });
  refreshLinuxdoCurrentTopic().catch(console.error);
}

function renderLinuxdoSensitiveRisks() {
  const section = $('#linuxdo-sensitive-section');
  const statusText = $('#linuxdo-sensitive-status');
  const list = $('#linuxdo-sensitive-list');
  if (section) {
    section.classList.toggle('has-risk', linuxdoSensitiveRisks.length > 0);
    if (linuxdoSensitiveRisks.length > 0) section.open = true;
  }
  if (statusText) {
    const high = linuxdoSensitiveRisks.filter(item => item.severity === 'high').length;
    statusText.textContent = linuxdoSensitiveRisks.length
      ? `发现 ${linuxdoSensitiveRisks.length} 类风险${high ? `，其中 ${high} 类高风险` : ''}`
      : '暂未发现敏感信息风险';
  }
  if (!list) return;
  if (!linuxdoSensitiveRisks.length) {
    list.innerHTML = '<div class="linuxdo-empty">在 Linux.do 编辑器输入内容时，这里会显示本地检测结果。</div>';
    return;
  }
  const severityText = { high: '高', medium: '中', low: '低' };
  list.innerHTML = linuxdoSensitiveRisks.map(risk => `
    <article class="linuxdo-risk-item ${escapeHtml(risk.severity)}">
      <div>
        <strong>${escapeHtml(risk.label)}</strong>
        <span class="linuxdo-risk-severity">${escapeHtml(severityText[risk.severity] || risk.severity)}</span>
      </div>
      <div class="linuxdo-list-meta">
        <span>${escapeHtml(risk.preview || '')}</span>
        <span>${escapeHtml(risk.count || 1)} 处</span>
      </div>
    </article>
  `).join('');
}

function initLinuxdoSensitivePanel() {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== 'linuxdo-sensitive-scan-result') return;
    if (sender?.tab?.id && linuxdoReadingActiveTabId && sender.tab.id !== linuxdoReadingActiveTabId) return;
    linuxdoSensitiveRisks = message.risks || [];
    renderLinuxdoSensitiveRisks();
  });
  sendActiveLinuxdoContentMessage({ type: 'linuxdo-sensitive-scan-get' })
    .then(response => {
      linuxdoSensitiveRisks = response?.risks || [];
      renderLinuxdoSensitiveRisks();
    })
    .catch(() => renderLinuxdoSensitiveRisks());
}

async function refreshLdcCredit() {
  const { refreshButton, statusText } = getLdcElements();
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = '刷新中...';
  }
  if (statusText) statusText.textContent = '正在后台读取 credit.linux.do...';

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

function initLinuxdoUnread() {
  const button = $('#linuxdo-unread');
  if (button) {
    button.addEventListener('click', async () => {
      try {
        await sendRuntimeMessage({ action: 'openLinuxdoHome' });
      } catch (error) {
        console.error('[佬站助手] 打开 Linux DO 失败:', error);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[LINUXDO_UNREAD_STORAGE_KEY]) {
      renderLinuxdoUnread(changes[LINUXDO_UNREAD_STORAGE_KEY].newValue);
    }
  });

  loadLinuxdoUnread();
  sendRuntimeMessage({ action: 'refreshLinuxdoUnread' })
    .then(response => {
      if (response?.ok) renderLinuxdoUnread(response);
    })
    .catch(() => {});
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

  ['click', 'mousedown', 'mouseup', 'keydown'].forEach(eventName => {
    enabledInput.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });

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

function initCustomSiteForm() {
  const form = $('#custom-site-form');
  if (!form) return;

  form.querySelector('[data-rule-template]')?.addEventListener('change', () => updateRuleTemplateFields(form));
  form.querySelectorAll('[data-rule-preset]').forEach(button => {
    button.addEventListener('click', () => applyRulePreset(form, button.dataset.rulePreset));
  });
  updateRuleTemplateFields(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const site = await addSite(getSitePayloadFromForm(form));
      console.log('[签到助手 Popup] 自定义站点添加成功:', site);
      form.reset();
      const templateInput = form.querySelector('[name="template"]');
      if (templateInput) templateInput.value = DEFAULT_RULE_VALUES.template;
      Object.entries(DEFAULT_RULE_VALUES).forEach(([key, value]) => {
        const input = form.querySelector(`[name="${key}"]`);
        if (!input) return;
        if (input.type === 'checkbox') {
          input.checked = !!value;
        } else if (key !== 'template') {
          input.value = value;
        }
      });
      updateRuleTemplateFields(form);
      await renderSites();
      await renderDropdown();
    } catch (e) {
      console.error('[签到助手 Popup] 添加自定义站点失败:', e);
      alert(e.message);
    }
  });
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

    const html = results.map(r => {
      const color = r.skipped ? '#777' : (r.success ? '#34a853' : '#ea4335');
      return `
        <div class="result-item">
          <strong>${escapeHtml(r.site.name)}</strong>:
          <span style="color:${color}">${escapeHtml(r.message)}</span>
        </div>
      `;
    }).join('');
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

  const sensitiveScanEnabled = $('#sensitive-scan-enabled');
  if (sensitiveScanEnabled) {
    sensitiveScanEnabled.checked = config.sensitiveScanEnabled !== false;
    sensitiveScanEnabled.addEventListener('change', async () => {
      await saveConfig({ sensitiveScanEnabled: sensitiveScanEnabled.checked });
      if (!sensitiveScanEnabled.checked) {
        linuxdoSensitiveRisks = [];
        renderLinuxdoSensitiveRisks();
      }
    });
  }

  const currentTopicEnhanceEnabled = $('#current-topic-enhance-enabled');
  if (currentTopicEnhanceEnabled) {
    currentTopicEnhanceEnabled.checked = config.currentTopicEnhanceEnabled !== false;
    currentTopicEnhanceEnabled.addEventListener('change', async () => {
      await saveConfig({ currentTopicEnhanceEnabled: currentTopicEnhanceEnabled.checked });
      if (currentTopicEnhanceEnabled.checked) {
        refreshLinuxdoCurrentTopic().catch(console.error);
      }
    });
  }

  const showLogsPanelInput = $('#show-logs-panel');
  if (showLogsPanelInput) {
    showLogsPanel = !!config.showLogsPanel;
    showLogsPanelInput.checked = showLogsPanel;
    showLogsPanelInput.addEventListener('change', async () => {
      showLogsPanel = showLogsPanelInput.checked;
      await saveConfig({ showLogsPanel });
      updateLogSectionVisibility();
    });
    updateLogSectionVisibility();
  }
}

console.log('[签到助手] Side Panel 已加载');
initTabs();
initSettingsPanel();
initCustomSiteForm();
renderSites();
renderDropdown();
renderDetected();
renderLogs();
renderConfig();
initLinuxdoReadingHelper();
initLdcCreditTools();
initLinuxdoUnread();
initLinuxdoDashboard();
initLinuxdoKeywords();
initLinuxdoReadLater();
initLinuxdoCurrentTopic();
initLinuxdoSensitivePanel();
setInterval(renderLogs, 2000);
