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

// ---- Source Selection ----

function segUseCurrentResult() {
  if (!STATE.alignResult || !STATE.alignResult.alignment) {
    toast('No alignment result available. Run alignment first.', 'error');
    return;
  }
  STATE.segmenterAlignment = STATE.alignResult;
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
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${h.word_count} words · ${h.duration_seconds}s · ${timeAgo(h.timestamp)}</p>
        </div>
        <span class="font-mono" style="font-size:9px;color:var(--text-muted);flex-shrink:0;background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${esc(h.source_file || '')}</span>
      </div>
    </div>`;
  }).join('');
}

function segSelectHistory(idx) {
  const h = STATE.alignHistory[idx];
  if (!h) return;
  STATE.segmenterAlignment = { folder: h.folder, alignment: h.word_alignment, transcript: h.transcript };
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
  $('#seg-source-info').textContent = `${wc} words · ${dur.toFixed(1)}s from ${label}`;
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
    toast('Segmentation complete');
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
  $('#seg-results').style.display = '';
  const segments = data.segments || [];
  const stats = data.stats || {};

  // Stats bar
  $('#seg-stats').textContent = `${stats.segment_count} segments · ${stats.filler_count} fillers · avg ${stats.avg_duration.toFixed(2)}s · range ${stats.min_duration.toFixed(2)}s - ${stats.max_duration.toFixed(2)}s`;

  // Timeline visualization
  renderSegTimeline(segments, data.metadata);

  // Segment list
  $('#seg-list').innerHTML = segments.map(s => {
    if (s.is_filler) {
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;background:var(--bg-darkest);border:1px dashed var(--border);opacity:0.6">
        <span class="font-mono" style="font-size:10px;color:var(--text-muted);min-width:40px">silence</span>
        <div style="flex:1;height:2px;background:var(--border);border-radius:1px"></div>
        <span class="font-mono" style="font-size:10px;color:var(--text-muted)">${s.duration.toFixed(2)}s</span>
      </div>`;
    }
    const reasonColor = {
      strong_break: '#4ECDC4',
      natural_break: '#A78BFA',
      hard_max: '#FF6B6B',
      end_of_text: 'var(--text-muted)',
    };
    const rc = reasonColor[s.break_reason] || 'var(--text-muted)';
    return `
    <div class="seg-card" data-seg-idx="${s.index}" style="background:var(--bg-surface);border:1px solid var(--border);border-left:3px solid ${rc};border-radius:10px;padding:12px 14px;transition:all 0.2s;cursor:default">
      <div class="flex items-center justify-between mb-1.5">
        <span class="font-mono text-xs" style="color:${rc}">Segment ${s.index} · ${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="font-mono" style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(78,205,196,0.1);color:var(--accent)">${s.duration.toFixed(2)}s</span>
          <span class="font-mono" style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bg-darkest);color:var(--text-muted)">${s.break_reason}</span>
        </div>
      </div>
      <p style="font-size:13px;color:var(--text);line-height:1.6;margin:0">${esc(s.words)}</p>
      <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin-top:4px">${s.word_count} words</p>
    </div>`;
  }).join('');
}

function renderSegTimeline(segments, metadata) {
  const container = $('#seg-timeline');
  if (!segments.length) { container.innerHTML = ''; return; }

  const totalDuration = metadata.total_duration || segments[segments.length - 1].end;
  const barHeight = 32;

  container.innerHTML = `
    <div style="position:relative;height:${barHeight}px;background:var(--bg-darkest);border-radius:8px;overflow:hidden;border:1px solid var(--border)">
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
        return `<div class="seg-timeline-block" data-seg-idx="${s.index}" title="${esc(s.words)} (${s.duration.toFixed(2)}s)" style="position:absolute;left:${left}%;width:${width}%;height:100%;background:${bg};display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;transition:opacity 0.15s;border-right:1px solid var(--bg-darkest)" onmouseenter="segHighlight(${s.index})" onmouseleave="segUnhighlight(${s.index})">
          <span style="font-size:8px;color:rgba(255,255,255,0.8);font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px">${esc(label)}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="flex justify-between mt-1" style="font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">
      <span>0.00s</span>
      <span>${totalDuration.toFixed(2)}s</span>
    </div>`;
}

function segHighlight(idx) {
  const card = $(`.seg-card[data-seg-idx="${idx}"]`);
  if (card) card.style.borderColor = 'var(--accent)';
}

function segUnhighlight(idx) {
  const card = $(`.seg-card[data-seg-idx="${idx}"]`);
  if (card) {
    card.style.borderColor = 'var(--border)';
    card.style.borderLeftColor = '';
  }
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
