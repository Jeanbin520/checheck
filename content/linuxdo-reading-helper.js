(function () {
  "use strict";

  if (window.__linuxdoReadingHelperLoaded) return;
  window.__linuxdoReadingHelperLoaded = true;

  const STORAGE_KEY = "linuxdoReadingHelper";

  const DEFAULTS = {
    speed: "normal",
    maxMinutes: 8,
    pauseOnUserInput: true
  };

  const SPEEDS = {
    randomSlow: { minDelay: 1800, maxDelay: 3300, minStep: 120, maxStep: 260 },
    slow: { minDelay: 2500, maxDelay: 2500, minStep: 190, maxStep: 190 },
    normal: { minDelay: 1100, maxDelay: 2400, minStep: 220, maxStep: 460 },
    fast: { minDelay: 700, maxDelay: 1400, minStep: 420, maxStep: 760 }
  };

  const state = {
    settings: { ...DEFAULTS },
    running: false,
    timer: 0,
    startedAt: 0,
    lastUserInputAt: 0,
    noMarkerSince: 0,
    lastScrollY: -1,
    samePositionTicks: 0,
    status: "idle"
  };

  function isTopicPage() {
    return location.hostname === "linux.do" && /^\/t\//.test(location.pathname);
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function normalizedSettings(raw) {
    const settings = { ...DEFAULTS, ...(raw || {}) };
    delete settings.enabled;
    if (!SPEEDS[settings.speed]) settings.speed = DEFAULTS.speed;
    settings.maxMinutes = clampNumber(settings.maxMinutes, 1, 120, DEFAULTS.maxMinutes);
    settings.pauseOnUserInput = settings.pauseOnUserInput !== false;
    return settings;
  }

  function randomBetween(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0.05
    );
  }

  function parseRgb(color) {
    const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3])
    };
  }

  function isBlueish(color) {
    const rgb = parseRgb(color);
    if (!rgb) return false;
    return rgb.b > 120 && rgb.b > rgb.r + 30 && rgb.b >= rgb.g - 25;
  }

  function looksLikeRightSideBlueDot(element) {
    if (!isVisible(element)) return false;

    const rect = element.getBoundingClientRect();
    const smallEnough = rect.width <= 28 && rect.height <= 28;
    const dotLike = Math.abs(rect.width - rect.height) <= 10;
    const onRightSide = rect.left > window.innerWidth * 0.55;
    const classText = String(element.className || "").toLowerCase();
    const labelText = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-title")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const style = getComputedStyle(element);
    const hasBlueColor =
      isBlueish(style.backgroundColor) ||
      isBlueish(style.borderColor) ||
      isBlueish(style.color) ||
      isBlueish(style.outlineColor);
    const namesUnread = /unread|new|blue|未读|新/.test(`${classText} ${labelText}`);

    return smallEnough && dotLike && onRightSide && (hasBlueColor || namesUnread);
  }

  function hasUnreadMarker() {
    const selectors = [
      ".topic-timeline [class*='unread']",
      ".topic-timeline [class*='new']",
      ".timeline-container [class*='unread']",
      ".timeline-container [class*='new']",
      ".topic-navigation [class*='unread']",
      ".topic-navigation [class*='new']",
      "[aria-label*='未读']",
      "[title*='未读']",
      "[class*='blue']"
    ];

    const prioritized = document.querySelectorAll(selectors.join(","));
    for (const element of prioritized) {
      if (looksLikeRightSideBlueDot(element)) return true;
    }

    const rightSideElements = document.elementsFromPoint(
      Math.max(0, window.innerWidth - 36),
      Math.max(0, Math.floor(window.innerHeight / 2))
    );
    for (const element of rightSideElements) {
      if (looksLikeRightSideBlueDot(element)) return true;
      for (const child of element.querySelectorAll("*")) {
        if (looksLikeRightSideBlueDot(child)) return true;
      }
    }

    return false;
  }

  function atDocumentBottom() {
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    return window.scrollY + window.innerHeight >= height - 24;
  }

  function setStatus(status) {
    state.status = status;
    try {
      const response = chrome.runtime.sendMessage({
        type: "linuxdo-reading-helper-status",
        status
      });
      if (response && typeof response.catch === "function") response.catch(() => {});
    } catch (error) {
      // The side panel may be closed; status is still available through get-status.
    }
  }

  function stop(reason) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = 0;
    }
    state.running = false;
    state.noMarkerSince = 0;
    state.samePositionTicks = 0;
    setStatus(reason || "stopped");
  }

  function scheduleNext() {
    if (!state.running) return;
    const speed = SPEEDS[state.settings.speed] || SPEEDS.normal;
    const delay = randomBetween(speed.minDelay, speed.maxDelay);
    state.timer = window.setTimeout(tick, delay);
  }

  function tick() {
    if (!state.running) return;

    if (!isTopicPage()) {
      stop("not-topic-page");
      return;
    }

    const elapsed = Date.now() - state.startedAt;
    if (elapsed > state.settings.maxMinutes * 60 * 1000) {
      stop("time-limit");
      return;
    }

    if (state.settings.pauseOnUserInput && Date.now() - state.lastUserInputAt < 5000) {
      setStatus("paused-by-user");
      scheduleNext();
      return;
    }

    const markerVisible = hasUnreadMarker();
    const bottom = atDocumentBottom();

    if (!markerVisible) {
      if (!state.noMarkerSince) state.noMarkerSince = Date.now();
      if (bottom && Date.now() - state.noMarkerSince > 2500) {
        stop("completed");
        return;
      }
    } else {
      state.noMarkerSince = 0;
    }

    const speed = SPEEDS[state.settings.speed] || SPEEDS.normal;
    const step = randomBetween(speed.minStep, speed.maxStep);
    window.scrollBy({ top: bottom ? 1 : step, left: 0, behavior: "smooth" });

    if (Math.abs(window.scrollY - state.lastScrollY) < 4) {
      state.samePositionTicks += 1;
    } else {
      state.samePositionTicks = 0;
    }
    state.lastScrollY = window.scrollY;

    if (bottom && !markerVisible && state.samePositionTicks >= 3) {
      stop("completed");
      return;
    }

    setStatus(markerVisible ? "reading-marker-visible" : "reading");
    scheduleNext();
  }

  function start() {
    if (!isTopicPage()) {
      setStatus("not-topic-page");
      return;
    }
    if (state.running) return;

    state.running = true;
    state.startedAt = Date.now();
    state.noMarkerSince = 0;
    state.lastScrollY = window.scrollY;
    state.samePositionTicks = 0;
    setStatus("started");
    scheduleNext();
  }

  function loadSettings(callback) {
    chrome.storage.local.get({ [STORAGE_KEY]: DEFAULTS }, (stored) => {
      state.settings = normalizedSettings(stored[STORAGE_KEY]);
      if (callback) callback();
    });
  }

  function saveSettings(nextSettings) {
    state.settings = normalizedSettings({ ...state.settings, ...nextSettings });
    chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
  }

  ["wheel", "touchstart", "keydown", "mousedown"].forEach((eventName) => {
    window.addEventListener(
      eventName,
      () => {
        state.lastUserInputAt = Date.now();
      },
      { passive: true }
    );
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === "linuxdo-reading-helper-get-status") {
      sendResponse({
        ok: true,
        running: state.running,
        status: state.status,
        isTopicPage: isTopicPage(),
        settings: state.settings,
        unreadMarkerVisible: isTopicPage() ? hasUnreadMarker() : false
      });
      return true;
    }

    if (message.type === "linuxdo-reading-helper-start") {
      start();
      sendResponse({ ok: true, status: state.status });
      return true;
    }

    if (message.type === "linuxdo-reading-helper-stop") {
      stop("stopped");
      sendResponse({ ok: true, status: state.status });
      return true;
    }

    if (message.type === "linuxdo-reading-helper-save-settings") {
      const shouldRun =
        typeof message.settings.enabled === "boolean" ? message.settings.enabled : null;
      saveSettings(message.settings || {});
      if (shouldRun === true) start();
      if (shouldRun === false) stop("disabled");
      sendResponse({ ok: true, settings: state.settings, status: state.status });
      return true;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    state.settings = normalizedSettings({
      ...state.settings,
      ...(changes[STORAGE_KEY].newValue || {})
    });
  });

  loadSettings(() => {
    setStatus("idle");
  });
})();
