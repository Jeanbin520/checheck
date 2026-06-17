import { getSites, addSite, removeSite, getConfig, saveConfig } from '../lib/storage.js';
import { PRESET_SITES } from '../lib/preset-sites.js';

const $ = (sel) => document.querySelector(sel);

async function renderSites() {
  const sites = await getSites();
  const list = $('#site-list');
  list.innerHTML = '';

  if (sites.length === 0) {
    list.innerHTML = '<li style="text-align:center;color:#999;padding:20px;">暂无站点，请从下拉列表添加</li>';
  }

  for (const site of sites) {
    const li = document.createElement('li');
    li.className = 'site-item';
    li.innerHTML = `
      <div class="site-info">
        <div class="site-name">${escapeHtml(site.name)}</div>
        <div class="site-url">${escapeHtml(site.url)}</div>
        ${site.lastStatus ? `<div class="site-status ${site.lastStatus.success ? 'success' : 'fail'}">${escapeHtml(site.lastStatus.message)}</div>` : ''}
      </div>
      <button class="btn-delete" data-id="${site.id}">✕</button>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removeSite(btn.dataset.id);
      renderSites();
      renderDropdown();
    });
  });
}

async function renderDropdown() {
  const sites = await getSites();
  const addedUrls = new Set(sites.map(s => s.url));
  const select = $('#site-select');

  select.innerHTML = '<option value="">-- 选择站点 --</option>';

  for (const preset of PRESET_SITES) {
    if (addedUrls.has(preset.url)) continue;
    const opt = document.createElement('option');
    opt.value = preset.url;
    opt.textContent = `${preset.name} (${preset.url})`;
    select.appendChild(opt);
  }

  if (select.options.length <= 1) {
    select.innerHTML = '<option value="">所有站点已添加</option>';
    $('#add-site').disabled = true;
  } else {
    $('#add-site').disabled = false;
  }
}

async function renderDetected() {
  const items = await chrome.storage.session.get(null);
  const detected = Object.values(items)
    .filter(v => v.detectedAt && Date.now() - v.detectedAt < 3600000)
    .slice(0, 5);

  if (detected.length === 0) return;

  const section = document.createElement('div');
  section.className = 'section';
  section.innerHTML = `<h2>检测到的签到站点</h2>`;

  for (const d of detected) {
    const div = document.createElement('div');
    div.className = 'site-item';
    div.innerHTML = `
      <div class="site-info">
        <div class="site-name">${escapeHtml(d.title || d.url)}</div>
        <div class="site-url">${escapeHtml(d.url)}</div>
      </div>
      <button class="btn-secondary add-detected" data-url="${escapeHtml(d.url)}" data-title="${escapeHtml(d.title || d.url)}">添加</button>
    `;
    section.appendChild(div);
  }

  document.querySelector('.section').before(section);

  section.querySelectorAll('.add-detected').forEach(btn => {
    btn.addEventListener('click', async () => {
      await addSite({ url: btn.dataset.url, name: btn.dataset.title });
      renderSites();
      renderDropdown();
      section.remove();
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

$('#add-site').addEventListener('click', async () => {
  const select = $('#site-select');
  const url = select.value;

  if (!url) {
    alert('请先选择一个站点');
    return;
  }

  const preset = PRESET_SITES.find(s => s.url === url);
  if (!preset) return;

  console.log('[签到助手 Popup] 添加站点:', preset.name, preset.url);

  try {
    const site = await addSite({ name: preset.name, url: preset.url });
    console.log('[签到助手 Popup] 站点添加成功:', site);
    renderSites();
    renderDropdown();
  } catch (e) {
    console.error('[签到助手 Popup] 添加站点失败:', e);
    alert(e.message);
  }
});

$('#checkin-all').addEventListener('click', async () => {
  console.log('[签到助手 Popup] 一键签到按钮被点击');

  const btn = $('#checkin-all');
  btn.disabled = true;
  btn.textContent = '签到中...';
  $('#results').classList.remove('hidden');
  $('#results').innerHTML = '<div style="text-align:center;color:#999;">正在签到，请稍候...</div>';

  try {
    const sites = await getSites();
    console.log('[签到助手 Popup] 当前存储的站点:', sites);
    if (sites.length === 0) {
      btn.disabled = false;
      btn.textContent = '一键签到全部';
      $('#results').innerHTML = '<div style="color:#999;">没有站点，请先从下拉列表添加</div>';
      return;
    }
  } catch (e) {
    console.error('[签到助手 Popup] 读取站点失败:', e);
  }

  try {
    console.log('[签到助手 Popup] 发送 checkinAll 消息...');

    const results = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Service Worker 响应超时(120s)，请检查扩展是否正常加载'));
      }, 120000);

      chrome.runtime.sendMessage({ action: 'checkinAll' }, (response) => {
        clearTimeout(timer);
        console.log('[签到助手 Popup] 收到响应:', response);
        console.log('[签到助手 Popup] lastError:', chrome.runtime.lastError);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

    btn.disabled = false;
    btn.textContent = '一键签到全部';

    if (!results || results.length === 0) {
      $('#results').innerHTML = '<div style="color:#999;">没有站点或签到结果为空</div>';
      return;
    }

    const html = results.map(r => `
      <div class="result-item">
        <strong>${escapeHtml(r.site.name)}</strong>:
        <span style="color:${r.success ? '#34a853' : '#ea4335'}">${escapeHtml(r.message)}</span>
      </div>
    `).join('');
    $('#results').innerHTML = html;

    renderSites();
  } catch (err) {
    console.error('[签到助手 Popup] 异常:', err);
    btn.disabled = false;
    btn.textContent = '一键签到全部';
    $('#results').innerHTML = `<div style="color:red;">错误: ${err.message}</div>`;
  }
});

async function renderLogs() {
  try {
    const logs = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getLogs' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(response || []);
      });
    });

    const area = $('#log-area');
    if (!area) return;

    const wasAtBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 20;

    area.innerHTML = logs.map(entry => {
      const cls = entry.level || 'info';
      return `<div class="log-entry ${cls}"><span class="ts">[${entry.ts}]</span> <span class="msg">${escapeHtml(entry.message)}</span></div>`;
    }).join('');

    if (wasAtBottom) {
      area.scrollTop = area.scrollHeight;
    }
  } catch {}
}

$('#clear-logs').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ action: 'clearLogs' }, () => {
    renderLogs();
  });
});

$('#copy-logs').addEventListener('click', async () => {
  const area = $('#log-area');
  const text = area.innerText || area.textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $('#copy-logs');
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制'; }, 1500);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    const btn = $('#copy-logs');
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制'; }, 1500);
  }
});

// 通知后台根据最新配置重同步定时闹钟
function syncSchedule() {
  try {
    chrome.runtime.sendMessage({ action: 'updateSchedule' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    void e;
  }
}

async function renderConfig() {
  const config = await getConfig();
  const input = $('#close-delay');
  input.value = config.closeDelay;

  input.addEventListener('change', async () => {
    const value = parseInt(input.value, 10);
    if (isNaN(value) || value < 0) {
      input.value = 0;
    }
    if (value > 30) {
      input.value = 30;
    }
    await saveConfig({ closeDelay: parseInt(input.value, 10) });
  });

  // 定时自动签到开关
  const scheduleEnabled = $('#schedule-enabled');
  scheduleEnabled.checked = !!config.scheduleEnabled;
  scheduleEnabled.addEventListener('change', async () => {
    await saveConfig({ scheduleEnabled: scheduleEnabled.checked });
    syncSchedule();
  });

  // 每日执行时间
  const scheduleTime = $('#schedule-time');
  scheduleTime.value = config.scheduleTime || '09:00';
  scheduleTime.addEventListener('change', async () => {
    const value = scheduleTime.value || '09:00';
    await saveConfig({ scheduleTime: value });
    // 仅在开关已开启时才需要重同步闹钟
    if (scheduleEnabled.checked) syncSchedule();
  });
}

console.log('[签到助手] Side Panel 已加载');
renderSites();
renderDropdown();
renderDetected();
renderLogs();
renderConfig();
setInterval(renderLogs, 2000);
