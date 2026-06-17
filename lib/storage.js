const STORAGE_KEY = 'sites';
const CONFIG_KEY = 'config';

const DEFAULT_CONFIG = {
  closeDelay: 3,
  scheduleEnabled: false,
  scheduleTime: '09:00'
};

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
  console.log('[签到助手 Storage] addSite:', site);
  const sites = await getSites();
  if (sites.some(s => s.url === site.url)) {
    throw new Error('站点已存在');
  }
  site.id = Date.now().toString(36);
  site.addedAt = Date.now();
  sites.push(site);
  await saveSites(sites);
  console.log('[签到助手 Storage] 站点已添加:', site.id, site.name);
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
