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

// 在 /sign-in 页面触发 LinuxDO OAuth 登录。
// 脚本注入的 click() 不是真实用户手势，浏览器会拦截由此触发的 window.open() 弹窗，
// 导致 OAuth 页打不开、URL 一直停在登录页。这里通过多级兜底拿到 OAuth 授权地址，
// 再用新动作 `navigate` 把 URL 交给 service worker 用 chrome.tabs.update 主动导航。
async function clickChybenzunLinuxdoLogin() {
  if (!window.location.pathname.includes('/sign-in')) {
    return { action: 'continue', message: '当前不在登录页，跳过 LinuxDO 登录' };
  }

  const LINUXDO_TEXTS = ['使用 linuxdo 继续', 'linuxdo', 'linux do', 'linux.do', 'oauth'];
  const LINUXDO_HREFS = ['linuxdo', 'oauth', 'connect.linux.do'];

  // SPA 登录页按钮可能是 button/a，也可能是可点击的 div/span（React/Semi UI 常见）。
  function collectLinuxdoControls() {
    const selector = 'button, a, [role="button"], input[type="button"], input[type="submit"], div, span';
    const elements = Array.from(document.querySelectorAll(selector));
    return elements.filter((el) => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      // div/span 自身没有行为，必须是带文本的叶节点，避免命中整个大容器
      const tag = el.tagName.toLowerCase();
      if (tag === 'div' || tag === 'span') {
        if (rect.width > 600 || rect.height > 120) return false;
        if (el.childElementCount > 3) return false;
      }
      const text = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const href = (el.getAttribute('href') || '').toLowerCase();
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
      const all = `${text} ${href} ${label}`;
      return LINUXDO_TEXTS.some(t => all.includes(t)) || LINUXDO_HREFS.some(t => href.includes(t));
    });
  }

  // SPA 渲染需要时间，登录按钮不会在页面"加载完成"后立即可见，这里轮询等待。
  async function waitForLinuxdoControls(maxWaitMs = 6000) {
    let controls = collectLinuxdoControls();
    if (controls.length) return controls;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 400));
      controls = collectLinuxdoControls();
      if (controls.length) return controls;
    }
    return controls;
  }

  // 优先走 API 路径：new-api 的 /api/status 返回 linuxdo_client_id，
  // /api/oauth/state 返回 state 随机字符串（同时写入 Gin session 供回调校验）。
  // 用两者拼出标准 LinuxDO OAuth 授权地址，交给后台 chrome.tabs.update 主动导航，
  // 完全绕开弹窗拦截，也不依赖 DOM 按钮渲染时机。
  // 这与已跑通的 elysiver / 木鸢 linuxdoOAuth 步骤是同一条可靠路径。
  // 注意：state 必须原样使用，不能拼接任何后缀——new-api 回调时要求
  // query.state === session.oauth_state，任何改动都会导致 "state 参数为空或不匹配"。
  try {
    const [statusResponse, stateResponse] = await Promise.all([
      fetch('/api/status', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/oauth/state', { credentials: 'include' }).then(r => r.json()).catch(() => null)
    ]);
    const clientId = statusResponse?.data?.linuxdo_client_id || '';
    const stateToken = stateResponse?.data || '';
    if (clientId && stateToken) {
      const authUrl = new URL('https://connect.linux.do/oauth2/authorize');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('state', stateToken);
      return { action: 'navigate', url: authUrl.toString(), message: '通过 API 生成 LinuxDO 授权地址，由后台导航' };
    }
  } catch (e) {
    // API 失败则回退到 DOM 按钮
  }

  // 1) 直接读取 a[href] 形式的 OAuth 入口
  const initialControls = await waitForLinuxdoControls();
  const directLink = initialControls.find(el => {
    const href = (el.getAttribute('href') || '').toLowerCase();
    return LINUXDO_HREFS.some(t => href.includes(t));
  });
  if (directLink && directLink.tagName === 'A' && directLink.href) {
    return { action: 'navigate', url: directLink.href, message: '已找到 LinuxDO OAuth 直链，由后台导航' };
  }

  // 2) hook window.open，再点击按钮，捕获被弹窗拦截器拦掉的 OAuth 弹窗 URL。
  //    若按钮是 location 赋值跳转，标签页会自行导航，后续 waitAuthorize 能直接感知，无需在此捕获。
  let capturedUrl = '';
  const originalOpen = window.open;
  window.open = function (url) {
    if (url && !capturedUrl) capturedUrl = String(url);
    try { return originalOpen.apply(this, arguments); } catch { return null; }
  };
  let clickedText = '';
  try {
    const button = initialControls[0];
    if (button) {
      clickedText = (button.textContent || '').trim().slice(0, 60);
      button.click();
      await new Promise(r => setTimeout(r, 1000));
    }
  } finally {
    try { window.open = originalOpen; } catch {}
  }

  if (capturedUrl) {
    return { action: 'navigate', url: capturedUrl, message: `已捕获 LinuxDO 跳转地址(${clickedText})` };
  }

  // 3) 点击后页面自身已经完成跳转（例如 SPA 内部导航到 connect.linux.do）
  if (window.location.href.includes('connect.linux.do') || window.location.href.includes('/oauth')) {
    return { action: 'continue', message: '已在 LinuxDO 授权页，继续后续授权步骤' };
  }

  return {
    action: 'error',
    message: '未找到 LinuxDO 登录按钮，且无法生成授权地址'
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
          successUrlIncludes: ['/profile', '/dashboard', '/console'],
          successWaitTimeout: 45000,
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
