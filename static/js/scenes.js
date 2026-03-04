/* ================================================================
   ScriptToScene Studio — Scenes Module (AI Scene Script Generator)
   Consumes segmenter output → builds n8n webhook payload → renders results.
   ================================================================ */

// ---- State ----
// STATE.scenesSegData  — full segmenter result (metadata + segments)
// STATE.scenesResult   — generated scenes from webhook

// Audio playback state
let _scnAudio = null;
let _scnAnimFrame = null;
let _scnActiveIdx = -1;
let _scnSegTimings = []; // [{start, end, sceneIdx}] derived from segmenter segments

// ---- Source Selection ----

function scenesUseCurrentSegment() {
  if (!STATE.segmenterResult || !STATE.segmenterResult.segments) {
    toast('No segmenter result available. Run the segmenter first.', 'error');
    return;
  }
  STATE.scenesSegData = STATE.segmenterResult;
  _updateScenesSource();
  toast('Segmentation loaded');
}

async function scenesPickSegHistory() {
  let items;
  try {
    items = await api('/api/segmenter/history');
  } catch (e) {
    toast('Failed to load segmenter history', 'error');
    return;
  }
  if (!items.length) {
    toast('No segmenter history. Run the segmenter first.', 'error');
    return;
  }

  const modal = $('#scenes-seg-picker-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  $('#scenes-seg-picker-list').innerHTML = items.map((h, i) => {
    const src = h.source_folder || '';
    const truncated = src.length > 45 ? src.slice(0, 45) + '...' : src;
    return `
    <div class="hist-item" style="cursor:pointer" onclick="scenesSelectSegHistory('${esc(h.folder)}')">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${esc(truncated)}</p>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${h.project_id ? h.project_id + ' · ' : ''}${h.segment_count} segments · ${h.total_duration.toFixed(1)}s · avg ${h.avg_duration.toFixed(2)}s</p>
        </div>
        <span class="font-mono" style="font-size:9px;color:var(--text-muted);flex-shrink:0;background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${timeAgo(h.segmented_at)}</span>
      </div>
    </div>`;
  }).join('');
}

async function scenesSelectSegHistory(folder) {
  scenesCloseSegPicker();
  try {
    const res = await fetch(`/api/segmenter/${encodeURIComponent(folder)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    STATE.scenesSegData = data;
    _updateScenesSource();
    toast('Segmentation loaded from history');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function scenesCloseSegPicker() {
  const modal = $('#scenes-seg-picker-modal');
  modal.classList.add('hidden');
  modal.style.display = '';
}

function scenesHandleUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.segments || !data.segments.length) throw new Error('No segments array found');
      STATE.scenesSegData = data;
      _updateScenesSource();
      toast('Segmentation loaded from file');
    } catch (err) {
      toast('Invalid segmentation JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function _updateScenesSource() {
  const d = STATE.scenesSegData;
  if (!d || !d.segments) {
    $('#scenes-source-info').textContent = 'No segmentation selected';
    $('#scenes-source-info').style.color = 'var(--text-muted)';
    $('#scenes-json-preview').style.display = 'none';
    return;
  }
  const stats = d.stats || {};
  const meta = d.metadata || {};
  const segCount = stats.segment_count || d.segments.filter(s => !s.is_filler).length;
  const dur = meta.total_duration || 0;
  const src = meta.source_folder || d.output_folder || 'uploaded';
  const pid = meta.project_id ? `${meta.project_id} · ` : '';
  $('#scenes-source-info').textContent = `${pid}${segCount} segments · ${dur.toFixed(1)}s from ${src}`;
  $('#scenes-source-info').style.color = 'var(--accent)';

  // Preview the full webhook payload that will be sent
  const preview = _buildWebhookPayload(d);
  $('#scenes-json-preview').style.display = '';
  $('#scenes-json-preview').textContent = JSON.stringify(preview, null, 2);
}

// ---- Webhook Toggle ----

async function scenesInitWebhookUrl() {
  try {
    const data = await api('/api/scenes/webhook-url');
    STATE._scenesDefaultWebhookUrl = data.url || '';
  } catch (e) {
    STATE._scenesDefaultWebhookUrl = '';
  }
  // Restore from localStorage, fall back to server default
  const saved = localStorage.getItem('sts-scenes-webhook-url');
  $('#scenes-webhook-url').value = saved !== null ? saved : STATE._scenesDefaultWebhookUrl;

  // Restore toggle state
  const savedToggle = localStorage.getItem('sts-scenes-webhook-enabled');
  if (savedToggle === 'false') {
    $('#scenes-webhook-toggle').checked = false;
    scenesToggleWebhook();
  }
}

function scenesToggleWebhook() {
  const on = $('#scenes-webhook-toggle').checked;
  const dot = $('#scenes-webhook-dot');
  localStorage.setItem('sts-scenes-webhook-enabled', on);
  if (on) {
    dot.style.transform = 'translateX(16px)';
    dot.style.background = 'var(--accent)';
    $('#scenes-webhook-url-row').style.display = 'flex';
    $('#scenes-webhook-off-msg').style.display = 'none';
    $('#scenes-btn-label').textContent = 'Generate Scene Script';
  } else {
    dot.style.transform = 'translateX(0)';
    dot.style.background = 'var(--text-muted)';
    $('#scenes-webhook-url-row').style.display = 'none';
    $('#scenes-webhook-off-msg').style.display = '';
    $('#scenes-btn-label').textContent = 'Preview Payload';
  }
}

function scenesResetWebhookUrl() {
  $('#scenes-webhook-url').value = STATE._scenesDefaultWebhookUrl || '';
  localStorage.removeItem('sts-scenes-webhook-url');
  toast('Webhook URL reset to default');
}

// ---- Style Templates ----

let _scnTemplates = [];

async function scenesLoadTemplates() {
  try {
    _scnTemplates = await api('/api/scenes/templates');
  } catch (e) {
    // Fallback if API unavailable
    _scnTemplates = [{ id: 'cinematic', name: 'Cinematic', description: 'Default', color: '#4ECDC4', style_prompt: '' }];
  }
  _scnRenderTemplateGrid();
}

function _scnRenderTemplateGrid() {
  const grid = $('#scenes-style-grid');
  if (!grid || !_scnTemplates.length) return;
  const current = $('#scenes-style').value || 'cinematic';
  grid.innerHTML = _scnTemplates.map(t => {
    const sel = t.id === current;
    return `<div class="scene-style-card" data-style-id="${t.id}" onclick="scenesSelectStyle('${t.id}')"
      style="padding:10px 12px;border-radius:10px;cursor:pointer;transition:all 0.2s;
        border:1.5px solid ${sel ? t.color : 'var(--border)'};
        background:${sel ? t.color + '12' : 'var(--bg-card)'};
        ${sel ? 'box-shadow:0 0 12px ' + t.color + '25;' : ''}"
      onmouseenter="this.style.borderColor='${t.color}'"
      onmouseleave="if(!this.classList.contains('selected'))this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="width:8px;height:8px;border-radius:50%;background:${t.color};flex-shrink:0"></span>
        <span style="font-size:12px;font-weight:600;color:var(--text)">${esc(t.name)}</span>
      </div>
      <p style="font-size:10px;color:var(--text-muted);margin:0;line-height:1.4">${esc(t.description)}</p>
    </div>`;
  }).join('');

  // Mark selected
  grid.querySelectorAll('.scene-style-card').forEach(el => {
    if (el.dataset.styleId === current) el.classList.add('selected');
  });
}

function scenesSelectStyle(styleId) {
  $('#scenes-style').value = styleId;
  _scnRenderTemplateGrid();
  _updateScenesSource(); // refresh payload preview
}

function _scnGetSelectedTemplate() {
  const id = $('#scenes-style').value || 'cinematic';
  return _scnTemplates.find(t => t.id === id) || {};
}

// ---- Webhook Payload Builder ----

function _buildWebhookPayload(segData) {
  const meta = segData.metadata || {};
  const segments = (segData.segments || [])
    .filter(s => !s.is_filler)
    .map(s => ({ index: s.index, words: s.words }));

  const template = _scnGetSelectedTemplate();
  return {
    script: meta.transcript || '',
    style: $('#scenes-style').value || meta.style || 'cinematic',
    style_prompt: template.style_prompt || '',
    segments: segments,
  };
}

// ---- Generate ----

// ---- Generate: always show preview first ----

function handleGenerateScenes() {
  if (!STATE.scenesSegData || !STATE.scenesSegData.segments) {
    toast('Select a segmentation source first', 'error');
    return;
  }

  const meta = STATE.scenesSegData.metadata || {};
  const payload = {
    ..._buildWebhookPayload(STATE.scenesSegData),
    source_folder: meta.source_folder || '',
    aspect_ratio: $('#scenes-aspect').value,
  };

  // Populate the preview
  $('#scenes-payload-preview-content').textContent = JSON.stringify(payload, null, 2);

  // Sync the inline webhook URL from the settings field
  $('#scenes-preview-webhook-url').value = $('#scenes-webhook-url').value || '';

  // Show the preview panel
  $('#scenes-payload-preview').style.display = '';

  // Scroll to the preview
  $('#scenes-payload-preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- Toggle Preview (close button) ----

function scenesTogglePayloadPreview() {
  const panel = $('#scenes-payload-preview');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

// ---- Copy Payload ----

function scenesPayloadCopy() {
  const text = $('#scenes-payload-preview-content').textContent;
  navigator.clipboard.writeText(text)
    .then(() => toast('Payload copied'))
    .catch(() => toast('Copy failed', 'error'));
}

// ---- Send Preview Payload to Webhook ----

async function scenesSendPreviewToWebhook() {
  if (!STATE.scenesSegData || !STATE.scenesSegData.segments) {
    toast('Select a segmentation source first', 'error');
    return;
  }

  // Use the URL from the preview panel's inline input
  const webhookUrl = $('#scenes-preview-webhook-url').value.trim();
  if (!webhookUrl) {
    toast('Enter a webhook URL before sending', 'error');
    $('#scenes-preview-webhook-url').focus();
    return;
  }

  // Also sync back to the main settings field + localStorage
  $('#scenes-webhook-url').value = webhookUrl;
  localStorage.setItem('sts-scenes-webhook-url', webhookUrl);

  const btn = $('#scenes-send-preview-btn');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:-2px;margin-right:6px"></span>Sending...';

  try {
    const meta = STATE.scenesSegData.metadata || {};
    const payload = {
      ..._buildWebhookPayload(STATE.scenesSegData),
      project_id: meta.project_id || '',
      source_folder: meta.source_folder || '',
      aspect_ratio: $('#scenes-aspect').value,
      webhook_url: webhookUrl,
    };

    const res = await fetch('/api/scenes/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Send failed');

    STATE.scenesResult = data;
    renderSceneResults(data);
    toast('Sent to webhook successfully');
    loadScenesHistory();
    showContinueBar('scenes-results', 'assets', 'Continue to Assets \u2192', () => sendToAssets());

    // Collapse the preview after successful send
    $('#scenes-payload-preview').style.display = 'none';
  } catch (e) {
    toast(e.message || 'Failed to send to webhook', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

// ---- Render Results ----

function renderSceneResults(data) {
  scnStopAudio();
  $('#scenes-results').style.display = '';
  const scenes = data.scenes || [];
  const totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 0), 0);
  const pid = data.project_id ? `${data.project_id} · ` : '';
  $('#scenes-stats').textContent = `${pid}${scenes.length} scenes · ${totalDuration.toFixed(1)}s total`;

  // Compute scene timings from segmenter data
  _scnBuildTimings(scenes);

  // Timeline visualization + audio player
  _scnRenderTimeline(scenes);

  const typeColors = { video: '#4ECDC4', image: '#A78BFA', text: '#FFB347' };
  const typeBg = { video: 'rgba(78,205,196,0.1)', image: 'rgba(167,139,250,0.1)', text: 'rgba(255,179,71,0.1)' };

  $('#scenes-list').innerHTML = scenes.map((s, i) => {
    const tc = typeColors[s.type_of_scene] || '#6b7f93';
    const tb = typeBg[s.type_of_scene] || 'rgba(107,127,147,0.1)';
    const timing = _scnSegTimings[i];
    const timeStr = timing ? `${timing.start.toFixed(2)}s - ${timing.end.toFixed(2)}s` : '';
    return `
    <div class="scene-card" data-scene-idx="${i}" data-start="${timing?.start || 0}" data-end="${timing?.end || 0}" onclick="scnPlayBlock(${i})" style="border-left-color:${tc};cursor:pointer">
      <div class="flex items-center justify-between mb-2">
        <span class="font-mono text-xs" style="color:${tc}">#${i + 1} &middot; ${esc(s.title || '')}${timeStr ? ` · <span style="color:var(--text-muted)">${timeStr}</span>` : ''}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="font-mono" style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px;background:${tb};color:${tc};text-transform:uppercase;letter-spacing:0.05em">${s.type_of_scene || 'video'}</span>
          ${s.narrative_role ? `<span class="font-mono" style="font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(78,205,196,0.08);color:var(--accent)">${esc(s.narrative_role)}</span>` : ''}
          <span class="font-mono" style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bg-darkest);color:var(--text-muted)">${(s.duration || 0).toFixed(1)}s</span>
        </div>
      </div>
      ${s.text_content ? `<p style="font-size:14px;color:${tc};margin-bottom:8px;font-weight:600">"${esc(s.text_content)}"</p>` : ''}
      <p style="font-size:11px;color:var(--text-secondary);font-style:italic;line-height:1.5">${esc(s.image_prompt || '')}</p>
    </div>`;
  }).join('');

  // Load audio for playback
  _scnLoadAudio();
}

// ---- Scene Timing from Segmenter Data ----

function _scnBuildTimings(scenes) {
  _scnSegTimings = [];
  const segData = STATE.scenesSegData;
  if (!segData || !segData.segments) {
    // Fallback: compute cumulative from scene durations
    let t = 0;
    for (let i = 0; i < scenes.length; i++) {
      const dur = scenes[i].duration || 0;
      _scnSegTimings.push({ start: t, end: t + dur, sceneIdx: i });
      t += dur;
    }
    return;
  }

  // Non-filler segments map 1:1 to scenes
  const allSegs = segData.segments;
  const speechSegs = allSegs.filter(s => !s.is_filler);
  const totalEnd = segData.metadata?.total_duration || allSegs[allSegs.length - 1]?.end || 0;

  for (let i = 0; i < scenes.length; i++) {
    const seg = speechSegs[i];
    if (seg) {
      // First scene absorbs leading silence (start from 0)
      const start = i === 0 ? 0 : seg.start;
      // Last scene extends to total audio duration
      const nextSeg = speechSegs[i + 1];
      const end = nextSeg ? nextSeg.start : totalEnd;
      _scnSegTimings.push({ start, end, sceneIdx: i });
    } else {
      // More scenes than segments — fallback to cumulative
      const prev = _scnSegTimings[i - 1];
      const start = prev ? prev.end : 0;
      const dur = scenes[i].duration || 0;
      _scnSegTimings.push({ start, end: start + dur, sceneIdx: i });
    }
  }
}

// ---- Timeline Visualization ----

function _scnRenderTimeline(scenes) {
  const container = $('#scenes-timeline');
  if (!scenes.length || !_scnSegTimings.length) { container.innerHTML = ''; return; }

  const totalDuration = _scnSegTimings[_scnSegTimings.length - 1]?.end || 1;
  const barHeight = 32;

  const typeColors = { video: '174,58%,55%', image: '263,68%,65%', text: '30,100%,64%' };

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <button id="scn-play-btn" onclick="scnTogglePlay()" style="width:28px;height:28px;border-radius:50%;background:var(--accent);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform 0.15s,background 0.15s" onmouseenter="this.style.transform='scale(1.1)'" onmouseleave="this.style.transform=''">
        <svg id="scn-play-icon" width="12" height="12" fill="white" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      <div id="scn-timeline-bar" style="position:relative;flex:1;height:${barHeight}px;background:var(--bg-darkest);border-radius:8px;overflow:hidden;border:1px solid var(--border);cursor:pointer" onclick="scnSeekFromClick(event)">
        ${scenes.map((s, i) => {
          const t = _scnSegTimings[i];
          if (!t) return '';
          const left = (t.start / totalDuration * 100).toFixed(2);
          const width = Math.max((t.end - t.start) / totalDuration * 100, 0.3).toFixed(2);
          const hue = typeColors[s.type_of_scene] || '210,20%,45%';
          const label = (s.title || '').split(' ').slice(0, 3).join(' ');
          return `<div class="scn-timeline-block" data-scene-idx="${i}" title="${esc(s.title || '')} (${(s.duration || 0).toFixed(1)}s)" onclick="event.stopPropagation();scnPlayBlock(${i})" style="position:absolute;left:${left}%;width:${width}%;height:100%;background:hsla(${hue},0.7);display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity 0.15s;border-right:1px solid var(--bg-darkest);cursor:pointer">
            <span style="font-size:8px;color:rgba(255,255,255,0.8);font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px">${esc(label)}</span>
          </div>`;
        }).join('')}
        <div id="scn-playhead" style="position:absolute;top:0;left:0;width:2px;height:100%;background:white;z-index:10;pointer-events:none;opacity:0;transition:opacity 0.15s"></div>
      </div>
      <span id="scn-time-display" class="font-mono" style="font-size:10px;color:var(--text-muted);min-width:48px;text-align:right;flex-shrink:0">0.00s</span>
    </div>
    <div class="flex justify-between" style="font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;margin-left:38px">
      <span>0.00s</span>
      <span>${totalDuration.toFixed(2)}s</span>
    </div>`;
}

// ---- Audio Playback ----

function _scnGetAudioUrl() {
  // Collect candidate folders: from segData metadata, scene result, or alignment state
  const folders = new Set();
  const segData = STATE.scenesSegData;
  if (segData?.metadata?.source_folder) folders.add(segData.metadata.source_folder);
  if (STATE.scenesResult?.source_folder) folders.add(STATE.scenesResult.source_folder);

  // Try each folder against alignment sources
  for (const folder of folders) {
    if (!folder) continue;
    const align = STATE.segmenterAlignment;
    if (align?.folder === folder && align?.source_file) {
      return `/output/alignments/${folder}/${align.source_file}`;
    }
    const result = STATE.alignResult;
    if (result?.folder === folder && result?.source_file) {
      return `/output/alignments/${folder}/${result.source_file}`;
    }
    if (STATE.alignHistory) {
      const match = STATE.alignHistory.find(h => h.folder === folder);
      if (match) return `/output/alignments/${match.folder}/${match.source_file}`;
    }
  }
  // Fallback: current alignment state
  const align = STATE.segmenterAlignment;
  if (align?.folder && align?.source_file) {
    return `/output/alignments/${align.folder}/${align.source_file}`;
  }
  const result = STATE.alignResult;
  if (result?.folder && result?.source_file) {
    return `/output/alignments/${result.folder}/${result.source_file}`;
  }
  return null;
}

function _scnLoadAudio() {
  scnStopAudio();
  const url = _scnGetAudioUrl();
  if (!url) {
    const btn = $('#scn-play-btn');
    if (btn) btn.style.display = 'none';
    return;
  }
  _scnAudio = new Audio(url);
  _scnAudio.addEventListener('ended', () => _scnResetPlayback());
  _scnAudio.addEventListener('error', () => {
    const btn = $('#scn-play-btn');
    if (btn) btn.style.display = 'none';
  });
}

function scnTogglePlay() {
  if (!_scnAudio) return;
  if (_scnAudio.paused) {
    _scnAudio.play().then(() => {
      _scnSetPlayIcon(false);
      $('#scn-playhead').style.opacity = '1';
      _scnAnimFrame = requestAnimationFrame(_scnTick);
    }).catch(e => console.warn('Audio play failed:', e));
  } else {
    _scnAudio.pause();
    _scnSetPlayIcon(true);
    if (_scnAnimFrame) { cancelAnimationFrame(_scnAnimFrame); _scnAnimFrame = null; }
  }
}

function _scnResetPlayback() {
  if (_scnAudio) {
    _scnAudio.pause();
    _scnAudio.currentTime = 0;
  }
  if (_scnAnimFrame) { cancelAnimationFrame(_scnAnimFrame); _scnAnimFrame = null; }
  _scnSetPlayIcon(true);
  _scnClearHighlights();
  const playhead = $('#scn-playhead');
  if (playhead) { playhead.style.left = '0%'; playhead.style.opacity = '0'; }
  const display = $('#scn-time-display');
  if (display) display.textContent = '0.00s';
  _scnActiveIdx = -1;
}

function scnStopAudio() {
  if (_scnAudio) {
    _scnAudio.pause();
    _scnAudio.currentTime = 0;
    _scnAudio = null;
  }
  if (_scnAnimFrame) { cancelAnimationFrame(_scnAnimFrame); _scnAnimFrame = null; }
  _scnSetPlayIcon(true);
  _scnClearHighlights();
  const playhead = $('#scn-playhead');
  if (playhead) playhead.style.opacity = '0';
  _scnActiveIdx = -1;
}

function scnPlayBlock(idx) {
  if (!_scnAudio) return;
  const timing = _scnSegTimings[idx];
  if (!timing) return;
  _scnAudio.currentTime = timing.start;
  _scnUpdatePlayhead();
  if (_scnAudio.paused) {
    _scnAudio.play().then(() => {
      _scnSetPlayIcon(false);
      $('#scn-playhead').style.opacity = '1';
      _scnAnimFrame = requestAnimationFrame(_scnTick);
    }).catch(e => console.warn('Audio play failed:', e));
  }
}

function scnSeekFromClick(e) {
  if (!_scnAudio) return;
  const bar = $('#scn-timeline-bar');
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const totalDuration = _scnSegTimings.length ? _scnSegTimings[_scnSegTimings.length - 1].end : _scnAudio.duration || 1;
  _scnAudio.currentTime = pct * totalDuration;
  _scnUpdatePlayhead();
  if (_scnAudio.paused) scnTogglePlay();
}

function _scnTick() {
  if (!_scnAudio || _scnAudio.paused) return;
  _scnUpdatePlayhead();
  _scnAnimFrame = requestAnimationFrame(_scnTick);
}

function _scnUpdatePlayhead() {
  if (!_scnAudio) return;
  const t = _scnAudio.currentTime;
  const totalDuration = _scnSegTimings.length ? _scnSegTimings[_scnSegTimings.length - 1].end : _scnAudio.duration || 1;
  const pct = (t / totalDuration * 100).toFixed(2);

  const playhead = $('#scn-playhead');
  if (playhead) { playhead.style.left = pct + '%'; playhead.style.opacity = '1'; }

  const display = $('#scn-time-display');
  if (display) display.textContent = t.toFixed(2) + 's';

  // Find active scene
  let activeIdx = -1;
  for (const timing of _scnSegTimings) {
    if (t >= timing.start && t < timing.end) { activeIdx = timing.sceneIdx; break; }
  }

  if (activeIdx !== _scnActiveIdx) {
    _scnClearHighlights();
    _scnActiveIdx = activeIdx;
    if (activeIdx >= 0) {
      const block = $(`.scn-timeline-block[data-scene-idx="${activeIdx}"]`);
      if (block) block.style.outline = '2px solid white';

      const card = $(`.scene-card[data-scene-idx="${activeIdx}"]`);
      if (card) {
        card.style.borderColor = 'var(--accent)';
        card.style.boxShadow = '0 0 12px rgba(78,205,196,0.3)';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

function _scnClearHighlights() {
  document.querySelectorAll('.scn-timeline-block').forEach(el => el.style.outline = '');
  document.querySelectorAll('.scene-card').forEach(el => {
    el.style.borderColor = '';
    el.style.boxShadow = '';
  });
}

function _scnSetPlayIcon(isPlay) {
  const icon = $('#scn-play-icon');
  if (!icon) return;
  icon.innerHTML = isPlay
    ? '<polygon points="5,3 19,12 5,21"/>'
    : '<rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/>';
}

// ---- Preview ----

function toggleScenesPreview() {
  const panel = $('#scenes-script-preview');
  const btn = $('#scenes-preview-btn');
  if (!STATE.scenesResult || !STATE.scenesResult.scenes) return;

  const isVisible = panel.style.display !== 'none';
  if (isVisible) {
    panel.style.display = 'none';
    btn.textContent = 'Preview Script';
    return;
  }

  // Build readable script preview
  const scenes = STATE.scenesResult.scenes;
  const lines = scenes.map((s, i) => {
    let header = `[#${i + 1}] ${esc(s.title || '')}  |  ${s.type_of_scene || 'video'}  |  ${(s.duration || 0).toFixed(1)}s`;
    if (s.narrative_role) header += `  |  ${s.narrative_role}`;

    let body = '';
    if (s.text_content) body += `  Text: "${s.text_content}"\n`;
    if (s.image_prompt) body += `  Visual: ${s.image_prompt}\n`;

    return header + '\n' + body;
  });

  $('#scenes-script-preview-content').textContent = lines.join('\n');
  panel.style.display = '';
  btn.textContent = 'Hide Preview';
}

// ---- Actions ----

function copyScenesJSON() {
  if (!STATE.scenesResult) return;
  const json = JSON.stringify(STATE.scenesResult.scenes || [], null, 2);
  navigator.clipboard.writeText(json).then(() => toast('Scenes JSON copied')).catch(() => toast('Copy failed', 'error'));
}

function downloadScenesJSON() {
  if (!STATE.scenesResult) return;
  const json = JSON.stringify(STATE.scenesResult, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (STATE.scenesResult.project_id || 'scenes') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function sendToAssets() {
  if (!STATE.scenesResult || !STATE.scenesResult.scenes) { toast('No scenes to send', 'error'); return; }
  STATE.assetsSceneData = STATE.scenesResult;
  switchPage('assets');
  renderAssetsFromScenes();
}

function sendToEditor() {
  if (!STATE.scenesResult) { toast('No scenes to send', 'error'); return; }
  localStorage.setItem('sts-editor-scenes', JSON.stringify(STATE.scenesResult));
  // Clear stale captions so they auto-regenerate from current alignment
  localStorage.removeItem('sts-editor-captions');
  switchPage('editor');
  toast('Scenes sent to editor', 'info');
}

// ---- Scenes History ----
async function loadScenesHistory() {
  try {
    const items = await api('/api/scenes/history');
    renderScenesHistory(items);
  } catch (e) { console.error('Scenes history:', e); }
}

function renderScenesHistory(items) {
  const list = $('#scenes-history-list');
  if (!items || !items.length) {
    list.innerHTML = '<p style="text-align:center;padding:32px 0;font-size:13px;color:var(--text-muted)">No scene projects yet</p>';
    $('#scenes-history-count').textContent = '0 projects';
    return;
  }
  $('#scenes-history-count').textContent = items.length + ' project' + (items.length !== 1 ? 's' : '');
  list.innerHTML = items.map(item => `
    <div class="hist-item" style="cursor:pointer" onclick="loadScenesProject('${esc(item.project_id)}')">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;color:var(--text);margin:0">${esc(item.project_id)}</p>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${item.scene_count} scenes · ${timeAgo(item.timestamp)}</p>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadScenesProject(projectId) {
  try {
    const data = await api(`/api/scenes/${projectId}`);
    STATE.scenesResult = data;
    renderSceneResults(data);
    toast('Scenes loaded');
  } catch (e) { toast(e.message, 'error'); }
}

// Init
loadScenesHistory();
scenesInitWebhookUrl();
scenesLoadTemplates();
