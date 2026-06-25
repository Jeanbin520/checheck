(function () {
  "use strict";

  // 防重入：内容脚本可能由 manifest 的 content_scripts（document_idle）注入一次，
  // 再由 popup 通过 chrome.scripting.executeScript 注入一次。重复注入会导致
  // 重复注册消息监听器、重复绑定事件、state 被重置，进而出现"开始按钮无响应"等问题。
  if (window.__linuxdoReadingHelperLoaded) return;
  window.__linuxdoReadingHelperLoaded = true;

  const STORAGE_KEY = "linuxdoReadingHelper";
  const CONFIG_KEY = "config";

  const DEFAULTS = {
    speed: "normal",
    maxMinutes: 8,
    pauseOnUserInput: true
  };

  const DEFAULT_CONFIG = {
    base64DecoderEnabled: false,
    sensitiveScanEnabled: true,
    currentTopicEnhanceEnabled: true
  };
  const UNREAD_REFRESH_INTERVAL = 2 * 60 * 1000;

  const SPEEDS = {
    randomSlow: { minDelay: 1800, maxDelay: 3300, minStep: 120, maxStep: 260 },
    slow: { minDelay: 2500, maxDelay: 2500, minStep: 190, maxStep: 190 },
    normal: { minDelay: 1100, maxDelay: 2400, minStep: 220, maxStep: 460 },
    fast: { minDelay: 700, maxDelay: 1400, minStep: 420, maxStep: 760 }
  };

  const state = {
    settings: { ...DEFAULTS },
    config: { ...DEFAULT_CONFIG },
    running: false,
    timer: 0,
    startedAt: 0,
    lastUserInputAt: 0,
    noMarkerSince: 0,
    lastScrollY: -1,
    samePositionTicks: 0,
    status: "idle",
    sensitiveRisks: []
  };

  function isTopicPage() {
    return location.hostname === "linux.do" && /^\/t\//.test(location.pathname);
  }

  function getTopicIdFromPath() {
    const match = location.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function getCurrentPostNumberFromPath() {
    const match = location.pathname.match(/^\/t\/(?:[^/]+\/)?\d+\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function getTopicTitle() {
    const title =
      document.querySelector("meta[property='og:title']")?.content ||
      document.querySelector("h1 .fancy-title, h1, .topic-title h1")?.textContent ||
      document.title ||
      "";
    return String(title).replace(/\s+-\s+Linux\.do.*$/i, "").trim();
  }

  function getCanonicalTopicUrl(topicId) {
    const canonical = document.querySelector("link[rel='canonical']")?.href;
    if (canonical && canonical.includes("/t/")) return canonical;
    return topicId ? `${location.origin}/t/topic/${topicId}` : location.href;
  }

  function getCurrentTopicContext() {
    const topicId = getTopicIdFromPath();
    return {
      ok: true,
      isTopicPage: isTopicPage(),
      title: getTopicTitle(),
      url: location.href,
      canonicalUrl: getCanonicalTopicUrl(topicId),
      topicId,
      currentPostNumber: getCurrentPostNumberFromPath()
    };
  }

  function getClosestPostNumber(element) {
    const post = element?.closest?.("[data-post-number], article[id*='post_'], .topic-post");
    const explicit = post?.getAttribute?.("data-post-number");
    if (explicit) return Number(explicit) || null;
    const id = post?.id || "";
    const match = id.match(/post_(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function classifyResourceUrl(url) {
    const value = String(url || "").toLowerCase();
    if (/github\.com|gist\.github\.com/.test(value)) return "github";
    if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/.test(value) || /\/uploads\//.test(value)) return "image";
    if (/docs\.|developer\.|readme|wiki|notion\.site|notion\.so|yuque|feishu|larksuite|gitbook|mdn|doc/.test(value)) return "docs";
    if (/pan\.baidu|aliyundrive|alipan|115\.com|123pan|cloud\.189|lanzou|drive\.google|dropbox|onedrive/.test(value)) return "cloud-drive";
    if (/\/api\/|api\.|openapi|swagger|graphql/.test(value)) return "api";
    if (/\.(zip|rar|7z|tar|gz|exe|dmg|pkg|apk|ipa|pdf|docx?|xlsx?|pptx?)(\?|#|$)/.test(value) || /download|release|attachment/.test(value)) return "download";
    return "other";
  }

  function extractCurrentTopicResources() {
    if (!isTopicPage()) {
      return { ok: true, isTopicPage: false, links: [], codeBlocks: [] };
    }

    const roots = Array.from(document.querySelectorAll(".topic-post .cooked, article .cooked, .cooked"));
    const scope = roots.length ? roots : [document.querySelector("#main-outlet") || document.body].filter(Boolean);
    const seenUrls = new Set();
    const links = [];

    for (const root of scope) {
      for (const anchor of root.querySelectorAll("a[href]")) {
        const href = anchor.href;
        if (!href || seenUrls.has(href)) continue;
        if (!/^https?:\/\//i.test(href)) continue;
        seenUrls.add(href);
        links.push({
          type: classifyResourceUrl(href),
          text: (anchor.textContent || href).trim().slice(0, 160),
          url: href,
          postNumber: getClosestPostNumber(anchor)
        });
      }
    }

    const codeBlocks = [];
    const seenCode = new Set();
    for (const root of scope) {
      for (const block of root.querySelectorAll("pre code, pre, code")) {
        const text = (block.textContent || "").trim();
        if (!text || text.length < 2 || seenCode.has(text)) continue;
        seenCode.add(text);
        const classText = String(block.className || "");
        const language = (classText.match(/language-([A-Za-z0-9_+-]+)/)?.[1] || "").trim();
        codeBlocks.push({
          language,
          text: text.slice(0, 12000),
          postNumber: getClosestPostNumber(block)
        });
        if (codeBlocks.length >= 80) break;
      }
    }

    return { ok: true, isTopicPage: true, links: links.slice(0, 200), codeBlocks };
  }

  function normalizeUnreadCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) return null;
    return Math.max(0, Math.floor(count));
  }

  function getUnreadCountFromCurrentUser(currentUser) {
    if (!currentUser || typeof currentUser !== "object") return null;
    for (const field of [
      "all_unread_notifications_count",
      "unread_notifications",
      "unread_notification_count",
      "unread_high_priority_notifications"
    ]) {
      const count = normalizeUnreadCount(currentUser[field]);
      if (count !== null) return count;
    }
    return null;
  }

  async function refreshLinuxdoUnread() {
    try {
      const response = await fetch("/session/current.json", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) return;

      const data = await response.json();
      const currentUser = data?.current_user || data?.currentUser || null;
      const count = currentUser ? getUnreadCountFromCurrentUser(currentUser) : 0;
      if (count === null) return;

      const result = chrome.runtime.sendMessage({
        action: "linuxdoUnreadDetected",
        count
      });
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (error) {
      // 网络或 Cloudflare 状态不稳定时保留上一次已知数量。
    }
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

  function normalizedConfig(raw) {
    return {
      ...DEFAULT_CONFIG,
      ...(raw || {}),
      base64DecoderEnabled: raw?.base64DecoderEnabled === true,
      sensitiveScanEnabled: raw?.sensitiveScanEnabled !== false,
      currentTopicEnhanceEnabled: raw?.currentTopicEnhanceEnabled !== false
    };
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

  const BASE64_DECODER_ROOT_CLASS = "checheck-b64-root";
  const BASE64_DECODER_UI_CLASS = "checheck-b64-ui";
  const BASE64_DECODER_STYLE_ID = "checheck-b64-decoder-style";
  const BASE64_MIN_LENGTH = 24;
  const BASE64_MAX_LENGTH = 16000;
  const BASE64_MAX_RESULTS_PER_PASS = 160;
  const BASE64_CANDIDATE_PATTERN =
    /(?:^|[^A-Za-z0-9+/=_-])([A-Za-z0-9+/_-]{24,}={0,2})(?=$|[^A-Za-z0-9+/=_-])/g;

  let base64ScanTimer = 0;
  let base64Observer = null;

  function ensureBase64DecoderStyles() {
    if (document.getElementById(BASE64_DECODER_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = BASE64_DECODER_STYLE_ID;
    style.textContent = `
      .${BASE64_DECODER_ROOT_CLASS} {
        display: inline;
      }

      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-token {
        border-radius: 3px;
        background: rgba(255, 213, 79, 0.18);
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        padding: 0 2px;
      }

      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-button,
      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-copy {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 20px;
        margin: 0 4px;
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.95);
        color: #2f5d8c;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        padding: 2px 6px;
        vertical-align: baseline;
      }

      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-button:hover,
      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-copy:hover {
        border-color: rgba(47, 93, 140, 0.45);
        background: #f4f8ff;
      }

      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-result[hidden] {
        display: none !important;
      }

      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-result {
        display: block;
        box-sizing: border-box;
        max-width: min(760px, calc(100vw - 48px));
        max-height: 280px;
        overflow: auto;
        margin: 6px 0 8px;
        border: 1px solid rgba(47, 93, 140, 0.22);
        border-radius: 6px;
        background: #f8fbff;
        color: #17202a;
        font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        padding: 8px 10px;
      }

      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-meta {
        display: block;
        color: #62748a;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin-bottom: 6px;
      }

      .${BASE64_DECODER_ROOT_CLASS} .checheck-b64-output {
        display: block;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function normalizeBase64Candidate(raw) {
    const compact = String(raw || "").replace(/\s+/g, "");
    if (compact.length < BASE64_MIN_LENGTH || compact.length > BASE64_MAX_LENGTH) {
      return null;
    }
    if (!/[A-Za-z]/.test(compact)) return null;
    if (/^[0-9a-f]+$/i.test(compact)) return null;
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
    if (/=/.test(compact.slice(0, -2))) return null;

    const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
    const remainder = normalized.length % 4;
    if (remainder === 1) return null;
    return normalized + "=".repeat((4 - remainder) % 4);
  }

  function decodeBase64Text(raw) {
    const normalized = normalizeBase64Candidate(raw);
    if (!normalized) return null;

    try {
      const binary = atob(normalized);
      if (binary.length < 4) return null;

      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      let text = "";
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        return null;
      }

      if (!looksLikeReadableDecodedText(text)) return null;

      return {
        text,
        byteLength: bytes.length,
        truncated: text.length > 8000
      };
    } catch (error) {
      return null;
    }
  }

  function looksLikeReadableDecodedText(text) {
    const trimmed = String(text || "").trim();
    if (trimmed.length < 3) return false;

    let total = 0;
    let readable = 0;
    for (const char of text) {
      const code = char.codePointAt(0);
      total += 1;
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
        readable += 1;
      }
    }

    return total > 0 && readable / total >= 0.9;
  }

  function findBase64Candidates(text) {
    const candidates = [];
    BASE64_CANDIDATE_PATTERN.lastIndex = 0;

    let match;
    while ((match = BASE64_CANDIDATE_PATTERN.exec(text))) {
      const raw = match[1];
      const decoded = decodeBase64Text(raw);
      if (!decoded) continue;

      const start = match.index + match[0].indexOf(raw);
      candidates.push({
        raw,
        start,
        end: start + raw.length
      });
    }

    return candidates;
  }

  function shouldSkipBase64Node(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (!node.nodeValue || node.nodeValue.length < BASE64_MIN_LENGTH) return true;
    return !!parent.closest(
      [
        `.${BASE64_DECODER_ROOT_CLASS}`,
        `.${BASE64_DECODER_UI_CLASS}`,
        "script",
        "style",
        "textarea",
        "input",
        "select",
        "button",
        "[contenteditable='true']"
      ].join(",")
    );
  }

  function createBase64Wrapper(raw) {
    const wrapper = document.createElement("span");
    wrapper.className = BASE64_DECODER_ROOT_CLASS;

    const token = document.createElement("span");
    token.className = "checheck-b64-token";
    token.textContent = raw;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `checheck-b64-button ${BASE64_DECODER_UI_CLASS}`;
    button.textContent = "解码";
    button.title = "解码这段可疑 Base64";

    const result = document.createElement("span");
    result.className = `checheck-b64-result ${BASE64_DECODER_UI_CLASS}`;
    result.hidden = true;

    let rendered = false;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!rendered) {
        renderBase64Result(raw, result);
        rendered = true;
      }

      result.hidden = !result.hidden;
      button.textContent = result.hidden ? "解码" : "收起";
    });

    wrapper.append(token, button, result);
    return wrapper;
  }

  function renderBase64Result(raw, resultElement) {
    const decoded = decodeBase64Text(raw);
    resultElement.textContent = "";

    if (!decoded) {
      resultElement.textContent = "解码失败：这段内容不像可读的 UTF-8 Base64。";
      return;
    }

    const meta = document.createElement("span");
    meta.className = "checheck-b64-meta";
    meta.textContent = `UTF-8 文本，${decoded.byteLength} bytes`;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = `checheck-b64-copy ${BASE64_DECODER_UI_CLASS}`;
    copyButton.textContent = "复制";
    copyButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(decoded.text);
        copyButton.textContent = "已复制";
        window.setTimeout(() => {
          copyButton.textContent = "复制";
        }, 1200);
      } catch (error) {
        copyButton.textContent = "复制失败";
        window.setTimeout(() => {
          copyButton.textContent = "复制";
        }, 1200);
      }
    });
    meta.appendChild(copyButton);

    const output = document.createElement("span");
    output.className = "checheck-b64-output";
    output.textContent = decoded.truncated
      ? `${decoded.text.slice(0, 8000)}\n\n... 已截断，仅显示前 8000 个字符`
      : decoded.text;

    resultElement.append(meta, output);
  }

  function decorateBase64TextNode(node) {
    const text = node.nodeValue;
    const candidates = findBase64Candidates(text);
    if (candidates.length === 0) return 0;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const candidate of candidates) {
      if (candidate.start < cursor) continue;
      fragment.appendChild(document.createTextNode(text.slice(cursor, candidate.start)));
      fragment.appendChild(createBase64Wrapper(candidate.raw));
      cursor = candidate.end;
    }

    fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(fragment, node);
    return candidates.length;
  }

  function getBase64ScanRoots() {
    const roots = Array.from(
      document.querySelectorAll(".topic-post .cooked, article .cooked, .cooked")
    );
    if (roots.length > 0) return roots;

    if (!isTopicPage()) return [];
    return [document.querySelector("#main-outlet") || document.body].filter(Boolean);
  }

  function scanSuspiciousBase64() {
    if (!state.config.base64DecoderEnabled || !document.body || !isTopicPage()) return;

    ensureBase64DecoderStyles();
    let decoratedCount = 0;

    for (const root of getBase64ScanRoots()) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (shouldSkipBase64Node(node)) return NodeFilter.FILTER_REJECT;
          if (!BASE64_CANDIDATE_PATTERN.test(node.nodeValue)) {
            BASE64_CANDIDATE_PATTERN.lastIndex = 0;
            return NodeFilter.FILTER_REJECT;
          }
          BASE64_CANDIDATE_PATTERN.lastIndex = 0;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      for (const node of textNodes) {
        decoratedCount += decorateBase64TextNode(node);
        if (decoratedCount >= BASE64_MAX_RESULTS_PER_PASS) return;
      }
    }
  }

  function scheduleSuspiciousBase64Scan(delay = 250) {
    if (!state.config.base64DecoderEnabled) return;
    if (base64ScanTimer) window.clearTimeout(base64ScanTimer);
    base64ScanTimer = window.setTimeout(() => {
      base64ScanTimer = 0;
      scanSuspiciousBase64();
    }, delay);
  }

  function initSuspiciousBase64Decoder() {
    if (!state.config.base64DecoderEnabled) return;
    scheduleSuspiciousBase64Scan(150);

    if (base64Observer) return;
    base64Observer = new MutationObserver(() => {
      scheduleSuspiciousBase64Scan(350);
    });
    base64Observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function unwrapSuspiciousBase64Decoder() {
    for (const wrapper of document.querySelectorAll(`.${BASE64_DECODER_ROOT_CLASS}`)) {
      const token = wrapper.querySelector(".checheck-b64-token");
      const parent = wrapper.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(token ? token.textContent : wrapper.textContent), wrapper);
      parent.normalize();
    }
  }

  function stopSuspiciousBase64Decoder() {
    if (base64ScanTimer) {
      window.clearTimeout(base64ScanTimer);
      base64ScanTimer = 0;
    }
    if (base64Observer) {
      base64Observer.disconnect();
      base64Observer = null;
    }
    unwrapSuspiciousBase64Decoder();
  }

  function syncSuspiciousBase64Decoder() {
    if (state.config.base64DecoderEnabled) {
      initSuspiciousBase64Decoder();
    } else {
      stopSuspiciousBase64Decoder();
    }
  }

  const SENSITIVE_RULES = [
    { type: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, severity: "high", label: "疑似 OpenAI API Key" },
    { type: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "high", label: "疑似 Anthropic API Key" },
    { type: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, severity: "high", label: "疑似 GitHub Token" },
    { type: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/gi, severity: "high", label: "疑似 Bearer Token" },
    { type: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, severity: "high", label: "疑似 JWT" },
    { type: "cookie", pattern: /\b(cookie|set-cookie)\s*:\s*[^;\n]{20,}/gi, severity: "high", label: "疑似 Cookie" },
    { type: "authorization-header", pattern: /\bauthorization\s*:\s*[^\n]{12,}/gi, severity: "high", label: "疑似 Authorization Header" },
    { type: "env-secret", pattern: /\b[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*.+/g, severity: "medium", label: "疑似 .env 密钥配置" },
    { type: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, severity: "low", label: "可能包含邮箱地址" },
    { type: "phone", pattern: /\b(?:\+?86[-\s]?)?1[3-9]\d{9}\b/g, severity: "low", label: "可能包含手机号" },
    { type: "private-ip", pattern: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g, severity: "low", label: "可能包含内网 IP" }
  ];

  let sensitiveScanTimer = 0;
  let sensitiveObserver = null;

  function maskSensitiveValue(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= 12) return text;
    const bearer = text.match(/^Bearer\s+(.+)$/i);
    if (bearer) return `Bearer ...${bearer[1].slice(-4)}`;
    const header = text.match(/^([A-Za-z-]+)\s*:\s*(.+)$/);
    if (header) return `${header[1]}: ...${header[2].slice(-4)}`;
    const env = text.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (env) return `${env[1]}=...${env[2].slice(-4)}`;
    return `${text.slice(0, Math.min(6, Math.ceil(text.length / 3)))}...${text.slice(-4)}`;
  }

  function detectSensitiveText(text) {
    const source = String(text || "");
    if (!source.trim()) return [];
    const risks = [];

    for (const rule of SENSITIVE_RULES) {
      rule.pattern.lastIndex = 0;
      const previews = [];
      let match;
      while ((match = rule.pattern.exec(source))) {
        const preview = maskSensitiveValue(match[0]);
        if (!previews.includes(preview)) previews.push(preview);
        if (previews.length >= 5) break;
      }
      if (previews.length) {
        risks.push({
          type: rule.type,
          severity: rule.severity,
          label: rule.label,
          preview: previews[0],
          previews,
          count: previews.length
        });
      }
    }

    const order = { high: 0, medium: 1, low: 2 };
    return risks.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  }

  function getEditorElements() {
    return Array.from(document.querySelectorAll([
      "textarea",
      ".d-editor-input",
      "[contenteditable='true']",
      ".ProseMirror"
    ].join(","))).filter(isVisible);
  }

  function getEditorText() {
    return getEditorElements()
      .map(element => {
        if ("value" in element) return element.value || "";
        return element.textContent || "";
      })
      .join("\n");
  }

  function notifySensitiveRisks(risks) {
    try {
      const response = chrome.runtime.sendMessage({
        type: "linuxdo-sensitive-scan-result",
        risks,
        updatedAt: Date.now()
      });
      if (response && typeof response.catch === "function") response.catch(() => {});
    } catch (error) {
      // Popup may be closed.
    }
  }

  function runSensitiveScan() {
    if (!state.config.sensitiveScanEnabled || location.hostname !== "linux.do") {
      state.sensitiveRisks = [];
      return;
    }
    const risks = detectSensitiveText(getEditorText());
    const oldText = JSON.stringify(state.sensitiveRisks);
    const newText = JSON.stringify(risks);
    state.sensitiveRisks = risks;
    if (oldText !== newText) notifySensitiveRisks(risks);
  }

  function scheduleSensitiveScan(delay = 250) {
    if (!state.config.sensitiveScanEnabled) return;
    if (sensitiveScanTimer) window.clearTimeout(sensitiveScanTimer);
    sensitiveScanTimer = window.setTimeout(() => {
      sensitiveScanTimer = 0;
      runSensitiveScan();
    }, delay);
  }

  function initSensitiveScanner() {
    if (!state.config.sensitiveScanEnabled || sensitiveObserver) return;
    document.addEventListener("input", () => scheduleSensitiveScan(150), true);
    document.addEventListener("paste", () => scheduleSensitiveScan(250), true);
    sensitiveObserver = new MutationObserver(() => scheduleSensitiveScan(400));
    sensitiveObserver.observe(document.documentElement, { childList: true, subtree: true });
    scheduleSensitiveScan(300);
  }

  function syncSensitiveScanner() {
    if (state.config.sensitiveScanEnabled) {
      initSensitiveScanner();
      scheduleSensitiveScan(100);
    } else {
      state.sensitiveRisks = [];
      notifySensitiveRisks([]);
    }
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

  function loadConfig(callback) {
    chrome.storage.local.get({ [CONFIG_KEY]: DEFAULT_CONFIG }, (stored) => {
      state.config = normalizedConfig(stored[CONFIG_KEY]);
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

    if (message.type === "linuxdo-current-topic-get") {
      if (!state.config.currentTopicEnhanceEnabled) {
        sendResponse({ ok: false, isTopicPage: false, message: "当前帖子增强已关闭" });
        return true;
      }
      sendResponse(getCurrentTopicContext());
      return true;
    }

    if (message.type === "linuxdo-current-topic-extract-resources") {
      if (!state.config.currentTopicEnhanceEnabled) {
        sendResponse({ ok: false, isTopicPage: false, links: [], codeBlocks: [], message: "当前帖子增强已关闭" });
        return true;
      }
      sendResponse(extractCurrentTopicResources());
      return true;
    }

    if (message.type === "linuxdo-sensitive-scan-get") {
      runSensitiveScan();
      sendResponse({
        ok: true,
        risks: state.sensitiveRisks,
        updatedAt: Date.now()
      });
      return true;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes[STORAGE_KEY]) {
      state.settings = normalizedSettings({
        ...state.settings,
        ...(changes[STORAGE_KEY].newValue || {})
      });
    }

    if (changes[CONFIG_KEY]) {
      state.config = normalizedConfig(changes[CONFIG_KEY].newValue);
      syncSuspiciousBase64Decoder();
      syncSensitiveScanner();
    }
  });

  loadSettings(() => {
    setStatus("idle");
    loadConfig(() => {
      syncSuspiciousBase64Decoder();
      syncSensitiveScanner();
    });
  });

  refreshLinuxdoUnread();
  window.setInterval(refreshLinuxdoUnread, UNREAD_REFRESH_INTERVAL);
  window.addEventListener("focus", refreshLinuxdoUnread);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshLinuxdoUnread();
  });
})();
