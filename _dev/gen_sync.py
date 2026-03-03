"""Generate the Assets Synchronizer Automa workflow JSON — v2 with typing engine."""
import json
import os

SYNC_CODE = r"""console.log('=== ScriptToScene Assets Synchronizer v2 ===');
if (window.__stsSyncActive) {
  console.log('Synchronizer already running');
  automaNextBlock();
  return;
}
window.__stsSyncActive = true;

const S = {
  studioUrl: localStorage.getItem('sts-url') || 'http://localhost:5000',
  connected: false, autoSync: true, collapsed: true,
  showSettings: false, activeTab: 'typing',
  lastPoll: 0, projectId: null, arguments: '',
  scenes: {}, sentScenes: {},
  typing: {
    active: false,
    queue: [],
    currentIndex: -1,
    typedCount: 0,
    batchCount: 0,
    countdown: 0,
    countdownType: '',
  }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Inject UI ───
const root = document.createElement('div');
root.id = 'sts-sync';
root.innerHTML = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@400;500;600;700&display=swap');
  #sts-sync * { box-sizing: border-box; margin: 0; padding: 0; padding-right: 0.25rem; }
  #sts-sync {
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    font-family: 'DM Sans', -apple-system, sans-serif;
    font-size: 12px; color: #d4d4d8; line-height: 1.4;
  }
  .sts-pill {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 14px;
    background: rgba(10,10,18,0.92); backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,0.06); border-radius: 40px;
    cursor: pointer; transition: all 0.25s ease;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4); user-select: none;
  }
  .sts-pill:hover {
    border-color: rgba(139,92,246,0.3);
    box-shadow: 0 8px 32px rgba(139,92,246,0.15);
    transform: translateY(-1px);
  }
  .sts-pill-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #ef4444; flex-shrink: 0; transition: background 0.3s;
  }
  .sts-pill-dot.on { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
  .sts-pill-label { font-size: 11px; font-weight: 500; color: #a1a1aa; letter-spacing: 0.02em; }
  .sts-pill-proj { font-size: 9px; font-family: 'DM Mono', monospace; color: #8b5cf6; opacity: 0.8; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sts-pill-counts { display: flex; gap: 6px; font-family: 'DM Mono', monospace; font-size: 10px; }
  .sts-pill-counts span { opacity: 0.7; }
  .sts-c-pend { color: #a1a1aa; } .sts-c-proc { color: #f59e0b; }
  .sts-c-rdy { color: #22c55e; } .sts-c-sent { color: #8b5cf6; }

  .sts-panel {
    width: 360px;
    background: rgba(10,10,18,0.94); backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,0.06); border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02) inset;
    overflow: hidden;
    animation: sts-up 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  @keyframes sts-up {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Header */
  .sts-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(59,130,246,0.08) 100%);
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .sts-head-left { display: flex; align-items: center; gap: 8px; }
  .sts-head-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #ef4444; transition: all 0.3s;
  }
  .sts-head-dot.on { background: #22c55e; box-shadow: 0 0 10px rgba(34,197,94,0.4); }
  .sts-head h3 { font-size: 13px; font-weight: 600; color: #e4e4e7; letter-spacing: -0.01em; }
  .sts-head-proj {
    font-size: 9px; font-family: 'DM Mono', monospace; color: #8b5cf6;
    background: rgba(139,92,246,0.1); padding: 2px 8px; border-radius: 4px;
    max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sts-head-btns { display: flex; gap: 4px; }
  .sts-hb {
    width: 24px; height: 24px; border-radius: 6px;
    border: none; background: rgba(255,255,255,0.06);
    color: #71717a; cursor: pointer; font-size: 12px;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .sts-hb:hover { background: rgba(255,255,255,0.12); color: #d4d4d8; }
  .sts-hb.active { background: rgba(139,92,246,0.2); color: #8b5cf6; }

  /* Settings */
  .sts-settings {
    padding: 8px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    background: rgba(0,0,0,0.15);
    display: none;
  }
  .sts-settings.open { display: flex; gap: 6px; align-items: center; }
  .sts-settings label { font-size: 10px; color: #71717a; font-weight: 500; white-space: nowrap; }
  .sts-url-input {
    flex: 1; padding: 4px 8px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04); color: #d4d4d8;
    font-family: 'DM Mono', monospace; font-size: 10px;
    outline: none; transition: border-color 0.2s;
  }
  .sts-url-input:focus { border-color: rgba(139,92,246,0.4); }
  .sts-url-save {
    padding: 4px 8px; border-radius: 4px; border: none;
    background: rgba(139,92,246,0.2); color: #8b5cf6;
    font-size: 9px; font-weight: 600; cursor: pointer;
    transition: background 0.15s;
  }
  .sts-url-save:hover { background: rgba(139,92,246,0.35); }

  /* Timer */
  .sts-timer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: 11px; color: #71717a;
  }
  .sts-timer-val { font-family: 'DM Mono', monospace; color: #a1a1aa; }

  /* Stats */
  .sts-stats {
    display: flex; gap: 2px; padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .sts-stat {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    padding: 6px 4px; border-radius: 8px;
    background: rgba(255,255,255,0.02); transition: background 0.2s;
  }
  .sts-stat:hover { background: rgba(255,255,255,0.05); }
  .sts-stat-n { font-family: 'DM Mono', monospace; font-size: 16px; font-weight: 500; line-height: 1; }
  .sts-stat-l { font-size: 9px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #52525b; margin-top: 3px; }

  /* Tabs */
  .sts-tabs {
    display: flex; border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .sts-tab {
    flex: 1; padding: 7px 0; text-align: center;
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; color: #52525b;
    cursor: pointer; border: none; background: none;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }
  .sts-tab:hover { color: #a1a1aa; }
  .sts-tab.active { color: #8b5cf6; border-bottom-color: #8b5cf6; }

  /* Typing progress bar */
  .sts-typing-prog {
    padding: 6px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    display: none;
  }
  .sts-typing-prog.show { display: block; }
  .sts-prog-text {
    font-size: 10px; color: #71717a; margin-bottom: 4px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .sts-prog-text .sts-cd { color: #f59e0b; font-family: 'DM Mono', monospace; }
  .sts-prog-text .sts-cd.cool { color: #3b82f6; }
  .sts-prog-bar {
    height: 3px; border-radius: 2px; background: rgba(255,255,255,0.06);
    overflow: hidden;
  }
  .sts-prog-fill {
    height: 100%; border-radius: 2px;
    background: linear-gradient(90deg, #8b5cf6, #6366f1);
    transition: width 0.3s ease;
  }

  /* Scene / typing lists */
  .sts-list {
    max-height: 360px; overflow-y: auto;
    scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent;
  }
  .sts-list::-webkit-scrollbar { width: 4px; }
  .sts-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  .sts-row {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.02);
    transition: background 0.15s;
  }
  .sts-row:hover { background: rgba(255,255,255,0.03); }
  .sts-row:last-child { border-bottom: none; }
  .sts-row.highlight { background: rgba(139,92,246,0.06); }
  .sts-row-num {
    width: 26px; height: 26px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-family: 'DM Mono', monospace; font-size: 10px; font-weight: 500;
    background: rgba(139,92,246,0.1); color: #8b5cf6; flex-shrink: 0;
  }
  .sts-row-info { flex: 1; min-width: 0; }
  .sts-row-prompt {
    font-size: 11px; color: #a1a1aa;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sts-row-meta { font-size: 9px; color: #52525b; margin-top: 2px; font-family: 'DM Mono', monospace; }
  .sts-row-status { flex-shrink: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
  .sts-d-q { width: 6px; height: 6px; border-radius: 50%; background: #3f3f46; }
  .sts-d-typing { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; animation: sts-pulse 1.2s ease-in-out infinite; }
  @keyframes sts-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.4; transform:scale(0.7); } }
  .sts-d-typed { color: #22c55e; font-size: 14px; }
  .sts-d-ready { color: #22c55e; font-size: 14px; }
  .sts-d-sent { color: #8b5cf6; font-size: 14px; }
  .sts-d-err { color: #ef4444; font-size: 13px; }
  .sts-d-proc { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; animation: sts-pulse 1.5s ease-in-out infinite; }
  .sts-d-pending { width: 6px; height: 6px; border-radius: 50%; background: #52525b; }
  .sts-d-dl { color: #8b5cf6; font-size: 14px; }

  .sts-empty { padding: 28px 16px; text-align: center; color: #3f3f46; font-size: 11px; }
  .sts-empty-icon { font-size: 22px; margin-bottom: 6px; opacity: 0.3; }

  /* Sync card with thumbnail grid */
  .sts-card {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    transition: background 0.15s;
  }
  .sts-card:hover { background: rgba(255,255,255,0.02); }
  .sts-card:last-child { border-bottom: none; }
  .sts-card-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  }
  .sts-card-num {
    width: 22px; height: 22px; border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    font-family: 'DM Mono', monospace; font-size: 10px; font-weight: 500;
    background: rgba(139,92,246,0.1); color: #8b5cf6; flex-shrink: 0;
  }
  .sts-card-prompt {
    flex: 1; font-size: 10px; color: #71717a; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sts-card-badge {
    font-size: 9px; font-family: 'DM Mono', monospace; padding: 2px 6px;
    border-radius: 4px; flex-shrink: 0; font-weight: 500;
  }
  .sts-badge-pending { background: rgba(82,82,91,0.2); color: #52525b; }
  .sts-badge-processing { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .sts-badge-ready { background: rgba(34,197,94,0.12); color: #22c55e; }
  .sts-badge-uploading { background: rgba(139,92,246,0.12); color: #8b5cf6; }
  .sts-badge-sent { background: rgba(139,92,246,0.15); color: #8b5cf6; }
  .sts-badge-downloaded { background: rgba(34,197,94,0.15); color: #22c55e; }
  .sts-badge-error { background: rgba(239,68,68,0.12); color: #ef4444; }

  .sts-thumbs {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px;
    border-radius: 6px; overflow: hidden;
  }
  .sts-thumbs.cols2 { grid-template-columns: repeat(2, 1fr); }
  .sts-thumb {
    aspect-ratio: 1; background: rgba(255,255,255,0.03);
    border-radius: 3px; overflow: hidden; position: relative;
  }
  .sts-thumb img {
    width: 100%; height: 100%; object-fit: cover;
    display: block; transition: opacity 0.3s;
  }
  .sts-thumb img.loading { opacity: 0.4; }
  .sts-thumb-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: #27272a; font-size: 14px;
  }
  .sts-card-noimg {
    padding: 10px 0 4px;
    font-size: 10px; color: #3f3f46; text-align: center;
  }

  /* Footer */
  .sts-foot {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px;
    border-top: 1px solid rgba(255,255,255,0.04);
    background: rgba(255,255,255,0.01);
  }
  .sts-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .sts-toggle-track {
    width: 28px; height: 16px; border-radius: 8px;
    background: #27272a; position: relative; transition: background 0.2s;
  }
  .sts-toggle-track.on { background: rgba(139,92,246,0.5); }
  .sts-toggle-thumb {
    width: 12px; height: 12px; border-radius: 50%;
    background: #52525b; position: absolute; top: 2px; left: 2px; transition: all 0.2s;
  }
  .sts-toggle-track.on .sts-toggle-thumb { left: 14px; background: #8b5cf6; box-shadow: 0 0 6px rgba(139,92,246,0.5); }
  .sts-toggle-label { font-size: 10px; color: #71717a; font-weight: 500; }
  .sts-btn {
    padding: 5px 14px; border-radius: 6px; border: none;
    font-size: 10px; font-weight: 600; cursor: pointer;
    letter-spacing: 0.03em; transition: all 0.15s;
    font-family: 'DM Sans', sans-serif;
  }
  .sts-btn-primary {
    background: rgba(139,92,246,0.15); color: #8b5cf6;
  }
  .sts-btn-primary:hover { background: rgba(139,92,246,0.25); box-shadow: 0 2px 12px rgba(139,92,246,0.2); }
  .sts-btn-danger {
    background: rgba(239,68,68,0.15); color: #ef4444;
  }
  .sts-btn-danger:hover { background: rgba(239,68,68,0.25); }
  .sts-btn:active { transform: scale(0.97); }
  .sts-foot-btns { display: flex; gap: 6px; }
</style>

<div id="sts-pill" class="sts-pill">
  <div id="sts-pill-dot" class="sts-pill-dot"></div>
  <span class="sts-pill-label">Assets Sync</span>
  <span class="sts-pill-proj" id="sts-pill-proj"></span>
  <div class="sts-pill-counts">
    <span class="sts-c-pend" id="sts-pill-p">0</span>
    <span class="sts-c-rdy" id="sts-pill-r">0</span>
  </div>
</div>

<div id="sts-expanded" class="sts-panel" style="display:none">
  <div class="sts-head">
    <div class="sts-head-left">
      <div id="sts-head-dot" class="sts-head-dot"></div>
      <h3>Assets Sync</h3>
      <span class="sts-head-proj" id="sts-head-proj"></span>
    </div>
    <div class="sts-head-btns">
      <button class="sts-hb" id="sts-gear" title="Settings">&#x2699;</button>
      <button class="sts-hb" id="sts-collapse" title="Collapse">&minus;</button>
    </div>
  </div>

  <div class="sts-settings" id="sts-settings">
    <label>URL</label>
    <input class="sts-url-input" id="sts-url" type="text" />
    <button class="sts-url-save" id="sts-url-save">Save</button>
  </div>

  <div class="sts-timer">
    <span>Last poll</span>
    <span class="sts-timer-val" id="sts-timer-val">--</span>
  </div>

  <div class="sts-stats">
    <div class="sts-stat"><span class="sts-stat-n sts-c-pend" id="sts-n-q">0</span><span class="sts-stat-l">Queued</span></div>
    <div class="sts-stat"><span class="sts-stat-n sts-c-proc" id="sts-n-typed">0</span><span class="sts-stat-l">Typed</span></div>
    <div class="sts-stat"><span class="sts-stat-n sts-c-rdy" id="sts-n-rdy">0</span><span class="sts-stat-l">Ready</span></div>
    <div class="sts-stat"><span class="sts-stat-n sts-c-sent" id="sts-n-sent">0</span><span class="sts-stat-l">Synced</span></div>
  </div>

  <div class="sts-tabs">
    <button class="sts-tab active" id="sts-tab-typing" data-tab="typing">Typing</button>
    <button class="sts-tab" id="sts-tab-sync" data-tab="sync">Sync</button>
  </div>

  <div class="sts-typing-prog" id="sts-typing-prog">
    <div class="sts-prog-text">
      <span id="sts-prog-label">Ready</span>
      <span class="sts-cd" id="sts-prog-cd"></span>
    </div>
    <div class="sts-prog-bar"><div class="sts-prog-fill" id="sts-prog-fill" style="width:0%"></div></div>
  </div>

  <div class="sts-list" id="sts-list"></div>

  <div class="sts-foot">
    <div class="sts-toggle" id="sts-toggle">
      <div class="sts-toggle-track on" id="sts-toggle-track"><div class="sts-toggle-thumb"></div></div>
      <span class="sts-toggle-label">Auto-sync</span>
    </div>
    <div class="sts-foot-btns">
      <button class="sts-btn sts-btn-primary" id="sts-action-btn">Start Typing</button>
    </div>
  </div>
</div>
`;
document.body.appendChild(root);

const $id = (id) => document.getElementById(id);

// ─── Settings ───
$id('sts-url').value = S.studioUrl;

// ─── Event Listeners ───
$id('sts-pill').addEventListener('click', () => {
  S.collapsed = false;
  $id('sts-pill').style.display = 'none';
  $id('sts-expanded').style.display = '';
});
$id('sts-collapse').addEventListener('click', () => {
  S.collapsed = true;
  $id('sts-expanded').style.display = 'none';
  $id('sts-pill').style.display = 'flex';
});
$id('sts-gear').addEventListener('click', () => {
  S.showSettings = !S.showSettings;
  $id('sts-settings').classList.toggle('open', S.showSettings);
  $id('sts-gear').classList.toggle('active', S.showSettings);
});
$id('sts-url-save').addEventListener('click', () => {
  const url = $id('sts-url').value.replace(/\/+$/, '');
  if (!url) return;
  S.studioUrl = url;
  localStorage.setItem('sts-url', url);
  S.showSettings = false;
  $id('sts-settings').classList.remove('open');
  $id('sts-gear').classList.remove('active');
  console.log('Studio URL saved:', url);
  poll();
});
$id('sts-toggle').addEventListener('click', () => {
  S.autoSync = !S.autoSync;
  $id('sts-toggle-track').classList.toggle('on', S.autoSync);
});

// Tabs
$id('sts-tab-typing').addEventListener('click', () => { S.activeTab = 'typing'; renderTabs(); render(); });
$id('sts-tab-sync').addEventListener('click', () => { S.activeTab = 'sync'; renderTabs(); render(); });

function renderTabs() {
  $id('sts-tab-typing').classList.toggle('active', S.activeTab === 'typing');
  $id('sts-tab-sync').classList.toggle('active', S.activeTab === 'sync');
  $id('sts-typing-prog').classList.toggle('show', S.activeTab === 'typing');
}

// Action button
$id('sts-action-btn').addEventListener('click', () => {
  if (S.activeTab === 'typing') {
    if (S.typing.active) stopTyping();
    else startTyping();
  } else {
    syncNow();
  }
});

async function syncNow() {
  console.log('Manual sync triggered');
  S.lastPoll = Date.now();
  // Reset sent status so scenes can be re-scraped and re-sent
  S.sentScenes = {};
  for (const sc of Object.values(S.scenes)) {
    if (sc.status === 'sent' || sc.status === 'downloaded') {
      sc.status = 'pending';
    }
  }
  scanPage();
  // Force-send any ready scenes
  for (const [num, sc] of Object.entries(S.scenes)) {
    if (sc.status === 'ready' && sc.urls.length > 0) {
      await sendResults(num, sc.urls);
    }
  }
  await fetchStatus();
  render();
}

// ─── Render ───
function render() {
  // Count typing statuses
  const tq = S.typing.queue;
  let queued = 0, typed = 0;
  tq.forEach(q => { if (q.status === 'queued') queued++; else if (q.status === 'typed') typed++; });

  // Count sync statuses
  let rdy = 0, sent = 0;
  for (const sc of Object.values(S.scenes)) {
    if (sc.status === 'ready') rdy++;
    else if (sc.status === 'sent' || sc.status === 'downloaded') sent++;
  }

  // Pill
  $id('sts-pill-dot').classList.toggle('on', S.connected);
  $id('sts-pill-p').textContent = queued;
  $id('sts-pill-r').textContent = rdy + sent;
  $id('sts-pill-proj').textContent = S.projectId || '';

  // Header
  $id('sts-head-dot').classList.toggle('on', S.connected);
  $id('sts-head-proj').textContent = S.projectId || '';
  $id('sts-head-proj').style.display = S.projectId ? '' : 'none';

  // Stats
  $id('sts-n-q').textContent = queued;
  $id('sts-n-typed').textContent = typed;
  $id('sts-n-rdy').textContent = rdy;
  $id('sts-n-sent').textContent = sent;

  // Typing progress
  if (S.activeTab === 'typing') {
    const total = tq.length;
    const pct = total > 0 ? (typed / total) * 100 : 0;
    $id('sts-prog-fill').style.width = pct + '%';

    if (S.typing.active) {
      const ci = S.typing.currentIndex;
      if (S.typing.countdown > 0) {
        const isCool = S.typing.countdownType === 'cooldown';
        $id('sts-prog-label').textContent = isCool ? 'Cooldown' : 'Typed ' + typed + '/' + total;
        const cd = $id('sts-prog-cd');
        cd.textContent = S.typing.countdown + 's';
        cd.className = 'sts-cd' + (isCool ? ' cool' : '');
      } else {
        $id('sts-prog-label').textContent = 'Typing ' + (ci + 1) + '/' + total;
        $id('sts-prog-cd').textContent = '';
      }
    } else if (total > 0) {
      $id('sts-prog-label').textContent = typed === total ? 'All typed' : 'Ready \u00b7 ' + typed + '/' + total;
      $id('sts-prog-cd').textContent = '';
    } else {
      $id('sts-prog-label').textContent = 'No prompts queued';
      $id('sts-prog-cd').textContent = '';
    }
  }

  // Action button
  const btn = $id('sts-action-btn');
  if (S.activeTab === 'typing') {
    if (S.typing.active) {
      btn.textContent = 'Stop';
      btn.className = 'sts-btn sts-btn-danger';
    } else {
      btn.textContent = 'Start Typing';
      btn.className = 'sts-btn sts-btn-primary';
    }
  } else {
    btn.textContent = 'Sync Now';
    btn.className = 'sts-btn sts-btn-primary';
  }

  // List content
  const list = $id('sts-list');
  if (S.activeTab === 'typing') {
    if (!tq.length) {
      list.innerHTML = '<div class="sts-empty"><div class="sts-empty-icon">&#x270D;</div>No prompts queued yet.<br>Click Assets Grabber in Studio.</div>';
      return;
    }
    list.innerHTML = tq.map((q, i) => {
      const pr = (q.displayPrompt || '').length > 46 ? q.displayPrompt.substring(0, 46) + '...' : q.displayPrompt || '';
      let sHTML = '', meta = '';
      const isCurrent = S.typing.active && i === S.typing.currentIndex;
      if (q.status === 'queued') { sHTML = '<div class="sts-d-q"></div>'; meta = 'queued'; }
      else if (q.status === 'typing') { sHTML = '<div class="sts-d-typing"></div>'; meta = 'typing...'; }
      else if (q.status === 'typed') { sHTML = '<span class="sts-d-typed">&#x2714;</span>'; meta = 'typed'; }
      else if (q.status === 'error') { sHTML = '<span class="sts-d-err">&#x2718;</span>'; meta = 'error'; }
      return '<div class="sts-row' + (isCurrent ? ' highlight' : '') + '"><div class="sts-row-num">' + q.scene + '</div><div class="sts-row-info"><div class="sts-row-prompt">' + pr.replace(/</g, '&lt;') + '</div><div class="sts-row-meta">' + meta + '</div></div><div class="sts-row-status">' + sHTML + '</div></div>';
    }).join('');
  } else {
    const keys = Object.keys(S.scenes).sort((a, b) => parseInt(a) - parseInt(b));
    if (!keys.length) {
      list.innerHTML = '<div class="sts-empty"><div class="sts-empty-icon">&#x1F4E1;</div>Waiting for generations...</div>';
      return;
    }
    list.innerHTML = keys.map(num => {
      const sc = S.scenes[num];
      const pr = (sc.prompt || '').length > 52 ? sc.prompt.substring(0, 52) + '...' : sc.prompt || '';

      // Status badge
      const badgeMap = {
        pending: ['pending', 'pending'],
        processing: ['processing', 'generating\u2026'],
        ready: ['ready', sc.fileCount + ' ready'],
        uploading: ['uploading', 'uploading\u2026'],
        sent: ['sent', sc.fileCount + ' sent'],
        downloaded: ['downloaded', sc.fileCount + ' synced'],
        error: ['error', 'error'],
      };
      const [bCls, bText] = badgeMap[sc.status] || ['pending', sc.status];

      // Thumbnail grid
      let thumbsHTML = '';
      const urls = sc.urls || [];
      if (urls.length > 0) {
        const cols = urls.length <= 2 ? ' cols2' : '';
        thumbsHTML = '<div class="sts-thumbs' + cols + '">' + urls.map(u => {
          return '<div class="sts-thumb"><img src="' + u.replace(/"/g, '&quot;') + '" loading="lazy" onerror="this.style.display=\'none\'" /></div>';
        }).join('') + '</div>';
      } else if (sc.status === 'processing') {
        thumbsHTML = '<div class="sts-card-noimg">&#x23F3; Generating images\u2026</div>';
      } else if (sc.status === 'pending') {
        thumbsHTML = '<div class="sts-card-noimg">Waiting for generation</div>';
      }

      return '<div class="sts-card">' +
        '<div class="sts-card-head">' +
          '<div class="sts-card-num">' + num + '</div>' +
          '<div class="sts-card-prompt">' + pr.replace(/</g, '&lt;') + '</div>' +
          '<span class="sts-card-badge sts-badge-' + bCls + '">' + bText + '</span>' +
        '</div>' +
        thumbsHTML +
      '</div>';
    }).join('');
  }
}

// ─── Timer ───
function updateTimer() {
  if (!S.lastPoll) { $id('sts-timer-val').textContent = '--'; return; }
  $id('sts-timer-val').textContent = Math.floor((Date.now() - S.lastPoll) / 1000) + 's ago';
}

// ─── Typing Engine ───
async function startTyping() {
  const tq = S.typing.queue;
  if (!tq.length) { console.log('No prompts to type'); return; }

  S.typing.active = true;
  S.typing.batchCount = 0;
  render();
  console.log('Typing started:', tq.length, 'prompts');

  for (let i = 0; i < tq.length; i++) {
    if (!S.typing.active) break;
    const item = tq[i];
    if (item.status === 'typed') continue;

    S.typing.currentIndex = i;
    item.status = 'typing';
    render();

    try {
      await typeIntoMJ(item.fullPrompt);
      item.status = 'typed';
      S.typing.typedCount++;
      S.typing.batchCount++;
      console.log('Typed scene', item.scene, '(' + S.typing.typedCount + ' total)');
      render();

      // Find next untyped
      const hasMore = tq.slice(i + 1).some(q => q.status !== 'typed');
      if (!hasMore) break;

      // Cooldown after every 3 prompts (2 min), otherwise 10s delay
      if (S.typing.batchCount >= 3) {
        S.typing.batchCount = 0;
        await doCountdown(120, 'cooldown');
      } else {
        await doCountdown(10, 'delay');
      }
    } catch (e) {
      console.error('Typing failed for scene', item.scene, ':', e.message);
      item.status = 'error';
      render();
      // Wait 3s before continuing on error
      await sleep(3000);
    }
  }

  S.typing.active = false;
  S.typing.currentIndex = -1;
  console.log('Typing complete:', S.typing.typedCount, 'prompts typed');
  render();
}

function stopTyping() {
  S.typing.active = false;
  S.typing.countdown = 0;
  // Reset current typing item to queued
  const tq = S.typing.queue;
  if (S.typing.currentIndex >= 0 && tq[S.typing.currentIndex]) {
    if (tq[S.typing.currentIndex].status === 'typing') {
      tq[S.typing.currentIndex].status = 'queued';
    }
  }
  S.typing.currentIndex = -1;
  console.log('Typing stopped');
  render();
}

async function doCountdown(seconds, type) {
  S.typing.countdown = seconds;
  S.typing.countdownType = type;
  render();
  for (let i = seconds; i > 0; i--) {
    if (!S.typing.active) break;
    S.typing.countdown = i;
    render();
    await sleep(1000);
  }
  S.typing.countdown = 0;
  S.typing.countdownType = '';
}

async function typeIntoMJ(text) {
  const textarea = document.querySelector('textarea#desktop_input_bar');
  if (!textarea) throw new Error('MJ input not found');

  textarea.focus();
  await sleep(200);

  // React-compatible value setting
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);

  setter.call(textarea, text);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);

  // Click submit
  const btn = document.querySelector('.space-between > .flex-center:nth-child(3)');
  if (!btn) throw new Error('Submit button not found');
  btn.click();
  console.log('Submitted prompt');
  await sleep(300);
}

// ─── API ───
async function fetchPending() {
  try {
    const r = await fetch(S.studioUrl + '/api/assets/grabber/pending');
    S.connected = true;
    if (!r.ok) return;
    const d = await r.json();
    S.projectId = d.projectId;
    S.arguments = d.arguments || '';
    console.log('Project:', d.projectId, '-', d.scenes.length, 'scenes');

    d.scenes.forEach(sc => {
      const k = String(sc.scene);
      // Sync tab scenes
      if (!S.scenes[k]) {
        S.scenes[k] = { prompt: sc.prompt, status: 'pending', urls: [], fileCount: 0 };
      }
      // Typing queue
      if (!S.typing.queue.find(q => q.scene === k)) {
        const args = S.arguments ? ' ' + S.arguments : '';
        S.typing.queue.push({
          scene: k,
          displayPrompt: sc.prompt,
          fullPrompt: sc.prompt + ' [' + d.projectId + '|' + sc.scene + ']' + args,
          status: 'queued',
        });
      }
    });
  } catch (e) { S.connected = false; }
}

async function fetchStatus() {
  if (!S.projectId) return;
  try {
    const r = await fetch(S.studioUrl + '/api/assets/grabber/status/' + encodeURIComponent(S.projectId));
    S.connected = true;
    if (!r.ok) return;
    const d = await r.json();
    for (const [num, info] of Object.entries(d.scene_statuses || {})) {
      const sc = S.scenes[num];
      if (!sc) continue;
      const serverFiles = (info.local_files || []).length;
      // Always sync status from backend
      if (info.status === 'ready' && serverFiles > 0) {
        if (sc.status !== 'downloaded' || sc.fileCount !== serverFiles) {
          sc.status = 'downloaded'; sc.fileCount = serverFiles;
          console.log('Scene', num, 'synced:', serverFiles, 'files on server');
        }
      } else if (info.status === 'error') {
        sc.status = 'error';
      } else if (info.status === 'downloading' && sc.status !== 'uploading') {
        sc.status = 'processing';
      }
    }
  } catch (e) { S.connected = false; }
}

async function sendResults(num, urls) {
  const sc = S.scenes[num];
  if (sc) sc.status = 'uploading';
  render();
  console.log('Fetching', urls.length, 'images for scene', num, 'as blobs...');

  async function fetchBlob(url) {
    // Try default fetch first, then with credentials (for cross-origin CDN video .mp4)
    for (const opts of [{}, { credentials: 'include' }]) {
      try {
        const r = await fetch(url, opts);
        if (r.ok) return await r.blob();
      } catch (e) { /* CORS may block credentialed request, try next */ }
    }
    return null;
  }

  const images = [];
  for (const url of urls) {
    try {
      const blob = await fetchBlob(url);
      if (!blob) { console.warn('All fetch attempts failed for', url); continue; }
      const b64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      // Detect extension from content-type or URL
      const ct = blob.type || '';
      let ext = '.png';
      if (ct.includes('webp') || url.includes('.webp')) ext = '.webp';
      else if (ct.includes('mp4') || url.includes('.mp4')) ext = '.mp4';
      else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg';
      images.push({ data: b64, source_url: url, ext });
      console.log('Fetched', url.split('/').slice(-2).join('/'), '(' + (blob.size / 1024).toFixed(0) + ' KB,', ext + ')');
    } catch (e) { console.warn('Blob fetch failed for', url, e.message); }
  }

  if (!images.length) {
    console.error('No images fetched for scene', num);
    if (sc) sc.status = 'error';
    render();
    return;
  }

  try {
    const r = await fetch(S.studioUrl + '/api/assets/grabber/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: S.projectId, scenes: [{ scene: parseInt(num), images }] })
    });
    if (r.ok) {
      if (sc) sc.status = 'sent';
      S.sentScenes[num] = true;
      console.log('Scene', num, 'uploaded:', images.length, 'images');
    } else {
      console.error('Upload failed for scene', num, r.status);
      if (sc) sc.status = 'error';
    }
  } catch (e) {
    console.error('Upload error:', num, e);
    if (sc) sc.status = 'error';
  }
  render();
}

function scanPage() {
  if (!S.projectId) return;
  const ps = document.getElementById('pageScroll');
  if (!ps) return;

  const tagRe = new RegExp('\\[' + S.projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\|(\\d+)\\]');

  // MJ uses a virtualized list — generation blocks are absolutely positioned grid divs.
  // Each block is a 2-col grid: left=images, right=prompt panel.
  // Strategy: find prompt text elements, then walk up to the generation container.
  const promptEls = ps.querySelectorAll('span.relative');
  let foundBlocks = 0;

  promptEls.forEach(span => {
    const text = span.textContent || '';
    const tm = text.match(tagRe);
    if (!tm) return;
    const matched = tm[1];
    if (!S.scenes[matched]) return;
    const sc = S.scenes[matched];
    // Don't skip sent/downloaded — MJ may have multiple blocks for the same scene
    // (e.g., video generation + image generation). We want to merge URLs from all blocks.
    if (sc.status === 'uploading') return;

    // Walk up to the generation container (the grid with images + prompt)
    let block = span;
    for (let i = 0; i < 10; i++) {
      block = block.parentElement;
      if (!block || block.id === 'pageScroll') break;
      // MJ grid block: has both img and the prompt panel
      if (block.querySelector('a[href*="/jobs/"] img') || block.querySelector('img[src*="cdn.midjourney.com"]')) break;
    }
    if (!block || block.id === 'pageScroll') return;
    foundBlocks++;

    // Check if still processing
    const blockText = block.textContent || '';
    let processing = false;
    if (/\d+%|submitting|processing|waiting|queued/i.test(blockText)) {
      const hasImages = block.querySelectorAll('a[href*="/jobs/"] img[src*="cdn.midjourney.com"]').length > 0;
      if (!hasImages) processing = true;
    }
    if (processing) { if (sc.status !== 'processing') { sc.status = 'processing'; console.log('Scene', matched, 'processing'); } return; }

    const newUrls = scrapeBlock(block);
    if (newUrls.length > 0) {
      // Merge URLs from multiple blocks (MJ may show video + image blocks for same scene)
      const existing = new Set(sc.urls || []);
      const merged = [...(sc.urls || [])];
      let added = 0;
      for (const u of newUrls) { if (!existing.has(u)) { merged.push(u); existing.add(u); added++; } }
      if (sc.status !== 'ready' || added > 0) {
        sc.status = 'ready'; sc.urls = merged; sc.fileCount = merged.length;
        console.log('Scene', matched, 'ready:', merged.length, 'urls' + (added > 0 ? ' (+' + added + ' new)' : ''));
        if (S.autoSync && !S.sentScenes[matched]) sendResults(matched, merged);
      }
    }
  });
  if (foundBlocks > 0) console.log('Scan found', foundBlocks, 'blocks for', S.projectId);
}

function scrapeBlock(block) {
  const urls = [];
  const seen = new Set();
  function addUrl(u) {
    if (!u || seen.has(u)) return;
    // Skip tiny reference thumbnails (128px previews in prompt panel)
    if (u.includes('_128_')) return;
    seen.add(u); urls.push(u);
  }

  // Scope to media grid (left column) to avoid reference thumbnails in prompt panel
  const mediaGrid = block.querySelector('[class*="group/mediaGrid"]') || block;

  // 1. Video elements first — actual .mp4 content is highest priority
  mediaGrid.querySelectorAll('video[src*="cdn.midjourney.com"]').forEach(v => {
    const s = v.src || v.getAttribute('src');
    if (s) addUrl(s);
  });
  mediaGrid.querySelectorAll('video source[src*="cdn.midjourney.com"]').forEach(v => {
    const s = v.src || v.getAttribute('src');
    if (s) addUrl(s);
  });

  const hasVideo = urls.some(u => u.includes('.mp4'));

  // 2. Images inside job links (main generation images + video poster frames)
  // Capture ALL — if .mp4 fetch fails at download time, poster frames are still available
  mediaGrid.querySelectorAll('a[href*="/jobs/"] img').forEach(img => {
    const src = img.src || img.getAttribute('src') || '';
    if (src && src.includes('cdn.midjourney.com')) addUrl(src);
  });

  // 3. Other CDN images in media grid only
  mediaGrid.querySelectorAll('img[src*="cdn.midjourney.com"]').forEach(img => {
    const src = img.src || img.getAttribute('src') || '';
    if (src) addUrl(src);
  });

  // 4. Background images (processing blocks use CSS background-image instead of img tags)
  mediaGrid.querySelectorAll('[style*="background-image"]').forEach(el => {
    const bg = el.style.backgroundImage || '';
    const m = bg.match(/url\(["']?(https:\/\/cdn\.midjourney\.com\/[^"')]+)["']?\)/);
    if (m) addUrl(m[1]);
  });

  // 5. data-src (lazy-loaded) and srcset
  mediaGrid.querySelectorAll('[data-src*="cdn.midjourney.com"]').forEach(el => {
    const s = el.getAttribute('data-src');
    if (s) addUrl(s);
  });
  mediaGrid.querySelectorAll('img[srcset*="cdn.midjourney.com"]').forEach(img => {
    (img.getAttribute('srcset') || '').split(',').forEach(entry => {
      const url = entry.trim().split(/\s+/)[0];
      if (url && url.includes('cdn.midjourney.com')) addUrl(url);
    });
  });

  // 6. Fallback: extract job IDs and construct URLs
  if (urls.length === 0) {
    const jobIds = new Set();
    mediaGrid.querySelectorAll('a[href*="/jobs/"]').forEach(lk => {
      const m = lk.getAttribute('href').match(/\/jobs\/([a-f0-9-]+)/);
      if (m) jobIds.add(m[1]);
    });
    jobIds.forEach(jid => {
      for (let i = 0; i < 4; i++) addUrl('https://cdn.midjourney.com/' + jid + '/0_' + i + '.webp');
    });
  }

  console.log('scrapeBlock found', urls.length, 'URLs', hasVideo ? '(video)' : '');
  return urls;
}

// ─── Poll ───
async function poll() {
  S.lastPoll = Date.now();
  await fetchPending();
  scanPage();
  await fetchStatus();
  render();
}

// ─── Start ───
console.log('Synchronizer v2 injected');
renderTabs();
poll();
setInterval(poll, 5000);
setInterval(updateTimer, 1000);

automaNextBlock();"""

# === Build Automa Workflow ===
workflow = {
    "extVersion": "1.30.01",
    "name": "Assets Synchronizer",
    "icon": "riRefreshLine",
    "table": [],
    "version": "1.30.01",
    "drawflow": {
        "nodes": [
            {
                "id": "sync_trig", "type": "BlockBasic", "label": "trigger",
                "position": {"x": 100, "y": 300},
                "data": {
                    "disableBlock": False, "description": "", "type": "visit-web",
                    "interval": 60, "delay": 5, "date": "", "time": "00:00",
                    "url": "https://www.midjourney.com/imagine",
                    "shortcut": "", "activeInInput": False, "isUrlRegex": False,
                    "days": [], "contextMenuName": "", "contextTypes": [],
                    "parameters": [], "preferParamsInTab": False,
                    "observeElement": {
                        "selector": "", "baseSelector": "", "matchPattern": "",
                        "targetOptions": {"subtree": False, "childList": True, "attributes": False, "attributeFilter": [], "characterData": False},
                        "baseElOptions": {"subtree": False, "childList": True, "attributes": False, "attributeFilter": [], "characterData": False}
                    },
                    "triggers": [
                        {"id": "trig_m", "type": "manual", "data": {
                            "activeInInput": False, "contextMenuName": "", "contextTypes": [],
                            "date": "", "days": [], "delay": 5, "description": "", "disableBlock": False,
                            "interval": 60, "isUrlRegex": False,
                            "observeElement": {"baseElOptions": {"attributeFilter": [], "attributes": False, "characterData": False, "childList": True, "subtree": False}, "baseSelector": "", "matchPattern": "", "selector": "", "targetOptions": {"attributeFilter": [], "attributes": False, "characterData": False, "childList": True, "subtree": False}},
                            "parameters": [], "preferParamsInTab": False,
                            "shortcut": "", "time": "00:00", "type": "manual", "url": ""}},
                        {"id": "trig_v", "type": "visit-web", "data": {
                            "url": "https://www.midjourney.com/imagine", "isUrlRegex": False, "supportSPA": False}}
                    ]
                },
                "initialized": False
            },
            {
                "id": "sync_tab", "type": "BlockBasic", "label": "active-tab",
                "position": {"x": 400, "y": 300},
                "data": {"disableBlock": False, "description": ""},
                "initialized": False
            },
            {
                "id": "sync_dly", "type": "BlockDelay", "label": "delay",
                "position": {"x": 700, "y": 300},
                "data": {"disableBlock": False, "description": "Wait for page to load", "time": "3000"},
                "initialized": False
            },
            {
                "id": "sync_js", "type": "BlockBasic", "label": "javascript-code",
                "position": {"x": 1000, "y": 300},
                "data": {
                    "disableBlock": False, "description": "Inject Assets Synchronizer v2",
                    "code": SYNC_CODE, "context": "website", "timeout": 120000,
                    "everyNewTab": False, "runBeforeLoad": False, "preloadScripts": []
                },
                "initialized": False
            }
        ],
        "edges": [
            {"id": "vueflow__edge-sync_trigsync_trig-output-1-sync_tabsync_tab-input-1", "type": "custom", "source": "sync_trig", "target": "sync_tab", "sourceHandle": "sync_trig-output-1", "targetHandle": "sync_tab-input-1", "updatable": True, "selectable": True, "data": {}, "label": "", "markerEnd": "arrowclosed"},
            {"id": "vueflow__edge-sync_tabsync_tab-output-1-sync_dlysync_dly-input-1", "type": "custom", "source": "sync_tab", "target": "sync_dly", "sourceHandle": "sync_tab-output-1", "targetHandle": "sync_dly-input-1", "updatable": True, "selectable": True, "data": {}, "label": "", "markerEnd": "arrowclosed"},
            {"id": "vueflow__edge-sync_dlysync_dly-output-1-sync_jssync_js-input-1", "type": "custom", "source": "sync_dly", "target": "sync_js", "sourceHandle": "sync_dly-output-1", "targetHandle": "sync_js-input-1", "updatable": True, "selectable": True, "data": {}, "label": "", "markerEnd": "arrowclosed"}
        ],
        "position": [0, 0], "zoom": 0.8,
        "viewport": {"x": 0, "y": 0, "zoom": 0.8}
    },
    "settings": {
        "publicId": "", "blockDelay": 0, "saveLog": True, "debugMode": False,
        "restartTimes": 3, "notification": True, "execContext": "popup",
        "reuseLastState": False, "inputAutocomplete": True, "onError": "stop-workflow",
        "executedBlockOnWeb": False, "insertDefaultColumn": False, "defaultColumnName": "column"
    },
    "globalData": "{\"key\": \"value\"}",
    "description": "All-in-one Midjourney sync dashboard: types prompts, monitors generations, sends results back to ScriptToScene Studio.",
    "includedWorkflows": {}
}

out_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "automation", "automa", "assets-syncronizer.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(workflow, f, ensure_ascii=False)

with open(out_path, "r") as f:
    v = json.load(f)
print(f"Valid JSON: True")
print(f"Nodes: {len(v['drawflow']['nodes'])}")
print(f"Edges: {len(v['drawflow']['edges'])}")
for n in v['drawflow']['nodes']:
    print(f"  {n['id']} ({n['label']})")
print(f"JS code length: {len(v['drawflow']['nodes'][3]['data']['code'])} chars")
print("Done!")
