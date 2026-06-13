(function() {
  const CHECKIN_SELECTORS = '#checkin-btn, .checkin-btn, [data-action="checkin"]';
  const CHECKIN_TEXTS = ['签到', 'check in', 'sign in', '领取额度'];

  function hasCheckin() {
    if (document.querySelector(CHECKIN_SELECTORS)) return true;
    const buttons = document.querySelectorAll('button, a');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      if (CHECKIN_TEXTS.some(t => text.includes(t))) return true;
    }
    return false;
  }

  if (hasCheckin()) {
    chrome.runtime.sendMessage({
      action: 'detectedCheckin',
      url: window.location.origin,
      title: document.title
    });
  }
})();
