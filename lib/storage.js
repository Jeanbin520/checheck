const STORAGE_KEY = 'sites';
const CONFIG_KEY = 'config';

const DEFAULT_CONFIG = {
  closeDelay: 3,
  scheduleEnabled: false,
  scheduleTime: '09:00',
  base64DecoderEnabled: false,
  sensitiveScanEnabled: true,
  currentTopicEnhanceEnabled: true,
  showLogsPanel: false
};

function normalizeSiteUrl(url) {
  const normalized = new URL(String(url || '').trim());
  normalized.hash = '';
  return normalized.href;
}

function normalizeSiteInput(site = {}) {
  const name = String(site.name || '').trim();
  if (!name) throw new Error('请输入站点名称');

  let url;
  try {
    url = normalizeSiteUrl(site.url);
  } catch {
    throw new Error('请输入有效的站点 URL');
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error('站点 URL 必须以 http:// 或 https:// 开头');
  }

  return { ...site, name, url, enabled: site.enabled !== false };
}

export async function getSites() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const sites = result[STORAGE_KEY] || [];
  console.log('[签到助手 Storage] getSites:', sites.length, '个站点');
  return sites;
}

export async function saveSites(sites) {
  await chrome.storage.local.set({ [STORAGE_KEY]: sites });
}

export async function addSite(site) {
  const normalizedSite = normalizeSiteInput(site);
  console.log('[签到助手 Storage] addSite:', normalizedSite);
  const sites = await getSites();
  if (sites.some(s => normalizeSiteUrl(s.url) === normalizedSite.url)) {
    throw new Error('站点已存在');
  }
  normalizedSite.id = Date.now().toString(36);
  normalizedSite.addedAt = Date.now();
  sites.push(normalizedSite);
  await saveSites(sites);
  console.log('[签到助手 Storage] 站点已添加:', normalizedSite.id, normalizedSite.name);
  return normalizedSite;
}

export async function updateSite(id, patch = {}) {
  const sites = await getSites();
  const site = sites.find(s => s.id === id);
  if (!site) {
    throw new Error('站点不存在');
  }

  const nextSite = normalizeSiteInput({ ...site, ...patch });
  if (sites.some(s => s.id !== id && normalizeSiteUrl(s.url) === nextSite.url)) {
    throw new Error('站点已存在');
  }

  Object.assign(site, nextSite, { updatedAt: Date.now() });
  await saveSites(sites);
  return site;
}

export async function removeSite(id) {
  const sites = await getSites();
  const filtered = sites.filter(s => s.id !== id);
  await saveSites(filtered);
}

export async function updateSiteStatus(id, status) {
  const sites = await getSites();
  const site = sites.find(s => s.id === id);
  if (site) {
    site.lastCheckin = Date.now();
    site.lastStatus = status;
    await saveSites(sites);
  }
}

export async function getConfig() {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...result[CONFIG_KEY] };
}

// 读取现有配置后合并 patch，避免部分保存时丢失其它字段
export async function saveConfig(patch = {}) {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const merged = { ...DEFAULT_CONFIG, ...result[CONFIG_KEY], ...patch };
  await chrome.storage.local.set({ [CONFIG_KEY]: merged });
  return merged;
}
