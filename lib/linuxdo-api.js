const LINUXDO_ORIGIN = 'https://linux.do';

async function fetchLinuxdoJson(path) {
  const response = await fetch(`${LINUXDO_ORIGIN}${path}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const error = new Error(`Linux.do 返回 ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function toTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeCount(value, fallback = 0) {
  const count = Number(value);
  if (!Number.isFinite(count)) return fallback;
  return Math.max(0, Math.floor(count));
}

function normalizeTag(tag) {
  if (typeof tag === 'string') return tag.trim();
  if (tag == null) return '';
  if (typeof tag === 'object') {
    return String(tag.name || tag.text || tag.slug || tag.id || '').trim();
  }
  return String(tag).trim();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(normalizeTag).filter(Boolean);
}

function normalizeUrl(topic) {
  if (topic?.url) {
    return String(topic.url).startsWith('http')
      ? topic.url
      : `${LINUXDO_ORIGIN}${topic.url}`;
  }

  if (topic?.slug && topic?.id) {
    return `${LINUXDO_ORIGIN}/t/${topic.slug}/${topic.id}`;
  }

  if (topic?.id) {
    return `${LINUXDO_ORIGIN}/t/topic/${topic.id}`;
  }

  return LINUXDO_ORIGIN;
}

function normalizeCategory(category) {
  if (!category?.id) return null;
  return {
    id: category.id,
    name: category.name || category.slug || `分类 ${category.id}`,
    slug: category.slug || '',
    parentCategoryId: category.parent_category_id ?? category.parentCategoryId ?? null,
    color: category.color || '',
    textColor: category.text_color || category.textColor || '',
    position: Number.isFinite(Number(category.position)) ? Number(category.position) : 9999,
    topicCount: normalizeCount(category.topic_count ?? category.topicCount, 0),
    readRestricted: !!(category.read_restricted ?? category.readRestricted)
  };
}

export function normalizeCategories(data) {
  const categories = data?.category_list?.categories || data?.categories || [];
  return categories
    .map(normalizeCategory)
    .filter(Boolean)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'zh-CN'));
}

function buildCategoryMap(categoriesOrData) {
  const categories = Array.isArray(categoriesOrData)
    ? categoriesOrData
    : normalizeCategories(categoriesOrData);
  return new Map(categories.map(category => [category.id, category.name || category.slug || '']));
}

function getPosters(topic) {
  return Array.isArray(topic?.posters) ? topic.posters : [];
}

function getLastPosterUsername(topic) {
  const posters = getPosters(topic);
  const latestPoster = posters.find(poster => String(poster?.description || '').includes('最新'));
  const fallbackPoster = posters[posters.length - 1] || posters[0];
  return latestPoster?.user?.username || fallbackPoster?.user?.username || topic?.last_poster_username || '';
}

function normalizeTopic(topic, categoryMap = new Map()) {
  const categoryId = topic?.category_id ?? topic?.categoryId ?? null;
  return {
    id: topic?.id,
    title: topic?.title || '未命名主题',
    url: normalizeUrl(topic),
    categoryId,
    categoryName: topic?.category_name || topic?.categoryName || categoryMap.get(categoryId) || '',
    tags: normalizeTags(topic?.tags),
    postsCount: normalizeCount(topic?.posts_count ?? topic?.postsCount, 0),
    replyCount: normalizeCount(topic?.reply_count ?? topic?.replyCount, 0),
    views: normalizeCount(topic?.views, 0),
    likeCount: normalizeCount(topic?.like_count ?? topic?.likeCount, 0),
    lastPostedAt: toTimestamp(topic?.last_posted_at ?? topic?.lastPostedAt),
    bumpedAt: toTimestamp(topic?.bumped_at ?? topic?.bumpedAt),
    lastPosterUsername: getLastPosterUsername(topic)
  };
}

export function normalizeTopicList(data, categories = null) {
  const categoryMap = buildCategoryMap(categories || data);
  const topics = data?.topic_list?.topics || data?.topics || [];
  return topics.map(topic => normalizeTopic(topic, categoryMap)).filter(topic => topic.id);
}

function getCurrentUserUnreadCount(currentUser) {
  const fields = [
    'all_unread_notifications_count',
    'unread_notifications',
    'unread_notification_count',
    'unread_high_priority_notifications'
  ];

  for (const field of fields) {
    if (currentUser?.[field] != null) {
      return normalizeCount(currentUser[field], 0);
    }
  }

  return 0;
}

function getCurrentUserPrivateMessageCount(currentUser) {
  const fields = [
    'unread_private_messages',
    'unread_private_message_count',
    'unread_personal_messages'
  ];

  for (const field of fields) {
    if (currentUser?.[field] != null) {
      return normalizeCount(currentUser[field], 0);
    }
  }

  return 0;
}

function normalizeAvatarUrl(avatarTemplate) {
  if (!avatarTemplate) return '';
  const sized = String(avatarTemplate).replace('{size}', '64');
  return sized.startsWith('http') ? sized : `${LINUXDO_ORIGIN}${sized}`;
}

function normalizeCurrentUser(currentUser) {
  const updatedAt = Date.now();
  if (!currentUser) {
    return {
      ok: true,
      loggedIn: false,
      unreadCount: 0,
      privateMessageCount: 0,
      updatedAt
    };
  }

  return {
    ok: true,
    loggedIn: true,
    unreadCount: getCurrentUserUnreadCount(currentUser),
    privateMessageCount: getCurrentUserPrivateMessageCount(currentUser),
    username: currentUser.username || currentUser.name || '',
    avatarUrl: normalizeAvatarUrl(currentUser.avatar_template || currentUser.avatarUrl),
    updatedAt
  };
}

export async function getCurrentUser() {
  try {
    const data = await fetchLinuxdoJson('/session/current.json');
    const currentUser = data?.current_user || data?.currentUser || null;
    return normalizeCurrentUser(currentUser);
  } catch (error) {
    if ([401, 404].includes(error.status)) {
      return normalizeCurrentUser(null);
    }
    throw error;
  }
}

export async function getLatestTopics({ limit = 10 } = {}) {
  const data = await fetchLinuxdoJson('/latest.json');
  return normalizeTopicList(data).slice(0, limit);
}

export async function getTopTopics({ period = 'daily', limit = 10 } = {}) {
  const safePeriod = ['daily', 'weekly', 'monthly', 'yearly', 'all'].includes(period) ? period : 'daily';
  const data = await fetchLinuxdoJson(`/top.json?period=${encodeURIComponent(safePeriod)}`);
  return normalizeTopicList(data).slice(0, limit);
}

export async function getCategories() {
  const data = await fetchLinuxdoJson('/site.json');
  return normalizeCategories(data);
}

export async function getTopicDetail(topicId) {
  const data = await fetchLinuxdoJson(`/t/topic/${encodeURIComponent(topicId)}.json`);
  const posts = data?.post_stream?.posts || [];
  return {
    id: data?.id,
    title: data?.title || '未命名主题',
    url: normalizeUrl(data),
    tags: normalizeTags(data?.tags),
    postsCount: normalizeCount(data?.posts_count, posts.length),
    posts: posts.map(post => ({
      id: post?.id,
      postNumber: post?.post_number,
      username: post?.username || '',
      cooked: post?.cooked || '',
      text: String(post?.cooked || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      createdAt: toTimestamp(post?.created_at)
    }))
  };
}
