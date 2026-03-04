/* ================================================================
   ScriptToScene Studio — App Core (navigation, toast, confirm, api)
   ================================================================ */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';

// ---- Shared State ----
window.STATE = {
  alignFile: null,
  alignResult: null,
  alignHistory: [],
  segmenterResult: null,
  segmenterAlignment: null,
  scenesSegData: null,
  scenesResult: null,
  assetsSceneData: null,
  assetStatuses: {},
  editorLoaded: false,
  captionData: null,
  captionAlignment: null,
};

// ---- Navigation ----
function switchPage(page) {
  $$('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  $$('.nav-item[data-page]').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  $$('#mobile-nav button[data-page]').forEach(b => {
    const isActive = b.dataset.page === page;
    b.style.color = isActive ? 'var(--accent)' : 'var(--text-muted)';
    b.classList.toggle('active', isActive);
  });
  if (page === 'editor') {
    $('#main-content').style.overflowY = 'hidden';
    initEditorIframe();
  } else {
    $('#main-content').style.overflowY = 'auto';
  }
  if (page === 'assets' && typeof loadAssetsHistory === 'function') {
    loadAssetsHistory();
  }
}

function toggleSidebar() {
  $('#sidebar').classList.toggle('collapsed');
  localStorage.setItem('sts-sidebar', $('#sidebar').classList.contains('collapsed'));
}

// Restore sidebar state
if (localStorage.getItem('sts-sidebar') === 'true') {
  $('#sidebar').classList.add('collapsed');
}

// ---- Toast ----
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  const bg = { success: 'rgba(78,205,196,0.92)', error: 'rgba(255,107,107,0.92)', info: 'rgba(30,42,58,0.92)' };
  el.className = 'toast-item';
  el.style.background = bg[type] || bg.info;
  el.textContent = msg;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = 'opacity 0.3s, transform 0.3s';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ---- Confirm Dialog ----
function confirmDialog({ title, desc, message, confirmLabel } = {}) {
  return new Promise(resolve => {
    const modal = $('#confirm-modal');
    $('#confirm-title').textContent = title || 'Move to Trash?';
    $('#confirm-desc').textContent = desc || 'This action can be undone from the TRASH folder.';
    $('#confirm-message').textContent = message || '';
    $('#confirm-detail').style.display = message ? '' : 'none';
    $('#confirm-ok').textContent = confirmLabel || 'Move to Trash';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    function cleanup(result) {
      modal.classList.add('hidden'); modal.style.display = '';
      $('#confirm-ok').removeEventListener('click', onOk);
      $('#confirm-cancel').removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onKey(e) { if (e.key === 'Escape') cleanup(false); else if (e.key === 'Enter') cleanup(true); }
    $('#confirm-ok').addEventListener('click', onOk);
    $('#confirm-cancel').addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

// ---- API Helper ----
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
  return res.json();
}

// ---- Settings ----
window.STS_SETTINGS = {
  normalize: localStorage.getItem('sts-normalize') !== 'false',
  clean: localStorage.getItem('sts-clean') !== 'false',
};

function settingsToggle(key, val) {
  STS_SETTINGS[key] = val;
  localStorage.setItem('sts-' + key, val);
}

// Restore toggles on load
document.addEventListener('DOMContentLoaded', () => {
  const normEl = $('#setting-normalize');
  const cleanEl = $('#setting-clean');
  if (normEl) normEl.checked = STS_SETTINGS.normalize;
  if (cleanEl) cleanEl.checked = STS_SETTINGS.clean;
});

// ---- Auto-Forward (Continue to Next Step) ----
function showContinueBar(containerId, nextPage, label, setupFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const existing = container.querySelector('.continue-bar');
  if (existing) existing.remove();
  const bar = document.createElement('div');
  bar.className = 'continue-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;margin-top:16px;background:rgba(78,205,196,0.06);border:1px solid rgba(78,205,196,0.2);border-radius:10px;animation:reveal 0.4s cubic-bezier(0.16,1,0.3,1)';
  bar.innerHTML = `<svg width="16" height="16" fill="none" stroke="var(--accent)" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg><span style="font-size:13px;color:var(--text-secondary)">Ready for next step</span>`;
  const btn = document.createElement('button');
  btn.style.cssText = 'margin-left:auto;padding:8px 20px;background:var(--accent);color:var(--bg-darkest);border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:opacity 0.15s';
  btn.textContent = label;
  btn.onmouseenter = () => btn.style.opacity = '0.85';
  btn.onmouseleave = () => btn.style.opacity = '1';
  btn.onclick = () => { if (setupFn) setupFn(); switchPage(nextPage); };
  bar.appendChild(btn);
  container.appendChild(bar);
}

// ---- Time Ago ----
function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}
