export const elysiverAdapter = {
  id: 'elysiver',
  name: '烁',
  description: 'elysiver.h-e.top 公益站签到',

  match(url) {
    return url.includes('elysiver.h-e.top');
  },

  getFlow() {
    return {
      url: 'https://elysiver.h-e.top/console/token',
      successPattern: '/console/personal',
      steps: [
        {
          type: 'navigateToSettings',
          targetUrl: 'https://elysiver.h-e.top/console/personal',
          description: '进入个人设置'
        },
        {
          type: 'linuxdoOAuth',
          onlyIfUrlIncludes: ['/login', '/signin'],
          clientId: 'E2eaCQVl9iecd4aJBeTKedXfeKiJpSPF',
          description: '进入 LinuxDO 授权登录'
        },
        {
          type: 'waitAuthorize',
          authorizeSelector: 'button, a, input[type="submit"]',
          authorizeText: ['allow', 'authorize', 'agree', '同意', '允许', '授权', 'approve'],
          description: '授权页面点击允许'
        },
        {
          type: 'navigateToSettings',
          targetUrl: 'https://elysiver.h-e.top/console/personal',
          description: '进入个人设置'
        },
        {
          type: 'waitForElement',
          selector: 'button',
          timeout: 10000,
          description: '等待按钮加载'
        },
        {
          type: 'click',
          selector: 'button, a',
          exactMatchText: ['立即签到'],
          matchText: ['立即签到'],
          excludeText: ['每日签到'],
          description: '立即签到按钮',
          completeAfterClick: true
        }
      ]
    };
  }
};
