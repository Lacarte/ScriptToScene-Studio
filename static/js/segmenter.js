/* ================================================================
   ScriptToScene Studio — Segmenter Module
   Splits alignment into timed segments for scene generation.
   ================================================================ */

// ---- Segmenter State ----
window.STATE.segmenterAlignment = null;
window.STATE.segmenterResult = null;
window.STATE.segmenterConfig = {
  target_min: 1.5,
  target_max: 3.0,
  hard_max: 4.0,
  gap_filler: 0.3,
};

// Audio playback state
let _segAudio = null;
let _segAnimFrame = null;
let _segActiveIdx = -1;

// ---- Source Selection ----

function segUseCurrentResult() {
  if (!STATE.alignResult || !STATE.alignResult.alignment) {
    toast('No alignment result available. Run alignment first.', 'error');
    return;
  }
  STATE.segmenterAlignment = { ...STATE.alignResult, project_id: STATE.alignResult.project_id };
  _updateSegSource();
}

function segPickHistory() {
  if (!STATE.alignHistory.length) {
    toast('No alignment history. Run alignment first.', 'error');
    return;
  }
  const modal = $('#seg-picker-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  $('#seg-picker-list').innerHTML = STATE.alignHistory.map((h, i) => {
    const text = h.transcript || '';
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    return `
    <div class="hist-item" style="cursor:pointer" onclick="segSelectHistory(${i})">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${esc(truncated)}</p>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${h.project_id ? h.project_id + ' · ' : ''}${h.word_count} words · ${h.duration_seconds}s · ${timeAgo(h.timestamp)}</p>
        </div>
        <span class="font-mono" style="font-size:9px;color:var(--text-muted);flex-shrink:0;background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${esc(h.source_file || '')}</span>
      </div>
    </div>`;
  }).join('');
}

function segSelectHistory(idx) {
  const h = STATE.alignHistory[idx];
  if (!h) return;
  STATE.segmenterAlignment = { folder: h.folder, alignment: h.word_alignment, transcript: h.transcript, project_id: h.project_id, source_file: h.source_file };
  segClosePickerModal();
  _updateSegSource();
  toast('Alignment loaded from history');
}

function segClosePickerModal() {
  const modal = $('#seg-picker-modal');
  modal.classList.add('hidden');
  modal.style.display = '';
}

function segHandleUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const alignment = data.alignment || (Array.isArray(data) ? data : null);
      if (!alignment || !alignment.length) throw new Error('No alignment array found');
      STATE.segmenterAlignment = {
        alignment,
        transcript: data.transcript || '',
        folder: data.source_folder || data.folder || file.name.replace(/\.json$/, ''),
        project_id: data.project_id || '',
      };
      _updateSegSource();
      toast('Alignment loaded from file');
    } catch (err) {
      toast('Invalid alignment JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function _updateSegSource() {
  const a = STATE.segmenterAlignment;
  if (!a || !a.alignment) {
    $('#seg-source-info').textContent = 'No alignment selected';
    $('#seg-source-info').style.color = 'var(--text-muted)';
    return;
  }
  const wc = a.alignment.length;
  const dur = wc ? a.alignment[wc - 1].end : 0;
  const label = a.folder || 'uploaded';
  const pid = a.project_id ? `${a.project_id} · ` : '';
  $('#seg-source-info').textContent = `${pid}${wc} words · ${dur.toFixed(1)}s from ${label}`;
  $('#seg-source-info').style.color = 'var(--accent)';
}

// ---- Config Sliders ----

function segUpdateConfig(key, value) {
  const num = parseFloat(value);
  if (isNaN(num)) return;
  STATE.segmenterConfig[key] = num;
  const valEl = $(`#seg-val-${key}`);
  if (valEl) valEl.textContent = num.toFixed(1) + 's';
}

// ---- Run Segmenter ----

async function handleRunSegmenter() {
  if (!STATE.segmenterAlignment || !STATE.segmenterAlignment.alignment) {
    toast('Select an alignment source first', 'error');
    return;
  }

  const btn = $('#seg-run-btn');
  btn.disabled = true;
  $('#seg-btn-label').textContent = 'Segmenting...';
  $('#seg-btn-spinner').style.display = 'inline-block';
  $('#seg-results').style.display = 'none';

  try {
    const payload = {
      alignment: STATE.segmenterAlignment.alignment,
      transcript: STATE.segmenterAlignment.transcript || '',
      source_folder: STATE.segmenterAlignment.folder || '',
      project_id: STATE.segmenterAlignment.project_id || '',
      config: STATE.segmenterConfig,
    };
    const res = await fetch('/api/segmenter/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Segmentation failed');

    STATE.segmenterResult = data;
    renderSegResults(data);
    loadSegHistory();
    toast('Segmentation complete');
    showContinueBar('seg-results', 'scenes', 'Continue to Scenes \u2192', () => scenesUseCurrentSegment());
  } catch (e) {
    toast(e.message || 'Segmentation failed', 'error');
  } finally {
    btn.disabled = false;
    $('#seg-btn-label').textContent = 'Run Segmenter';
    $('#seg-btn-spinner').style.display = 'none';
  }
}

// ---- Render Results ----

function renderSegResults(data) {
  segStopAudio();
  $('#seg-results').style.display = '';
  const segments = data.segments || [];
  const stats = data.stats || {};

  // Stats bar
  const meta = data.metadata || {};
  const pidLabel = meta.project_id ? `${meta.project_id} · ` : '';
  $('#seg-stats').textContent = `${pidLabel}${stats.segment_count} segments · ${stats.filler_count} fillers · avg ${stats.avg_duration.toFixed(2)}s · range ${stats.min_duration.toFixed(2)}s - ${stats.max_duration.toFixed(2)}s`;

  // Timeline visualization + audio player
  renderSegTimeline(segments, data.metadata);

  // Segment list
  let segNum = -1;
  $('#seg-list').innerHTML = segments.map(s => {
    if (s.is_filler) {
      return `
      <div class="seg-filler" data-seg-idx="${s.index}" data-start="${s.start}" data-end="${s.end}" style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;background:var(--bg-darkest);border:1px dashed var(--border);opacity:0.6;transition:all 0.15s">
        <span class="font-mono" style="font-size:10px;color:var(--text-muted);min-width:40px">silence</span>
        <div style="flex:1;height:2px;background:var(--border);border-radius:1px"></div>
        <span class="font-mono" style="font-size:10px;color:var(--text-muted)">${s.duration.toFixed(2)}s</span>
      </div>`;
    }
    segNum++;
    const reasonColor = {
      strong_break: '#4ECDC4',
      natural_break: '#A78BFA',
      hard_max: '#FF6B6B',
      end_of_text: 'var(--text-muted)',
    };
    const rc = reasonColor[s.break_reason] || 'var(--text-muted)';
    return `
    <div class="seg-card" data-seg-idx="${s.index}" data-start="${s.start}" data-end="${s.end}" onclick="segPlayBlock(${s.index})" style="background:var(--bg-surface);border:1px solid var(--border);border-left:3px solid ${rc};border-radius:10px;padding:12px 14px;transition:all 0.2s;cursor:pointer">
      <div class="flex items-center justify-between mb-1.5">
        <span class="font-mono text-xs" style="color:${rc}">Segment ${segNum} · ${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="font-mono" style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(78,205,196,0.1);color:var(--accent)">${s.duration.toFixed(2)}s</span>
          <span class="font-mono" style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bg-darkest);color:var(--text-muted)">${s.break_reason}</span>
        </div>
      </div>
      <p style="font-size:13px;color:var(--text);line-height:1.6;margin:0">${esc(s.words)}</p>
      <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin-top:4px">${s.word_count} words</p>
    </div>`;
  }).join('');

  // Load audio for playback
  _segLoadAudio();
}

function renderSegTimeline(segments, metadata) {
  const container = $('#seg-timeline');
  if (!segments.length) { container.innerHTML = ''; return; }

  const totalDuration = metadata.total_duration || segments[segments.length - 1].end;
  const barHeight = 32;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <button id="seg-play-btn" onclick="segTogglePlay()" style="width:28px;height:28px;border-radius:50%;background:var(--accent);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform 0.15s,background 0.15s" onmouseenter="this.style.transform='scale(1.1)'" onmouseleave="this.style.transform=''">
        <svg id="seg-play-icon" width="12" height="12" fill="white" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      <div id="seg-timeline-bar" style="position:relative;flex:1;height:${barHeight}px;background:var(--bg-darkest);border-radius:8px;overflow:hidden;border:1px solid var(--border);cursor:pointer" onclick="segSeekFromClick(event)">
        ${segments.map(s => {
          const left = (s.start / totalDuration * 100).toFixed(2);
          const width = Math.max(s.duration / totalDuration * 100, 0.3).toFixed(2);
          let bg;
          if (s.is_filler) {
            bg = 'rgba(255,255,255,0.04)';
          } else {
            const hue = s.break_reason === 'hard_max' ? '0,70%,60%'
              : s.break_reason === 'strong_break' ? '174,58%,55%'
              : s.break_reason === 'natural_break' ? '263,68%,65%'
              : '210,20%,45%';
            bg = `hsla(${hue},0.7)`;
          }
          const label = s.is_filler ? '' : s.words.split(' ').slice(0, 3).join(' ');
          return `<div class="seg-timeline-block" data-seg-idx="${s.index}" title="${esc(s.words)} (${s.duration.toFixed(2)}s)" onclick="event.stopPropagation();segPlayBlock(${s.index})" style="position:absolute;left:${left}%;width:${width}%;height:100%;background:${bg};display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity 0.15s;border-right:1px solid var(--bg-darkest);cursor:pointer" onmouseenter="segHighlight(${s.index})" onmouseleave="segUnhighlight(${s.index})">
            <span style="font-size:8px;color:rgba(255,255,255,0.8);font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px">${esc(label)}</span>
          </div>`;
        }).join('')}
        <div id="seg-playhead" style="position:absolute;top:0;left:0;width:2px;height:100%;background:white;z-index:10;pointer-events:none;opacity:0;transition:opacity 0.15s"></div>
      </div>
      <span id="seg-time-display" class="font-mono" style="font-size:10px;color:var(--text-muted);min-width:48px;text-align:right;flex-shrink:0">0.00s</span>
    </div>
    <div class="flex justify-between" style="font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;margin-left:38px">
      <span>0.00s</span>
      <span>${totalDuration.toFixed(2)}s</span>
    </div>`;
}

function segHighlight(idx) {
  if (_segAudio && !_segAudio.paused) return; // don't override playback highlight
  const card = $(`.seg-card[data-seg-idx="${idx}"]`);
  if (card) card.style.borderColor = 'var(--accent)';
}

function segUnhighlight(idx) {
  if (_segAudio && !_segAudio.paused) return;
  const card = $(`.seg-card[data-seg-idx="${idx}"]`);
  if (card) {
    card.style.borderColor = 'var(--border)';
    card.style.borderLeftColor = '';
  }
}

// ---- Audio Playback ----

function _segGetAudioUrl() {
  // Try from alignment state (has folder + source_file)
  const align = STATE.segmenterAlignment;
  if (align?.folder && align?.source_file) {
    return `/output/alignments/${align.folder}/${align.source_file}`;
  }
  // Try from alignment result
  const result = STATE.alignResult;
  if (result?.folder && result?.source_file) {
    return `/output/alignments/${result.folder}/${result.source_file}`;
  }
  // Try matching segmenter source_folder against alignment history
  const srcFolder = STATE.segmenterResult?.metadata?.source_folder;
  if (srcFolder && STATE.alignHistory) {
    const match = STATE.alignHistory.find(h => h.folder === srcFolder);
    if (match) return `/output/alignments/${match.folder}/${match.source_file}`;
  }
  return null;
}

function _segLoadAudio() {
  segStopAudio();
  const url = _segGetAudioUrl();
  if (!url) {
    // Hide play button if no audio
    const btn = $('#seg-play-btn');
    if (btn) btn.style.display = 'none';
    return;
  }
  _segAudio = new Audio(url);
  _segAudio.addEventListener('ended', () => {
    _segResetPlayback();
  });
  _segAudio.addEventListener('error', () => {
    const btn = $('#seg-play-btn');
    if (btn) btn.style.display = 'none';
  });
}

function segTogglePlay() {
  if (!_segAudio) return;
  if (_segAudio.paused) {
    _segAudio.play().then(() => {
      _segSetPlayIcon(false);
      $('#seg-playhead').style.opacity = '1';
      _segAnimFrame = requestAnimationFrame(_segTick);
    }).catch(e => console.warn('Audio play failed:', e));
  } else {
    _segAudio.pause();
    _segSetPlayIcon(true);
    if (_segAnimFrame) { cancelAnimationFrame(_segAnimFrame); _segAnimFrame = null; }
  }
}

function _segResetPlayback() {
  if (_segAudio) {
    _segAudio.pause();
    _segAudio.currentTime = 0;
  }
  if (_segAnimFrame) { cancelAnimationFrame(_segAnimFrame); _segAnimFrame = null; }
  _segSetPlayIcon(true);
  _segClearHighlights();
  const playhead = $('#seg-playhead');
  if (playhead) { playhead.style.left = '0%'; playhead.style.opacity = '0'; }
  const display = $('#seg-time-display');
  if (display) display.textContent = '0.00s';
  _segActiveIdx = -1;
}

function segStopAudio() {
  if (_segAudio) {
    _segAudio.pause();
    _segAudio.currentTime = 0;
    _segAudio = null;
  }
  if (_segAnimFrame) { cancelAnimationFrame(_segAnimFrame); _segAnimFrame = null; }
  _segSetPlayIcon(true);
  _segClearHighlights();
  const playhead = $('#seg-playhead');
  if (playhead) playhead.style.opacity = '0';
  _segActiveIdx = -1;
}

function segPlayBlock(idx) {
  if (!_segAudio || !STATE.segmenterResult) return;
  const segments = STATE.segmenterResult.segments || [];
  const seg = segments.find(s => s.index === idx);
  if (!seg) return;
  _segAudio.currentTime = seg.start;
  _segUpdatePlayhead();
  if (_segAudio.paused) {
    _segAudio.play().then(() => {
      _segSetPlayIcon(false);
      $('#seg-playhead').style.opacity = '1';
      _segAnimFrame = requestAnimationFrame(_segTick);
    }).catch(e => console.warn('Audio play failed:', e));
  }
}

function segSeekFromClick(e) {
  if (!_segAudio) return;
  const bar = $('#seg-timeline-bar');
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const totalDuration = STATE.segmenterResult?.metadata?.total_duration || _segAudio.duration || 1;
  _segAudio.currentTime = pct * totalDuration;
  _segUpdatePlayhead();
  // Start playing if paused
  if (_segAudio.paused) segTogglePlay();
}

function _segTick() {
  if (!_segAudio || _segAudio.paused) return;
  _segUpdatePlayhead();
  _segAnimFrame = requestAnimationFrame(_segTick);
}

function _segUpdatePlayhead() {
  if (!_segAudio || !STATE.segmenterResult) return;
  const t = _segAudio.currentTime;
  const totalDuration = STATE.segmenterResult.metadata?.total_duration || _segAudio.duration || 1;
  const pct = (t / totalDuration * 100).toFixed(2);

  // Move playhead
  const playhead = $('#seg-playhead');
  if (playhead) {
    playhead.style.left = pct + '%';
    playhead.style.opacity = '1';
  }

  // Time display
  const display = $('#seg-time-display');
  if (display) display.textContent = t.toFixed(2) + 's';

  // Find active segment
  const segments = STATE.segmenterResult.segments || [];
  let activeIdx = -1;
  for (const s of segments) {
    if (t >= s.start && t < s.end) { activeIdx = s.index; break; }
  }

  if (activeIdx !== _segActiveIdx) {
    _segClearHighlights();
    _segActiveIdx = activeIdx;
    if (activeIdx >= 0) {
      // Highlight timeline block
      const block = $(`.seg-timeline-block[data-seg-idx="${activeIdx}"]`);
      if (block) block.style.outline = '2px solid white';

      // Highlight segment card
      const card = $(`.seg-card[data-seg-idx="${activeIdx}"]`);
      if (card) {
        card.style.borderColor = 'var(--accent)';
        card.style.boxShadow = '0 0 12px rgba(78,205,196,0.3)';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

function _segClearHighlights() {
  // Clear timeline block outlines
  document.querySelectorAll('.seg-timeline-block').forEach(el => el.style.outline = '');
  // Clear card highlights
  document.querySelectorAll('.seg-card').forEach(el => {
    el.style.borderColor = 'var(--border)';
    el.style.borderLeftColor = '';
    el.style.boxShadow = '';
  });
}

function _segSetPlayIcon(isPlay) {
  const icon = $('#seg-play-icon');
  if (!icon) return;
  icon.innerHTML = isPlay
    ? '<polygon points="5,3 19,12 5,21"/>'
    : '<rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/>';
}

// ---- Actions ----

function copySegJSON() {
  if (!STATE.segmenterResult) return;
  navigator.clipboard.writeText(JSON.stringify(STATE.segmenterResult, null, 2))
    .then(() => toast('Segmenter JSON copied'))
    .catch(() => toast('Copy failed', 'error'));
}

function downloadSegJSON() {
  if (!STATE.segmenterResult) return;
  const json = JSON.stringify(STATE.segmenterResult, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const folder = STATE.segmenterResult.output_folder || 'segmented';
  a.download = folder + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- History ----

async function loadSegHistory() {
  try {
    const items = await api('/api/segmenter/history');
    renderSegHistory(items);
  } catch (e) {
    console.error('Segmenter history:', e);
  }
}

function renderSegHistory(items) {
  const list = $('#seg-history-list');
  if (!list) return;

  if (!items || !items.length) {
    list.innerHTML = '<p style="text-align:center;padding:32px 0;font-size:13px;color:var(--text-muted)">No segmentations yet</p>';
    $('#seg-history-count').textContent = '0 results';
    return;
  }

  const currentFolder = STATE.segmenterResult?.output_folder || null;
  $('#seg-history-count').textContent = items.length + ' result' + (items.length !== 1 ? 's' : '');

  list.innerHTML = items.map(item => {
    const isActive = currentFolder && item.folder === currentFolder;
    const activeStyle = isActive
      ? 'background:rgba(78,205,196,0.06);border-left:3px solid var(--accent)'
      : 'border-left:3px solid transparent';

    return `
    <div class="hist-item" style="cursor:pointer;transition:background 0.15s;${activeStyle}" onclick="loadSegHistoryItem('${esc(item.folder)}')" onmouseover="this.style.background='var(--bg-darkest)'" onmouseout="this.style.background='${isActive ? 'rgba(78,205,196,0.06)' : ''}'">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
            <span style="font-size:13px;color:${isActive ? 'var(--accent)' : 'var(--text)'};font-weight:${isActive ? '600' : '400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.project_id || item.source_folder || item.folder)}</span>
            ${isActive ? '<span class="font-mono" style="font-size:8px;padding:1px 6px;border-radius:3px;background:rgba(78,205,196,0.15);color:var(--accent);letter-spacing:0.05em;flex-shrink:0">ACTIVE</span>' : ''}
          </div>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:0">${item.segment_count} segments · ${item.filler_count} fillers · avg ${item.avg_duration.toFixed(2)}s · ${item.total_duration.toFixed(1)}s total · ${timeAgo(item.segmented_at)}</p>
        </div>
        <svg width="14" height="14" fill="none" stroke="${isActive ? 'var(--accent)' : 'var(--text-muted)'}" stroke-width="1.5" viewBox="0 0 24 24" style="flex-shrink:0;opacity:${isActive ? '0.8' : '0.4'}"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </div>`;
  }).join('');
}

async function loadSegHistoryItem(folder) {
  try {
    const data = await api(`/api/segmenter/${encodeURIComponent(folder)}`);
    STATE.segmenterResult = data;
    renderSegResults(data);
    loadSegHistory(); // refresh to highlight active
    toast('Segmentation loaded');
  } catch (e) {
    toast(e.message || 'Failed to load segmentation', 'error');
  }
}

// Load history on startup
loadSegHistory();
