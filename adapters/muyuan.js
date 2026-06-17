export const muyuanAdapter = {
  id: 'muyuan',
  name: '木鸢公益',
  description: 'muyuan.do 公益站签到',

  match(url) {
    return url.includes('muyuan.do');
  },

  getFlow() {
    return {
      url: 'https://muyuan.do/console/personal',
      successPattern: '/console/personal',
      steps: [
        {
          type: 'closeAnnouncement',
          selector: 'button, a, [role="button"], [class*="close" i], [class*="modal-close" i]',
          matchText: ['关闭', '关闭公告', 'close', '我知道了', '确定'],
          fallbackCloseSelector: 'button[aria-label*="close" i], button[aria-label*="关闭"], [class*="close" i], [class*="semi-modal-close" i], .semi-modal-close',
          description: '关闭系统公告'
        },
        {
          type: 'checkGotoLogin',
          description: '检查是否需要跳转登录'
        },
        {
          type: 'checkAndClick',
          selector: 'input[type="checkbox"]',
          description: '勾选用户协议',
          waitForSelector: true
        },
        {
          type: 'linuxdoOAuth',
          onlyIfUrlIncludes: ['/login', '/signin'],
          clientId: 'BhXQoUAlShhv8gX3J7AwTIYflzanZghI',
          description: '进入 LinuxDO 授权登录'
        },
        {
          type: 'waitAuthorize',
          authorizeSelector: 'button, a.btn, a.btn-pill, input[type="submit"]',
          authorizeText: ['allow', 'authorize', 'agree', '同意', '允许', '授权', 'approve'],
          description: '授权页面点击允许'
        },
        {
          type: 'navigateToSettings',
          targetUrl: 'https://muyuan.do/console/personal',
          description: '进入个人设置'
        },
        {
          type: 'waitForElement',
          selector: 'button',
          timeout: 10000,
          description: '等待签到按钮加载'
        },
        {
          type: 'click',
          selector: 'button, a',
          exactMatchText: ['立即签到'],
          matchText: ['立即签到', '签到', 'checkin', 'check in'],
          excludeText: ['每日签到'],
          completeText: ['今日已签到', '已签到', 'already checked', 'checked in'],
          description: '签到按钮',
          completeAfterClick: true
        }
      ]
    };
  }
};
