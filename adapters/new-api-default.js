export const newApiDefaultAdapter = {
  id: 'new-api-default',
  name: 'new-api 默认签到',
  description: '适用于基于 new-api 的站点，默认签到按钮',

  match(url) {
    return true;
  },

  getCheckinCode() {
    return `
      (async () => {
        const btn = document.querySelector('#checkin-btn, .checkin-btn, [data-action="checkin"], button[class*="sign"], button[class*="checkin"]');
        if (btn) {
          btn.click();
          await new Promise(r => setTimeout(r, 2000));
          return { success: true, message: '已点击签到按钮' };
        }

        const links = Array.from(document.querySelectorAll('a, button'));
        const checkinLink = links.find(el => {
          const text = el.textContent.toLowerCase();
          return text.includes('签到') || text.includes('check') || text.includes('sign');
        });
        if (checkinLink) {
          checkinLink.click();
          await new Promise(r => setTimeout(r, 2000));
          return { success: true, message: '已点击签到链接' };
        }

        return { success: false, message: '未找到签到按钮' };
      })()
    `;
  }
};
