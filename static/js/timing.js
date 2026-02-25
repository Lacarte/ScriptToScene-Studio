/* ================================================================
   ScriptToScene Studio — Timing Module (Force Alignment)
   ================================================================ */

$('#align-text-input').addEventListener('input', () => {
  const words = $('#align-text-input').value.trim().split(/\s+/).filter(Boolean).length;
  $('#align-text-count').textContent = words + ' word' + (words !== 1 ? 's' : '');
});

function handleAlignFileSelect(input) {
  if (input.files && input.files[0]) setAlignFile(input.files[0]);
}
function handleAlignFileDrop(e) {
  const file = e.dataTransfer.files[0];
  if (file) setAlignFile(file);
}
function setAlignFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['wav', 'mp3', 'flac', 'ogg'].includes(ext)) { toast('Unsupported format — use WAV, MP3, FLAC, or OGG', 'error'); return; }
  STATE.alignFile = file;
  $('#align-file-label').textContent = file.name;
  $('#align-file-label').style.color = 'var(--text)';
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  $('#align-file-info').textContent = `${sizeMB} MB · ${ext.toUpperCase()}`;
  $('#align-file-info').style.display = '';
  $('#align-drop-zone').style.borderColor = 'var(--accent)';
  setTimeout(() => { $('#align-drop-zone').style.borderColor = 'var(--border)'; }, 1000);
}

async function handleRunAlignment() {
  if (!STATE.alignFile) { toast('Select an audio file first', 'error'); return; }
  const text = $('#align-text-input').value.trim();
  if (!text) { toast('Enter transcript text', 'error'); return; }

  const btn = $('#align-run-btn');
  btn.disabled = true;
  $('#align-btn-label').textContent = 'Aligning...';
  $('#align-btn-spinner').style.display = 'inline-block';
  $('#align-results').style.display = 'none';

  try {
    const form = new FormData();
    form.append('audio', STATE.alignFile);
    form.append('text', text);
    const res = await fetch('/api/timing/align', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Alignment failed');
    STATE.alignResult = data;
    renderAlignResults(data);
    toast('Alignment complete');
    loadAlignHistory();
  } catch (e) {
    toast(e.message || 'Alignment failed', 'error');
  } finally {
    btn.disabled = false;
    $('#align-btn-label').textContent = 'Run Alignment';
    $('#align-btn-spinner').style.display = 'none';
  }
}

function renderAlignResults(data) {
  $('#align-results').style.display = '';
  const words = data.alignment || [];
  const duration = words.length ? words[words.length - 1].end : 0;
  let stats = `${words.length} words · ${duration.toFixed(1)}s duration`;
  if (data.inference_time) stats += ` · ${data.inference_time.toFixed(2)}s processing`;
  if (data.folder) stats += ` · ${data.folder}/`;
  $('#align-results-stats').textContent = stats;
  $('#align-results-words').innerHTML = words.map(w =>
    `<span class="font-mono hover-word-chip" style="font-size:12px;padding:2px 6px;border-radius:4px;background:var(--bg-darkest);color:var(--text);cursor:default" title="${w.begin.toFixed(2)}s - ${w.end.toFixed(2)}s">${w.word}</span>`
  ).join('');
}

function copyAlignJSON() {
  if (!STATE.alignResult) return;
  const json = JSON.stringify(STATE.alignResult.alignment || [], null, 2);
  navigator.clipboard.writeText(json).then(() => toast('JSON copied')).catch(() => toast('Copy failed', 'error'));
}
function downloadAlignJSON() {
  if (!STATE.alignResult) return;
  const json = JSON.stringify(STATE.alignResult.alignment || [], null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (STATE.alignFile ? STATE.alignFile.name.replace(/\.[^.]+$/, '') : 'alignment') + '_alignment.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function deleteAlignResult() {
  if (!STATE.alignResult || !STATE.alignResult.folder) return;
  const ok = await confirmDialog({
    title: 'Delete this alignment?',
    desc: 'The folder will be moved to the TRASH folder.',
    message: STATE.alignResult.folder,
    confirmLabel: 'Move to Trash',
  });
  if (!ok) return;
  try {
    await api(`/api/timing/${STATE.alignResult.folder}`, { method: 'DELETE' });
    STATE.alignResult = null;
    $('#align-results').style.display = 'none';
    toast('Alignment deleted');
    loadAlignHistory();
  } catch (e) { toast(e.message, 'error'); }
}

// ---- History ----
async function loadAlignHistory() {
  try {
    STATE.alignHistory = await api('/api/timing/history');
    renderAlignHistory();
  } catch (e) { console.error('History:', e); }
}

function renderAlignHistory() {
  const list = $('#history-list');
  if (!STATE.alignHistory.length) {
    list.innerHTML = '<p style="text-align:center;padding:32px 0;font-size:13px;color:var(--text-muted)">No alignments yet</p>';
    $('#history-count').textContent = '0 files';
    return;
  }
  $('#history-count').textContent = STATE.alignHistory.length + ' file' + (STATE.alignHistory.length !== 1 ? 's' : '');
  list.innerHTML = STATE.alignHistory.map((h, i) => {
    const text = h.transcript || '';
    const truncated = text.length > 60 ? text.slice(0, 60) + '...' : text;
    return `
    <div class="hist-item" style="animation:reveal 0.4s cubic-bezier(0.16,1,0.3,1) both">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${esc(truncated)}</p>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${h.word_count} words · ${h.duration_seconds}s · ${timeAgo(h.timestamp)}</p>
        </div>
        <span class="font-mono" style="font-size:9px;color:var(--text-muted);flex-shrink:0;background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${esc(h.source_file || '')}</span>
        <button onclick="loadAlignResult(${i})" title="View" class="hover-purple-icon" style="width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);background:transparent;border:none;cursor:pointer;flex-shrink:0">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
        </button>
        <button onclick="deleteAlignHistItem(${i})" title="Delete" class="hover-delete-icon" style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);background:transparent;border:none;cursor:pointer;flex-shrink:0;opacity:0.5;transition:all 0.2s">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function loadAlignResult(idx) {
  const h = STATE.alignHistory[idx];
  if (!h) return;
  STATE.alignResult = { folder: h.folder, alignment: h.word_alignment, inference_time: h.inference_time, transcript: h.transcript };
  renderAlignResults(STATE.alignResult);
  $('#main-content').scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteAlignHistItem(idx) {
  const h = STATE.alignHistory[idx];
  if (!h || !h.folder) return;
  const ok = await confirmDialog({ title: 'Delete this alignment?', message: h.folder });
  if (!ok) return;
  try {
    await api(`/api/timing/${h.folder}`, { method: 'DELETE' });
    toast('Alignment deleted');
    loadAlignHistory();
  } catch (e) { toast(e.message, 'error'); }
}

// Init
loadAlignHistory();
