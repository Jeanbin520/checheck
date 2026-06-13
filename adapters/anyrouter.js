async function clickAnyrouterLinuxdoLogin() {
  if (window.location.pathname.includes('/console')) {
    return { action: 'continue', message: '已在控制台，跳过 LinuxDO 登录' };
  }

  const normalize = (text) => String(text || '').toLowerCase().replace(/\s+/g, '');
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) !== 0;
  };
  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const button = candidates.find((el) => {
    const text = normalize(el.textContent);
    const aria = normalize(el.getAttribute('aria-label'));
    const title = normalize(el.getAttribute('title'));
    const href = normalize(el.getAttribute('href'));
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const label = `${text} ${aria} ${title} ${href}`;
    return !disabled && isVisible(el) && (
      label.includes('使用linuxdo继续') ||
      label.includes('linuxdo继续') ||
      label.includes('linuxdo')
    );
  });

  if (!button) {
    const visibleTexts = candidates
      .filter(isVisible)
      .map(el => (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim())
      .filter(Boolean)
      .slice(0, 10);
    return {
      action: 'error',
      message: `未找到可见的 LinuxDO 登录按钮，可见按钮: ${visibleTexts.join(' | ')}`
    };
  }

  const directLink = Array.from(document.querySelectorAll('a[href]')).find((el) => {
    const href = String(el.href || '').toLowerCase();
    const text = normalize(el.textContent);
    return isVisible(el) && (
      href.includes('connect.linux.do') ||
      href.includes('linuxdo') ||
      href.includes('oauth') ||
      text.includes('linuxdo')
    );
  });
  if (directLink?.href) {
    window.location.href = directLink.href;
    return {
      action: 'continue',
      message: `已通过 LinuxDO 链接跳转: ${directLink.href}`
    };
  }

  const startUrl = window.location.href;
  let openedUrl = '';
  const originalOpen = window.open;
  window.open = function(url, target, features) {
    openedUrl = String(url || '');
    return null;
  };

  button.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise(r => setTimeout(r, 100));

  const rect = button.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const target = document.elementFromPoint(centerX, centerY) || button;
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: centerX,
    clientY: centerY
  };

  try {
    target.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    target.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    target.dispatchEvent(new MouseEvent('click', eventOptions));
  } catch {
    button.click();
  }
  button.click();

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (openedUrl) {
      window.open = originalOpen;
      window.location.href = openedUrl;
      return {
        action: 'continue',
        message: `已捕获弹窗地址并跳转: ${openedUrl}`
      };
    }
    if (window.location.href !== startUrl) {
      window.open = originalOpen;
      return {
        action: 'continue',
        message: `已点击 LinuxDO 登录按钮，页面已跳转: ${window.location.href}`
      };
    }
  }
  window.open = originalOpen;

  return {
    action: 'error',
    message: `已点击 LinuxDO 登录按钮但页面未跳转，按钮文本: ${(button.textContent || '').trim()}`
  };
}

export const anyrouterAdapter = {
  id: 'anyrouter',
  name: 'AnyRouter',
  description: 'anyrouter.top OAuth 登录签到',

  match(url) {
    return url.includes('anyrouter.top');
  },

  getCheckinCode() {
    return `
      (async () => {
        if (window.location.pathname.includes('/console/token')) {
          return { success: true, message: '已在控制台，已登录' };
        }
        if (window.location.pathname.includes('/login')) {
          const btn = Array.from(document.querySelectorAll('button, a')).find(el => {
            const text = (el.textContent || '').toLowerCase();
            return text.includes('linuxdo') || text.includes('linux do') || text.includes('使用linuxdo') || text.includes('使用linux');
          });
          if (btn) {
            btn.click();
            return { success: true, message: '已点击 LinuxDO 登录' };
          }
          return { success: false, message: '未找到 LinuxDO 登录按钮' };
        }
        return { success: false, message: '未知页面: ' + window.location.pathname };
      })()
    `;
  },

  getFlow() {
    return {
      url: 'https://anyrouter.top/login',
      successPattern: '/console',
      steps: [
        {
          type: 'checkUrl'
        },
        {
          type: 'closeAnnouncement',
          selector: 'button, a, [role="button"]',
          matchText: ['关闭', '关闭公告', '今日关闭', '我知道了', '确定', 'close'],
          fallbackCloseSelector: 'button[aria-label*="close" i], button[aria-label*="关闭"], [class*="close" i], [class*="Close"]',
          description: '关闭系统公告'
        },
        {
          type: 'injectFunction',
          description: '点击 LinuxDO 登录按钮',
          world: 'MAIN',
          func: clickAnyrouterLinuxdoLogin
        },
        {
          type: 'waitAuthorize',
          authorizeSelector: 'button, a.btn, a.btn-pill, input[type="submit"]',
          authorizeText: ['allow', 'authorize', 'agree', '同意', '允许', '授权', 'approve'],
          successUrlIncludes: ['/console'],
          successWaitTimeout: 60000,
          description: 'LinuxDO 授权确认'
        },
        {
          type: 'checkUrl'
        }
      ]
    };
  }
};
