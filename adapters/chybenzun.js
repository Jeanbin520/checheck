async function runChybenzunCheckin() {
  const today = new Date();
  const month = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

  async function requestJson(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { 'Accept': 'application/json', ...(options.headers || {}) },
      ...options
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = { success: false, message: response.statusText || '响应不是 JSON' };
    }
    return { response, data };
  }

  function isUnauthorized(response, data) {
    const message = String(data?.message || '').toLowerCase();
    return response.status === 401 || response.status === 403 ||
      message.includes('unauthorized') ||
      message.includes('not login') ||
      message.includes('未登录') ||
      message.includes('请登录');
  }

  function quotaText(value) {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  function findCheckinButton() {
    const candidates = Array.from(document.querySelectorAll('button, a'));
    return candidates.find((el) => {
      const text = (el.textContent || '').trim().toLowerCase();
      const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
      return !disabled && (
        text.includes('立即签到') ||
        text.includes('check in now') ||
        text.includes('check-in now')
      );
    });
  }

  function pageLooksLoggedOut() {
    const path = window.location.pathname.toLowerCase();
    const bodyText = (document.body?.innerText || '').toLowerCase();
    return path.includes('/sign-in') ||
      bodyText.includes('sign in') ||
      bodyText.includes('登录') ||
      bodyText.includes('使用 linuxdo');
  }

  async function clickVisibleCheckinButton(reason) {
    const button = findCheckinButton();
    if (!button) return null;

    button.click();
    await new Promise(r => setTimeout(r, 2000));

    const bodyText = document.body?.innerText || '';
    if (/已签到|checked in/i.test(bodyText)) {
      return { action: 'done', success: true, message: '签到成功或今日已签到' };
    }

    return {
      action: 'done',
      success: true,
      message: reason || '已点击立即签到，请在页面确认结果'
    };
  }

  const self = await requestJson('/api/user/self');
  if (isUnauthorized(self.response, self.data) || !self.data?.success) {
    const clicked = await clickVisibleCheckinButton('API 登录状态不可用，已通过页面按钮执行签到');
    if (clicked) return clicked;

    if (!window.location.pathname.includes('/sign-in')) {
      window.location.href = '/sign-in?redirect=' + encodeURIComponent('/profile');
    }
    return {
      action: 'done',
      success: false,
      message: '未登录 CHY公益站，请先完成登录后再签到'
    };
  }

  const status = await requestJson('/api/status');
  if (status.data?.success && status.data?.data?.checkin_enabled === false) {
    return { action: 'done', success: false, message: '站点当前未开启签到功能' };
  }

  const checkStatus = await requestJson('/api/user/checkin?month=' + encodeURIComponent(month));
  if (isUnauthorized(checkStatus.response, checkStatus.data)) {
    return {
      action: 'done',
      success: false,
      message: '未登录 CHY公益站，请先完成登录后再签到'
    };
  }

  if (!checkStatus.data?.success || !checkStatus.data?.data) {
    return {
      action: 'done',
      success: false,
      message: checkStatus.data?.message || '获取签到状态失败'
    };
  }

  const stats = checkStatus.data.data.stats || {};
  if (stats.checked_in_today === true) {
    return { action: 'done', success: true, message: '今日已签到，无需重复签到' };
  }

  if (status.data?.data?.turnstile_check === true && status.data?.data?.turnstile_site_key) {
    return {
      action: 'done',
      success: false,
      message: '签到需要 Turnstile 安全验证，请在站点页面手动完成'
    };
  }

  const checkin = await requestJson('/api/user/checkin', { method: 'POST' });
  if (isUnauthorized(checkin.response, checkin.data)) {
    return {
      action: 'done',
      success: false,
      message: '未登录 CHY公益站，请先完成登录后再签到'
    };
  }

  if (checkin.data?.success && checkin.data?.data) {
    const awarded = quotaText(checkin.data.data.quota_awarded);
    return {
      action: 'done',
      success: true,
      message: awarded ? '签到成功，获得额度: ' + awarded : '签到成功'
    };
  }

  const message = checkin.data?.message || '签到失败';
  if (/already|checked|重复|已经|已签到/i.test(message)) {
    return { action: 'done', success: true, message: '今日已签到，无需重复签到' };
  }

  return { action: 'done', success: false, message };
}

async function clickChybenzunLinuxdoLogin() {
  if (!window.location.pathname.includes('/sign-in')) {
    return { action: 'continue', message: '当前不在登录页，跳过 LinuxDO 登录' };
  }

  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const button = candidates.find((el) => {
    const text = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const href = (el.getAttribute('href') || '').toLowerCase();
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
    return !disabled && (
      text.includes('使用 linuxdo 继续') ||
      text.includes('linuxdo') ||
      href.includes('linuxdo')
    );
  });

  if (!button) {
    return {
      action: 'error',
      message: '未找到 LinuxDO 登录按钮'
    };
  }

  button.click();
  return {
    action: 'continue',
    message: '已点击 LinuxDO 登录按钮'
  };
}

export const chybenzunAdapter = {
  id: 'chybenzun',
  name: 'CHY公益站',
  description: 'chybenzun.top New API 每日签到',

  match(url) {
    return url.includes('chybenzun.top');
  },

  getFlow() {
    return {
      url: 'https://chybenzun.top/profile',
      successPattern: '/profile',
      steps: [
        {
          type: 'navigateToSettings',
          targetUrl: 'https://chybenzun.top/profile',
          description: '进入个人资料页'
        },
        {
          type: 'injectFunction',
          description: '点击 LinuxDO 登录按钮',
          world: 'MAIN',
          func: clickChybenzunLinuxdoLogin
        },
        {
          type: 'waitAuthorize',
          authorizeSelector: 'button, a, input[type="submit"]',
          authorizeText: ['allow', 'authorize', 'agree', '同意', '允许', '授权', 'approve'],
          successUrlIncludes: ['/profile', '/dashboard'],
          description: 'LinuxDO 授权确认'
        },
        {
          type: 'navigateToSettings',
          targetUrl: 'https://chybenzun.top/profile',
          description: '回到个人资料页'
        },
        {
          type: 'injectFunction',
          description: '检查签到状态并执行签到',
          world: 'MAIN',
          func: runChybenzunCheckin
        }
      ]
    };
  }
};
