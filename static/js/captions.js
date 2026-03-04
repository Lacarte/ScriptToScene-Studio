/* ================================================================
   ScriptToScene Studio — Caption Editor
   Generates shorts-style captions from word-level alignment data.
   ================================================================ */

let _capPresets = [];
let _capAudio = null;
let _capAnimFrame = null;
let _capActiveIdx = -1;

// ---- Load alignment data ----

function loadCaptionsFromAlignment() {
  const align = STATE.alignResult;
  if (!align || !align.alignment) {
    toast('No alignment result available. Run alignment first.', 'error');
    return;
  }
  STATE.captionAlignment = align;
  _capUpdateSource(align);
  toast('Alignment loaded');
}

async function captionsPickAlignHistory() {
  try {
    const items = await api('/api/timing/history');
    if (!items.length) { toast('No alignment history', 'error'); return; }

    const modal = $('#captions-align-picker-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    $('#captions-align-picker-list').innerHTML = items.map(h => `
      <div class="hist-item" style="cursor:pointer" onclick="captionsSelectAlignHistory('${esc(h.folder)}')">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
          <div style="flex:1;min-width:0">
            <p style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${esc(h.source_file || h.folder)}</p>
            <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${h.word_count} words · ${h.duration_seconds?.toFixed(1) || '?'}s</p>
          </div>
          <span class="font-mono" style="font-size:9px;color:var(--text-muted);background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${timeAgo(h.timestamp)}</span>
        </div>
      </div>
    `).join('');
  } catch (e) { toast('Failed to load history', 'error'); }
}

async function captionsSelectAlignHistory(folder) {
  captionsCloseAlignPicker();
  try {
    const items = await api('/api/timing/history');
    const match = items.find(h => h.folder === folder);
    if (match) {
      STATE.captionAlignment = match;
      _capUpdateSource(match);
      toast('Alignment loaded from history');
    }
  } catch (e) { toast(e.message, 'error'); }
}

function captionsCloseAlignPicker() {
  const modal = $('#captions-align-picker-modal');
  modal.classList.add('hidden');
  modal.style.display = '';
}

function _capUpdateSource(align) {
  const el = $('#captions-source-label');
  if (!align) { el.textContent = 'No alignment loaded'; el.style.color = 'var(--text-muted)'; return; }
  const wc = align.word_count || (align.word_alignment || align.alignment || []).length;
  const dur = align.duration_seconds || 0;
  el.textContent = `${wc} words · ${dur.toFixed(1)}s · ${align.source_file || align.folder || ''}`;
  el.style.color = 'var(--accent)';

  // Load audio for preview
  _capLoadAudio(align);
}

function _capLoadAudio(align) {
  _capStopPreview();
  if (align?.folder && align?.source_file) {
    _capAudio = new Audio(`/output/alignments/${align.folder}/${align.source_file}`);
    _capAudio.addEventListener('ended', _capStopPreview);
  }
}

// ---- Generate captions ----

async function generateCaptions() {
  const align = STATE.captionAlignment;
  if (!align) { toast('Load alignment first', 'error'); return; }

  const alignment = align.word_alignment || align.alignment || [];
  if (!alignment.length) { toast('No word alignment data', 'error'); return; }

  const wordsPerGroup = parseInt($('#cap-words-per-group')?.value || '3');
  const preset = $('#cap-preset-select')?.value || 'bold_popup';

  const btn = $('#cap-generate-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const res = await api('/api/captions/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alignment,
        words_per_group: wordsPerGroup,
        preset,
        project_id: align.project_id || '',
        source_folder: align.folder || '',
      }),
    });
    STATE.captionData = res;
    renderCaptionList();
    renderCaptionStylePanel(res.style);
    toast(`${res.caption_count} captions generated`);
    loadCaptionsHistory();
  } catch (e) {
    toast(e.message || 'Caption generation failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Auto-Generate';
  }
}

// ---- Render caption list ----

function renderCaptionList() {
  const data = STATE.captionData;
  if (!data || !data.captions) {
    $('#captions-list').innerHTML = '<p style="text-align:center;padding:24px;font-size:12px;color:var(--text-muted)">No captions yet. Load alignment and click Auto-Generate.</p>';
    $('#captions-actions').style.display = 'none';
    return;
  }

  $('#captions-actions').style.display = 'flex';
  const captions = data.captions;
  $('#captions-count').textContent = `${captions.length} captions`;

  $('#captions-list').innerHTML = captions.map((c, i) => `
    <div class="cap-item" data-cap-idx="${i}" onclick="capPreviewJump(${i})" style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:all 0.15s;border:1px solid transparent">
      <span class="font-mono" style="font-size:9px;color:var(--text-muted);min-width:22px;padding-top:3px">#${i + 1}</span>
      <div style="flex:1;min-width:0">
        <input class="cap-text-input" value="${esc(c.text)}" oninput="capEditText(${i}, this.value)" onclick="event.stopPropagation()"
          style="width:100%;background:none;border:none;color:var(--text);font-size:13px;font-weight:600;padding:0;outline:none;font-family:inherit">
        <div class="font-mono" style="font-size:9px;color:var(--text-muted);margin-top:2px">${c.start.toFixed(2)}s — ${c.end.toFixed(2)}s · ${c.words.length} words</div>
      </div>
    </div>
  `).join('');

  // Show preview bar
  $('#captions-preview-bar').style.display = '';
}

function capEditText(idx, value) {
  if (STATE.captionData && STATE.captionData.captions[idx]) {
    STATE.captionData.captions[idx].text = value;
  }
}

// ---- Style panel ----

function renderCaptionStylePanel(style) {
  if (!style) return;
  // Update preset select
  const sel = $('#cap-preset-select');
  if (sel) sel.value = style.preset || 'bold_popup';

  // Update style controls
  if ($('#cap-font-family')) $('#cap-font-family').value = style.font_family || 'Montserrat';
  if ($('#cap-font-size')) $('#cap-font-size').value = style.font_size || 64;
  if ($('#cap-color')) $('#cap-color').value = style.color || '#FFFFFF';
  if ($('#cap-stroke-color')) $('#cap-stroke-color').value = style.stroke_color || '#000000';
  if ($('#cap-position-y')) $('#cap-position-y').value = style.position_y || 75;
  if ($('#cap-position-y-val')) $('#cap-position-y-val').textContent = (style.position_y || 75) + '%';
}

async function capSelectPreset(presetId) {
  if (!_capPresets.length) {
    try { _capPresets = await api('/api/captions/presets'); } catch (e) { return; }
  }
  const preset = _capPresets.find(p => p.id === presetId);
  if (preset && STATE.captionData) {
    STATE.captionData.style = { ...preset, preset: presetId };
    renderCaptionStylePanel(STATE.captionData.style);
  }
}

function capUpdateStyle(key, value) {
  if (STATE.captionData?.style) {
    STATE.captionData.style[key] = value;
    if (key === 'position_y' && $('#cap-position-y-val')) {
      $('#cap-position-y-val').textContent = value + '%';
    }
  }
}

// ---- Audio preview with caption sync ----

function capTogglePreview() {
  if (!_capAudio) { toast('No audio loaded', 'error'); return; }
  if (_capAudio.paused) {
    _capAudio.play().then(() => {
      _capAnimFrame = requestAnimationFrame(_capTick);
      $('#cap-play-icon').innerHTML = '<rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/>';
    }).catch(() => {});
  } else {
    _capAudio.pause();
    if (_capAnimFrame) { cancelAnimationFrame(_capAnimFrame); _capAnimFrame = null; }
    $('#cap-play-icon').innerHTML = '<polygon points="5,3 19,12 5,21"/>';
  }
}

function _capStopPreview() {
  if (_capAudio) { _capAudio.pause(); _capAudio.currentTime = 0; }
  if (_capAnimFrame) { cancelAnimationFrame(_capAnimFrame); _capAnimFrame = null; }
  _capActiveIdx = -1;
  _capClearHighlights();
  const icon = $('#cap-play-icon');
  if (icon) icon.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
  const display = $('#cap-time-display');
  if (display) display.textContent = '0.00s';
}

function _capTick() {
  if (!_capAudio || _capAudio.paused) return;
  const t = _capAudio.currentTime;
  const display = $('#cap-time-display');
  if (display) display.textContent = t.toFixed(2) + 's';

  // Find active caption
  const captions = STATE.captionData?.captions || [];
  let activeIdx = -1;
  for (let i = 0; i < captions.length; i++) {
    if (t >= captions[i].start && t < captions[i].end) { activeIdx = i; break; }
  }

  if (activeIdx !== _capActiveIdx) {
    _capClearHighlights();
    _capActiveIdx = activeIdx;
    if (activeIdx >= 0) {
      const el = $(`.cap-item[data-cap-idx="${activeIdx}"]`);
      if (el) {
        el.style.borderColor = 'var(--accent)';
        el.style.background = 'rgba(78,205,196,0.06)';
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  // Update caption preview text
  const previewEl = $('#cap-preview-text');
  if (previewEl) {
    const style = STATE.captionData?.style || {};
    if (activeIdx >= 0) {
      let text = captions[activeIdx].text;
      if (style.text_transform === 'uppercase') text = text.toUpperCase();
      previewEl.textContent = text;
      previewEl.style.fontFamily = `"${style.font_family || 'Montserrat'}", sans-serif`;
      previewEl.style.fontWeight = style.font_weight || '800';
      previewEl.style.fontSize = '24px';
      previewEl.style.color = style.color || '#FFFFFF';
      previewEl.style.opacity = '1';
      if (style.stroke_color && style.stroke_color !== 'none') {
        previewEl.style.textShadow = `
          -2px -2px 0 ${style.stroke_color}, 2px -2px 0 ${style.stroke_color},
          -2px 2px 0 ${style.stroke_color}, 2px 2px 0 ${style.stroke_color}`;
      } else {
        previewEl.style.textShadow = 'none';
      }
    } else {
      previewEl.style.opacity = '0.3';
    }
  }

  _capAnimFrame = requestAnimationFrame(_capTick);
}

function _capClearHighlights() {
  document.querySelectorAll('.cap-item').forEach(el => {
    el.style.borderColor = 'transparent';
    el.style.background = '';
  });
}

function capPreviewJump(idx) {
  if (!_capAudio || !STATE.captionData?.captions[idx]) return;
  _capAudio.currentTime = STATE.captionData.captions[idx].start;
  if (_capAudio.paused) capTogglePreview();
}

// ---- Save & send to editor ----

async function captionSave() {
  if (!STATE.captionData) { toast('No captions to save', 'error'); return; }
  try {
    await api('/api/captions/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(STATE.captionData),
    });
    toast('Captions saved');
    loadCaptionsHistory();
  } catch (e) { toast(e.message, 'error'); }
}

function captionSendToEditor() {
  if (!STATE.captionData) { toast('No captions to send', 'error'); return; }
  localStorage.setItem('sts-editor-captions', JSON.stringify(STATE.captionData));
  switchPage('editor');
  toast('Captions sent to editor', 'info');
}

// ---- History ----

async function loadCaptionsHistory() {
  try {
    const items = await api('/api/captions/history');
    const list = $('#captions-history-list');
    if (!items.length) {
      list.innerHTML = '<p style="text-align:center;padding:24px;font-size:12px;color:var(--text-muted)">No caption projects yet</p>';
      return;
    }
    list.innerHTML = items.map(h => `
      <div class="hist-item" style="cursor:pointer" onclick="loadCaptionProject('${esc(h.project_id)}')">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
          <div style="flex:1;min-width:0">
            <p style="font-size:13px;color:var(--text);margin:0">${esc(h.project_id)}</p>
            <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${h.caption_count} captions · ${h.preset || ''} · ${timeAgo(h.timestamp)}</p>
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) { /* ignore */ }
}

async function loadCaptionProject(projectId) {
  try {
    const data = await api(`/api/captions/${projectId}`);
    STATE.captionData = data;
    renderCaptionList();
    renderCaptionStylePanel(data.style);
    toast('Captions loaded');
  } catch (e) { toast(e.message, 'error'); }
}

// ---- Init ----

async function _capLoadPresets() {
  try { _capPresets = await api('/api/captions/presets'); } catch (e) { /* ignore */ }
}

_capLoadPresets();
loadCaptionsHistory();
