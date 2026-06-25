const KEYWORDS_KEY = 'linuxdoKeywords';
const KEYWORD_MATCHES_KEY = 'linuxdoKeywordMatches';
const READ_LATER_KEY = 'linuxdoReadLater';
const CURRENT_TOPIC_CACHE_KEY = 'linuxdoCurrentTopicCache';

const MATCH_STATUSES = new Set(['unread', 'read', 'ignored']);
const READ_LATER_STATUSES = new Set(['unread', 'read', 'archived']);

function nowId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map(tag => {
      if (typeof tag === 'string') return tag.trim();
      if (tag && typeof tag === 'object') return String(tag.name || tag.text || tag.slug || tag.id || '').trim();
      return String(tag || '').trim();
    })
    .filter(Boolean);
}

function normalizeKeywordText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function normalizeKeyword(keyword) {
  const text = normalizeKeywordText(keyword?.text);
  if (!text) return null;
  const createdAt = Number(keyword?.createdAt) || Date.now();
  return {
    id: keyword?.id || nowId('kw'),
    text,
    enabled: keyword?.enabled !== false,
    createdAt,
    lastMatchedAt: Number(keyword?.lastMatchedAt) || null
  };
}

function normalizeTopic(topic = {}) {
  const url = String(topic.url || '').trim();
  if (!url) throw new Error('缺少主题 URL');
  return {
    topicId: topic.id ?? topic.topicId ?? null,
    title: String(topic.title || '未命名主题').trim() || '未命名主题',
    url,
    categoryName: String(topic.categoryName || '').trim(),
    categoryId: topic.categoryId ?? null,
    tags: normalizeTags(topic.tags),
    excerpt: String(topic.excerpt || topic.summary || '').trim()
  };
}

async function getArray(key) {
  const result = await chrome.storage.local.get(key);
  return Array.isArray(result[key]) ? result[key] : [];
}

async function setArray(key, value) {
  await chrome.storage.local.set({ [key]: Array.isArray(value) ? value : [] });
}

export async function listLinuxdoKeywords() {
  const items = await getArray(KEYWORDS_KEY);
  return items.map(normalizeKeyword).filter(Boolean);
}

export async function saveLinuxdoKeyword(input) {
  const incoming = normalizeKeyword(input);
  if (!incoming) throw new Error('关键词不能为空');

  const keywords = await listLinuxdoKeywords();
  const duplicated = keywords.find(item => (
    item.id !== incoming.id &&
    item.text.toLowerCase() === incoming.text.toLowerCase()
  ));
  if (duplicated) {
    duplicated.enabled = incoming.enabled;
    duplicated.lastMatchedAt = incoming.lastMatchedAt || duplicated.lastMatchedAt || null;
    await setArray(KEYWORDS_KEY, keywords);
    return { ok: true, keyword: duplicated, created: false, message: '关键词已存在，已更新状态' };
  }

  const existing = keywords.find(item => item.id === incoming.id);
  if (existing) {
    Object.assign(existing, {
      text: incoming.text,
      enabled: incoming.enabled,
      lastMatchedAt: incoming.lastMatchedAt || existing.lastMatchedAt || null
    });
    await setArray(KEYWORDS_KEY, keywords);
    return { ok: true, keyword: existing, created: false, message: '关键词已更新' };
  }

  keywords.unshift(incoming);
  await setArray(KEYWORDS_KEY, keywords);
  return { ok: true, keyword: incoming, created: true, message: '关键词已添加' };
}

export async function deleteLinuxdoKeyword(id) {
  const keywords = await listLinuxdoKeywords();
  const nextKeywords = keywords.filter(item => item.id !== id);
  const matches = await listLinuxdoKeywordMatches();
  const nextMatches = matches.filter(item => item.keywordId !== id);
  await chrome.storage.local.set({
    [KEYWORDS_KEY]: nextKeywords,
    [KEYWORD_MATCHES_KEY]: nextMatches
  });
  return { ok: true, deleted: nextKeywords.length !== keywords.length };
}

function getTopicSearchFields(topic) {
  return {
    title: topic.title || '',
    tags: normalizeTags(topic.tags).join(' '),
    category: topic.categoryName || '',
    excerpt: topic.excerpt || topic.summary || ''
  };
}

function matchKeyword(topic, keywordText) {
  const needle = String(keywordText || '').trim().toLowerCase();
  if (!needle) return [];
  const fields = getTopicSearchFields(topic);
  return Object.entries(fields)
    .filter(([, value]) => String(value || '').toLowerCase().includes(needle))
    .map(([field]) => field);
}

export async function listLinuxdoKeywordMatches() {
  const items = await getArray(KEYWORD_MATCHES_KEY);
  return items.filter(item => item && item.id && item.keywordId && item.url);
}

export async function refreshLinuxdoKeywordMatches(topics = []) {
  const keywords = (await listLinuxdoKeywords()).filter(keyword => keyword.enabled);
  const matches = await listLinuxdoKeywordMatches();
  const now = Date.now();
  let created = 0;
  let updated = 0;

  for (const keyword of keywords) {
    let keywordMatched = false;
    for (const rawTopic of topics) {
      const topic = normalizeTopic(rawTopic);
      const matchedFields = matchKeyword(topic, keyword.text);
      if (matchedFields.length === 0) continue;
      keywordMatched = true;

      const existing = matches.find(item => (
        item.keywordId === keyword.id &&
        (
          (topic.topicId != null && String(item.topicId) === String(topic.topicId)) ||
          item.url === topic.url
        )
      ));

      if (existing) {
        Object.assign(existing, {
          keyword: keyword.text,
          title: topic.title,
          url: topic.url,
          topicId: topic.topicId,
          categoryName: topic.categoryName,
          tags: topic.tags,
          matchedFields,
          matchedAt: existing.matchedAt || now,
          updatedAt: now
        });
        updated += 1;
      } else {
        matches.unshift({
          id: nowId('match'),
          keywordId: keyword.id,
          keyword: keyword.text,
          topicId: topic.topicId,
          title: topic.title,
          url: topic.url,
          categoryName: topic.categoryName,
          tags: topic.tags,
          matchedFields,
          status: 'unread',
          matchedAt: now,
          updatedAt: now
        });
        created += 1;
      }
    }
    if (keywordMatched) keyword.lastMatchedAt = now;
  }

  await chrome.storage.local.set({
    [KEYWORDS_KEY]: await listLinuxdoKeywords().then(all => all.map(item => {
      const matched = keywords.find(keyword => keyword.id === item.id);
      return matched || item;
    })),
    [KEYWORD_MATCHES_KEY]: matches.slice(0, 200)
  });

  return { ok: true, keywords: await listLinuxdoKeywords(), matches: await listLinuxdoKeywordMatches(), created, updated, updatedAt: now };
}

export async function updateLinuxdoKeywordMatchStatus(id, status) {
  if (!MATCH_STATUSES.has(status)) throw new Error('无效的命中状态');
  const matches = await listLinuxdoKeywordMatches();
  const item = matches.find(match => match.id === id);
  if (!item) throw new Error('未找到命中结果');
  item.status = status;
  item.updatedAt = Date.now();
  await setArray(KEYWORD_MATCHES_KEY, matches);
  return { ok: true, item };
}

export async function listLinuxdoReadLater() {
  const items = await getArray(READ_LATER_KEY);
  return items.filter(item => item && item.id && item.url);
}

export async function addLinuxdoReadLater(topic, patch = {}) {
  const normalized = normalizeTopic(topic);
  const items = await listLinuxdoReadLater();
  const now = Date.now();
  const existing = items.find(item => (
    (normalized.topicId != null && String(item.topicId) === String(normalized.topicId)) ||
    item.url === normalized.url
  ));

  const customTags = normalizeTags(patch.customTags);
  const note = patch.note != null ? String(patch.note) : '';

  if (existing) {
    Object.assign(existing, {
      ...normalized,
      note: patch.note != null ? note : (existing.note || ''),
      customTags: patch.customTags != null ? customTags : normalizeTags(existing.customTags),
      status: READ_LATER_STATUSES.has(patch.status) ? patch.status : (existing.status || 'unread'),
      addedAt: existing.addedAt || now,
      updatedAt: now
    });
    await setArray(READ_LATER_KEY, items);
    return { ok: true, item: existing, created: false, message: '已更新稍后读' };
  }

  const item = {
    id: nowId('rl'),
    ...normalized,
    note,
    customTags,
    status: READ_LATER_STATUSES.has(patch.status) ? patch.status : 'unread',
    addedAt: now,
    updatedAt: now
  };
  items.unshift(item);
  await setArray(READ_LATER_KEY, items);
  return { ok: true, item, created: true, message: '已加入稍后读' };
}

export async function updateLinuxdoReadLater(id, patch = {}) {
  const items = await listLinuxdoReadLater();
  const item = items.find(entry => entry.id === id);
  if (!item) throw new Error('未找到稍后读条目');

  if (patch.title != null) item.title = String(patch.title).trim() || item.title;
  if (patch.note != null) item.note = String(patch.note);
  if (patch.customTags != null) item.customTags = normalizeTags(patch.customTags);
  if (patch.status != null) {
    if (!READ_LATER_STATUSES.has(patch.status)) throw new Error('无效的阅读状态');
    item.status = patch.status;
  }
  item.updatedAt = Date.now();

  await setArray(READ_LATER_KEY, items);
  return { ok: true, item };
}

export async function removeLinuxdoReadLater(id) {
  const items = await listLinuxdoReadLater();
  const next = items.filter(item => item.id !== id);
  await setArray(READ_LATER_KEY, next);
  return { ok: true, deleted: next.length !== items.length };
}

function formatReadLaterMarkdown(items) {
  if (!items.length) return '# Linux.do 稍后读\n\n暂无条目。\n';
  const lines = ['# Linux.do 稍后读', ''];
  for (const item of items) {
    const tags = [...normalizeTags(item.tags).map(tag => `#${tag}`), ...normalizeTags(item.customTags).map(tag => `#${tag}`)].join(' ');
    lines.push(`- [${item.title}](${item.url})${item.categoryName ? ` · ${item.categoryName}` : ''}${tags ? ` · ${tags}` : ''}`);
    if (item.note) {
      lines.push(`  - 备注：${String(item.note).replace(/\n/g, '\n    ')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function exportLinuxdoReadLater(format = 'markdown') {
  const items = await listLinuxdoReadLater();
  if (format === 'json') {
    return { ok: true, format: 'json', content: JSON.stringify(items, null, 2), filename: 'linuxdo-read-later.json' };
  }
  return { ok: true, format: 'markdown', content: formatReadLaterMarkdown(items), filename: 'linuxdo-read-later.md' };
}

export async function saveLinuxdoCurrentTopicCache(cache) {
  const value = {
    ...(cache || {}),
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [CURRENT_TOPIC_CACHE_KEY]: value });
  return { ok: true, cache: value };
}
