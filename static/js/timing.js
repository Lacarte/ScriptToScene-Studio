/* ================================================================
   ScriptToScene Studio — Timing Module (Force Alignment)
   ================================================================ */

// Audio playback state
let _alnAudio = null;
let _alnAnimFrame = null;
let _alnActiveIdx = -1;

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
    showContinueBar('align-results', 'segmenter', 'Continue to Segmenter \u2192', () => segUseCurrentResult());
  } catch (e) {
    toast(e.message || 'Alignment failed', 'error');
  } finally {
    btn.disabled = false;
    $('#align-btn-label').textContent = 'Run Alignment';
    $('#align-btn-spinner').style.display = 'none';
  }
}

function renderAlignResults(data) {
  alnStopAudio();
  $('#align-results').style.display = '';
  const words = data.alignment || [];
  const duration = words.length ? words[words.length - 1].end : 0;
  let stats = '';
  if (data.project_id) stats += `${data.project_id} · `;
  stats += `${words.length} words · ${duration.toFixed(1)}s duration`;
  if (data.inference_time) stats += ` · ${data.inference_time.toFixed(2)}s processing`;
  $('#align-results-stats').textContent = stats;

  // Timeline visualization + audio player
  _alnRenderTimeline(words, duration);

  // Word chips with click-to-play and data attributes
  $('#align-results-words').innerHTML = words.map((w, i) =>
    `<span class="font-mono hover-word-chip aln-word" data-word-idx="${i}" onclick="alnPlayWord(${i})" style="font-size:12px;padding:2px 6px;border-radius:4px;background:var(--bg-darkest);color:var(--text);cursor:pointer;transition:all 0.15s" title="${w.begin.toFixed(2)}s - ${w.end.toFixed(2)}s">${w.word}</span>`
  ).join('');

  // Load audio
  _alnLoadAudio(data);
}

// ---- Timeline Visualization ----

function _alnRenderTimeline(words, totalDuration) {
  const container = $('#align-timeline');
  if (!words.length) { container.innerHTML = ''; return; }
  if (!totalDuration) totalDuration = words[words.length - 1].end;

  const barHeight = 28;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <button id="aln-play-btn" onclick="alnTogglePlay()" style="width:28px;height:28px;border-radius:50%;background:var(--accent);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform 0.15s,background 0.15s" onmouseenter="this.style.transform='scale(1.1)'" onmouseleave="this.style.transform=''">
        <svg id="aln-play-icon" width="12" height="12" fill="white" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      <div id="aln-timeline-bar" style="position:relative;flex:1;height:${barHeight}px;background:var(--bg-darkest);border-radius:8px;overflow:hidden;border:1px solid var(--border);cursor:pointer" onclick="alnSeekFromClick(event)">
        <div id="aln-progress" style="position:absolute;top:0;left:0;width:0%;height:100%;background:rgba(78,205,196,0.15);transition:width 0.05s linear"></div>
        <div id="aln-playhead" style="position:absolute;top:0;left:0;width:2px;height:100%;background:white;z-index:10;pointer-events:none;opacity:0;transition:opacity 0.15s"></div>
      </div>
      <span id="aln-time-display" class="font-mono" style="font-size:10px;color:var(--text-muted);min-width:48px;text-align:right;flex-shrink:0">0.00s</span>
    </div>
    <div class="flex justify-between" style="font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;margin-left:38px">
      <span>0.00s</span>
      <span>${totalDuration.toFixed(2)}s</span>
    </div>`;
}

// ---- Audio Playback ----

function _alnGetAudioUrl(data) {
  // From current result
  if (data?.folder && data?.source_file) {
    return `/output/alignments/${data.folder}/${data.source_file}`;
  }
  // From STATE.alignResult
  const r = STATE.alignResult;
  if (r?.folder && r?.source_file) {
    return `/output/alignments/${r.folder}/${r.source_file}`;
  }
  return null;
}

function _alnLoadAudio(data) {
  alnStopAudio();
  const url = _alnGetAudioUrl(data);
  if (!url) {
    const btn = $('#aln-play-btn');
    if (btn) btn.style.display = 'none';
    return;
  }
  _alnAudio = new Audio(url);
  _alnAudio.addEventListener('ended', () => _alnResetPlayback());
  _alnAudio.addEventListener('error', () => {
    const btn = $('#aln-play-btn');
    if (btn) btn.style.display = 'none';
  });
}

function alnTogglePlay() {
  if (!_alnAudio) return;
  if (_alnAudio.paused) {
    _alnAudio.play().then(() => {
      _alnSetPlayIcon(false);
      _alnFsSetPlayIcon();
      $('#aln-playhead').style.opacity = '1';
      _alnAnimFrame = requestAnimationFrame(_alnTick);
      if (_alnFsOpen) _alnFsStartRAF();
    }).catch(e => console.warn('Audio play failed:', e));
  } else {
    _alnAudio.pause();
    _alnSetPlayIcon(true);
    _alnFsSetPlayIcon();
    if (_alnAnimFrame) { cancelAnimationFrame(_alnAnimFrame); _alnAnimFrame = null; }
    _alnFsStopRAF();
  }
}

function _alnResetPlayback() {
  if (_alnAudio) {
    _alnAudio.pause();
    _alnAudio.currentTime = 0;
  }
  if (_alnAnimFrame) { cancelAnimationFrame(_alnAnimFrame); _alnAnimFrame = null; }
  _alnSetPlayIcon(true);
  _alnClearHighlights();
  const playhead = $('#aln-playhead');
  if (playhead) { playhead.style.left = '0%'; playhead.style.opacity = '0'; }
  const progress = $('#aln-progress');
  if (progress) progress.style.width = '0%';
  const display = $('#aln-time-display');
  if (display) display.textContent = '0.00s';
  _alnActiveIdx = -1;
}

function alnStopAudio() {
  if (_alnAudio) {
    _alnAudio.pause();
    _alnAudio.currentTime = 0;
    _alnAudio = null;
  }
  if (_alnAnimFrame) { cancelAnimationFrame(_alnAnimFrame); _alnAnimFrame = null; }
  _alnSetPlayIcon(true);
  _alnClearHighlights();
  const playhead = $('#aln-playhead');
  if (playhead) playhead.style.opacity = '0';
  _alnActiveIdx = -1;
}

function alnPlayWord(idx) {
  if (!_alnAudio || !STATE.alignResult) return;
  const words = STATE.alignResult.alignment || [];
  const w = words[idx];
  if (!w) return;
  _alnAudio.currentTime = w.begin;
  _alnUpdatePlayhead();
  if (_alnAudio.paused) {
    _alnAudio.play().then(() => {
      _alnSetPlayIcon(false);
      $('#aln-playhead').style.opacity = '1';
      _alnAnimFrame = requestAnimationFrame(_alnTick);
    }).catch(e => console.warn('Audio play failed:', e));
  }
}

function alnSeekFromClick(e) {
  if (!_alnAudio) return;
  const bar = $('#aln-timeline-bar');
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const words = STATE.alignResult?.alignment || [];
  const totalDuration = words.length ? words[words.length - 1].end : _alnAudio.duration || 1;
  _alnAudio.currentTime = pct * totalDuration;
  _alnUpdatePlayhead();
  if (_alnAudio.paused) alnTogglePlay();
}

function _alnTick() {
  if (!_alnAudio || _alnAudio.paused) return;
  _alnUpdatePlayhead();
  _alnAnimFrame = requestAnimationFrame(_alnTick);
}

function _alnUpdatePlayhead() {
  if (!_alnAudio || !STATE.alignResult) return;
  const t = _alnAudio.currentTime;
  const words = STATE.alignResult.alignment || [];
  const totalDuration = words.length ? words[words.length - 1].end : _alnAudio.duration || 1;
  const pct = (t / totalDuration * 100).toFixed(2);

  const playhead = $('#aln-playhead');
  if (playhead) { playhead.style.left = pct + '%'; playhead.style.opacity = '1'; }

  const progress = $('#aln-progress');
  if (progress) progress.style.width = pct + '%';

  const display = $('#aln-time-display');
  if (display) display.textContent = t.toFixed(2) + 's';

  // Find active word
  let activeIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].begin && t < words[i].end) { activeIdx = i; break; }
  }

  if (activeIdx !== _alnActiveIdx) {
    _alnClearHighlights();
    _alnActiveIdx = activeIdx;
    if (activeIdx >= 0) {
      const chip = $(`.aln-word[data-word-idx="${activeIdx}"]`);
      if (chip) {
        chip.style.background = 'var(--accent)';
        chip.style.color = 'var(--bg-darkest)';
        chip.style.boxShadow = '0 0 8px rgba(78,205,196,0.4)';
        // Auto-scroll within the words container
        const container = $('#align-results-words');
        if (container) {
          const chipRect = chip.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          if (chipRect.bottom > containerRect.bottom || chipRect.top < containerRect.top) {
            chip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }
    }
  }
}

function _alnClearHighlights() {
  document.querySelectorAll('.aln-word').forEach(el => {
    el.style.background = 'var(--bg-darkest)';
    el.style.color = 'var(--text)';
    el.style.boxShadow = '';
  });
}

function _alnSetPlayIcon(isPlay) {
  const icon = $('#aln-play-icon');
  if (!icon) return;
  icon.innerHTML = isPlay
    ? '<polygon points="5,3 19,12 5,21"/>'
    : '<rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/>';
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
    <div class="hist-item" onclick="loadAlignResult(${i})" style="cursor:pointer;animation:reveal 0.4s cubic-bezier(0.16,1,0.3,1) both">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${esc(truncated)}</p>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${h.project_id ? h.project_id + ' · ' : ''}${h.word_count} words · ${h.duration_seconds}s · ${timeAgo(h.timestamp)}</p>
        </div>
        <span class="font-mono" style="font-size:9px;color:var(--text-muted);flex-shrink:0;background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${esc(h.source_file || '')}</span>
        <button onclick="event.stopPropagation();deleteAlignHistItem(${i})" title="Delete" class="hover-delete-icon" style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);background:transparent;border:none;cursor:pointer;flex-shrink:0;opacity:0.5;transition:all 0.2s">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function loadAlignResult(idx) {
  const h = STATE.alignHistory[idx];
  if (!h) return;
  STATE.alignResult = { project_id: h.project_id, folder: h.folder, source_file: h.source_file, alignment: h.word_alignment, inference_time: h.inference_time, transcript: h.transcript };
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

// ---- TTS → Alignment Integration ----

async function _alignLoadTTSItem(item) {
  if (!item || !item.folder || !item.filename) {
    toast('Invalid TTS item', 'error');
    return;
  }
  const url = `/output/tts/${item.folder}/${item.filename}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch audio');
    const blob = await res.blob();
    const file = new File([blob], item.filename, { type: 'audio/wav' });
    setAlignFile(file);

    // Populate transcript
    const ta = $('#align-text-input');
    if (ta && item.prompt) {
      ta.value = item.prompt;
      ta.dispatchEvent(new Event('input'));
    }

    // Show source indicator
    const srcEl = $('#align-tts-source');
    if (srcEl) {
      const voice = item.voice || 'unknown';
      const dur = item.duration_seconds ? `${item.duration_seconds.toFixed(1)}s` : '';
      srcEl.textContent = `Loaded: ${voice} · ${dur} · ${item.filename}`;
      srcEl.style.display = '';
    }
    toast('TTS audio loaded into alignment');
  } catch (e) {
    toast(e.message || 'Failed to load TTS audio', 'error');
  }
}

function alignUseTTS() {
  // Use the most recent TTS "now playing" or last generated item
  if (_ttsState && _ttsState.history && _ttsState.history.length) {
    _alignLoadTTSItem(_ttsState.history[0]);
  } else {
    toast('No TTS result available. Generate audio first.', 'error');
  }
}

async function alignPickTTS() {
  // Load TTS history if not loaded
  let items = (_ttsState && _ttsState.history) || [];
  if (!items.length) {
    try {
      const r = await fetch('/api/tts/generation');
      items = await r.json();
    } catch { /* no-op */ }
  }
  if (!items.length) {
    toast('No TTS history. Generate audio first.', 'error');
    return;
  }

  const modal = $('#align-tts-picker-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  $('#align-tts-picker-list').innerHTML = items.map((item, i) => {
    const text = item.prompt || '';
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    const voice = item.voice || '';
    const dur = item.duration_seconds ? `${item.duration_seconds.toFixed(1)}s` : '';
    return `
    <div class="hist-item" style="cursor:pointer" onclick="alignSelectTTS(${i})">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${esc(truncated)}</p>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${esc(voice)} · ${dur} · ${_ttsTimeAgo ? _ttsTimeAgo(item.timestamp) : timeAgo(item.timestamp)}</p>
        </div>
        <span class="font-mono" style="font-size:9px;color:var(--text-muted);flex-shrink:0;background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${esc(item.filename || '')}</span>
      </div>
    </div>`;
  }).join('');

  // Store items for selection
  window._alignTTSPickerItems = items;
}

function alignSelectTTS(idx) {
  const items = window._alignTTSPickerItems || [];
  const item = items[idx];
  if (item) _alignLoadTTSItem(item);
  alignCloseTTSPicker();
}

function alignCloseTTSPicker() {
  const modal = $('#align-tts-picker-modal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

// ---- Fullscreen Karaoke ----
let _alnFsOpen = false;
let _alnFsRAF = null;
let _alnFsActiveIdx = -1;

function _alnFmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function alnOpenKaraoke() {
  const data = STATE.alignResult;
  if (!data || !data.alignment || !data.alignment.length) {
    toast('No alignment data — run alignment first', 'error');
    return;
  }
  if (!_alnAudio) {
    toast('No audio loaded', 'error');
    return;
  }

  _alnFsOpen = true;
  _alnFsActiveIdx = -1;

  const words = data.alignment;

  // Info line
  const info = $('#aln-fs-info');
  if (info) {
    const dur = words[words.length - 1].end.toFixed(1);
    info.textContent = `${words.length} words · ${dur}s · force-aligned`;
  }

  // Build word spans
  const container = $('#aln-fs-karaoke');
  if (container) {
    container.innerHTML = words.map((w, i) =>
      `<span class="aln-fs-word" data-idx="${i}" onclick="_alnFsKaraokeSeek(${i})">${w.word}</span>`
    ).join('');
  }

  // Show overlay
  const overlay = $('#aln-fs-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.style.opacity = '1');
  }

  // Sync state
  _alnFsUpdateSeek();
  _alnFsSetPlayIcon();
  _alnFsUpdateKaraoke();
  if (!_alnAudio.paused) _alnFsStartRAF();
}

function alnCloseKaraoke() {
  _alnFsOpen = false;
  _alnFsStopRAF();
  const overlay = $('#aln-fs-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
  }
}

function _alnFsKaraokeSeek(idx) {
  const words = STATE.alignResult?.alignment;
  if (!_alnAudio || !words || !words[idx]) return;
  _alnAudio.currentTime = words[idx].begin;
  _alnFsActiveIdx = -1;
  if (_alnAudio.paused) {
    _alnAudio.play().then(() => {
      _alnSetPlayIcon(false);
      _alnFsSetPlayIcon();
      $('#aln-playhead').style.opacity = '1';
      _alnAnimFrame = requestAnimationFrame(_alnTick);
      _alnFsStartRAF();
    }).catch(() => {});
  }
}

function _alnFsUpdateKaraoke() {
  const words = STATE.alignResult?.alignment;
  if (!_alnAudio || !words || !words.length) return;

  const t = _alnAudio.currentTime;

  // Binary search for the active word
  let lo = 0, hi = words.length - 1, activeIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t >= words[mid].begin && t < words[mid].end) { activeIdx = mid; break; }
    if (t < words[mid].begin) hi = mid - 1;
    else lo = mid + 1;
  }

  if (activeIdx === _alnFsActiveIdx) return;
  _alnFsActiveIdx = activeIdx;

  if (!_alnFsOpen) return;
  const container = $('#aln-fs-karaoke');
  if (!container) return;
  const spans = container.children;

  for (let i = 0; i < spans.length; i++) {
    if (activeIdx >= 0 && i < activeIdx) spans[i].className = 'aln-fs-word spoken';
    else if (i === activeIdx) spans[i].className = 'aln-fs-word active';
    else spans[i].className = 'aln-fs-word';
  }

  // Auto-scroll active word to center
  if (activeIdx >= 0 && activeIdx < spans.length) {
    const span = spans[activeIdx];
    const top = span.offsetTop - container.offsetTop;
    container.scrollTo({ top: top - container.clientHeight / 2 + span.offsetHeight / 2, behavior: 'smooth' });
  }
}

function _alnFsUpdateSeek() {
  if (!_alnFsOpen || !_alnAudio) return;
  const words = STATE.alignResult?.alignment;
  const totalDuration = words?.length ? words[words.length - 1].end : (_alnAudio.duration || 1);
  const pct = ((_alnAudio.currentTime / totalDuration) * 100);
  const seekInput = $('#aln-fs-seek');
  if (seekInput) seekInput.value = pct;
  const fill = $('#aln-fs-seek-fill');
  if (fill) fill.style.width = pct + '%';
  const cur = $('#aln-fs-time-cur');
  if (cur) cur.textContent = _alnFmtTime(_alnAudio.currentTime);
  const tot = $('#aln-fs-time-total');
  if (tot) tot.textContent = _alnFmtTime(totalDuration);
}

function _alnFsSetPlayIcon() {
  if (!_alnAudio) return;
  const paused = _alnAudio.paused;
  const fsPlay = document.querySelector('.aln-fs-icon-play');
  const fsPause = document.querySelector('.aln-fs-icon-pause');
  if (fsPlay) fsPlay.style.display = paused ? '' : 'none';
  if (fsPause) fsPause.style.display = paused ? 'none' : '';
}

function _alnFsStartRAF() {
  _alnFsStopRAF();
  function tick() {
    if (!_alnAudio || _alnAudio.paused) { _alnFsRAF = null; return; }
    _alnFsUpdateKaraoke();
    _alnFsUpdateSeek();
    _alnFsRAF = requestAnimationFrame(tick);
  }
  _alnFsRAF = requestAnimationFrame(tick);
}

function _alnFsStopRAF() {
  if (_alnFsRAF) { cancelAnimationFrame(_alnFsRAF); _alnFsRAF = null; }
}

// Fullscreen seek bar input
(function _alnFsSeekInit() {
  const seekInput = $('#aln-fs-seek');
  if (!seekInput) return;
  seekInput.addEventListener('input', () => {
    if (!_alnAudio) return;
    const words = STATE.alignResult?.alignment;
    const totalDuration = words?.length ? words[words.length - 1].end : (_alnAudio.duration || 1);
    _alnAudio.currentTime = (seekInput.value / 100) * totalDuration;
    _alnFsActiveIdx = -1;
    const fill = $('#aln-fs-seek-fill');
    if (fill) fill.style.width = seekInput.value + '%';
  });
})();

// Escape key closes karaoke
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _alnFsOpen) { alnCloseKaraoke(); e.preventDefault(); }
});

// Sync fullscreen play icon when audio events fire
(function _alnFsAudioSync() {
  // Observe _alnAudio changes — re-bind when new audio loads
  const origLoad = _alnLoadAudio;
  _alnLoadAudio = function(data) {
    origLoad(data);
    if (_alnAudio) {
      _alnAudio.addEventListener('play', () => { _alnFsSetPlayIcon(); if (_alnFsOpen) _alnFsStartRAF(); });
      _alnAudio.addEventListener('pause', () => { _alnFsSetPlayIcon(); _alnFsStopRAF(); });
      _alnAudio.addEventListener('ended', () => {
        _alnFsSetPlayIcon();
        _alnFsStopRAF();
        // Mark all words as spoken
        if (_alnFsOpen) {
          document.querySelectorAll('#aln-fs-karaoke .aln-fs-word').forEach(w => {
            w.classList.remove('active'); w.classList.add('spoken');
          });
          _alnFsActiveIdx = -1;
        }
      });
    }
  };
})();

// Init
loadAlignHistory();
