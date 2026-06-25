const TEMPLATE_NAMES = {
  'generic-button-checkin': '通用按钮签到',
  'new-api-linuxdo-button': 'New API + LinuxDO 按钮签到'
};

const DEFAULT_BUTTON_TEXTS = ['立即签到', '签到', 'checkin', 'check in'];
const DEFAULT_COMPLETE_TEXTS = ['今日已签到', '已签到', 'already checked', 'checked in'];
const DEFAULT_AUTH_TEXTS = ['allow', 'authorize', 'agree', '同意', '允许', '授权', 'approve'];
const DEFAULT_LOGIN_PATHS = ['/login', '/signin', '/sign-in'];

function compactArray(value, fallback = []) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/);
  const items = source
    .map(item => String(item || '').trim())
    .filter(Boolean);
  return items.length ? items : [...fallback];
}

function normalizePath(path, fallback = '/') {
  const value = String(path || '').trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeAbsoluteUrl(baseUrl, path = '/') {
  const base = new URL(baseUrl);
  return new URL(normalizePath(path), base.origin).href;
}

function firstPath(paths, fallback = '/') {
  return compactArray(paths, [fallback])[0] || fallback;
}

function getSuccessPattern(rule, fallbackPath) {
  const success = compactArray(rule.successUrlIncludes, []);
  if (success.length) return success[0];
  return normalizePath(fallbackPath, '/');
}

function buildGenericButtonFlow(site, rule) {
  const startPath = normalizePath(rule.startPath || rule.pagePath || '/', '/');
  const matchText = compactArray(rule.matchText || rule.checkinText, DEFAULT_BUTTON_TEXTS);
  const completeText = compactArray(rule.completeText, DEFAULT_COMPLETE_TEXTS);

  return {
    url: normalizeAbsoluteUrl(site.url, startPath),
    successPattern: getSuccessPattern(rule, startPath),
    steps: [
      {
        type: 'waitForElement',
        selector: rule.selector || 'button, a, [role="button"]',
        timeout: Number(rule.waitTimeout) || 10000,
        description: '等待签到控件加载'
      },
      {
        type: 'click',
        selector: rule.selector || 'button, a, [role="button"]',
        exactMatchText: compactArray(rule.exactMatchText, []),
        matchText,
        excludeText: compactArray(rule.excludeText, ['每日签到']),
        completeText,
        description: '签到按钮',
        completeAfterClick: true
      }
    ]
  };
}

function buildNewApiLinuxdoButtonFlow(site, rule) {
  const startPath = normalizePath(rule.startPath || rule.settingsPath || '/console/personal', '/console/personal');
  const loginPaths = compactArray(rule.loginPaths, DEFAULT_LOGIN_PATHS).map(path => normalizePath(path, path));
  const successUrlIncludes = compactArray(rule.successUrlIncludes, [startPath]);
  const selector = rule.selector || 'button, a, [role="button"]';
  const matchText = compactArray(rule.matchText || rule.checkinText, DEFAULT_BUTTON_TEXTS);
  const completeText = compactArray(rule.completeText, DEFAULT_COMPLETE_TEXTS);
  const steps = [];

  if (rule.closeAnnouncement !== false) {
    steps.push({
      type: 'closeAnnouncement',
      selector: 'button, a, [role="button"], [class*="close" i], [class*="modal-close" i]',
      matchText: ['关闭', '关闭公告', '今日关闭', '我知道了', '确定', 'close'],
      fallbackCloseSelector: 'button[aria-label*="close" i], button[aria-label*="关闭"], [class*="close" i], [class*="semi-modal-close" i], .semi-modal-close',
      description: '关闭系统公告'
    });
  }

  steps.push({
    type: 'checkGotoLogin',
    description: '检查是否需要跳转登录'
  });

  if (rule.agreementSelector !== false && rule.agreementSelector !== 'false') {
    steps.push({
      type: 'checkAndClick',
      selector: rule.agreementSelector || 'input[type="checkbox"]',
      description: '勾选用户协议'
    });
  }

  if (rule.linuxdoClientId) {
    steps.push({
      type: 'linuxdoOAuth',
      onlyIfUrlIncludes: loginPaths,
      clientId: rule.linuxdoClientId,
      description: '进入 LinuxDO 授权登录'
    });
  }

  steps.push({
    type: 'waitAuthorize',
    authorizeSelector: rule.authorizeSelector || 'button, a, input[type="submit"]',
    authorizeText: compactArray(rule.authorizeText, DEFAULT_AUTH_TEXTS),
    successUrlIncludes,
    successWaitTimeout: Number(rule.successWaitTimeout) || 45000,
    description: 'LinuxDO 授权确认'
  });

  steps.push({
    type: 'navigateToSettings',
    targetUrl: normalizeAbsoluteUrl(site.url, startPath),
    description: '进入个人设置'
  });

  steps.push({
    type: 'waitForElement',
    selector,
    timeout: Number(rule.waitTimeout) || 10000,
    description: '等待签到按钮加载'
  });

  steps.push({
    type: 'click',
    selector,
    exactMatchText: compactArray(rule.exactMatchText, ['立即签到']),
    matchText,
    excludeText: compactArray(rule.excludeText, ['每日签到']),
    completeText,
    description: '签到按钮',
    completeAfterClick: true
  });

  return {
    url: normalizeAbsoluteUrl(site.url, startPath),
    successPattern: getSuccessPattern(rule, startPath),
    steps
  };
}

export function hasRuleAdapter(site) {
  return !!site?.checkinRule?.template;
}

export function createRuleAdapter(site) {
  const rule = site.checkinRule || {};
  const template = rule.template || 'generic-button-checkin';

  return {
    id: `rule-${site.id || site.url}`,
    name: `${site.name} · ${TEMPLATE_NAMES[template] || '自定义规则'}`,
    description: '由插件内配置生成的通用签到流程',
    match: () => true,
    getFlow() {
      if (template === 'generic-button-checkin') {
        return buildGenericButtonFlow(site, rule);
      }
      if (template === 'new-api-linuxdo-button') {
        return buildNewApiLinuxdoButtonFlow(site, rule);
      }
      throw new Error(`未知签到模板: ${template}`);
    }
  };
}
