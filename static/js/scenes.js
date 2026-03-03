/* ================================================================
   ScriptToScene Studio — Scenes Module (AI Scene Script Generator)
   Consumes segmenter output → builds n8n webhook payload → renders results.
   ================================================================ */

// ---- State ----
// STATE.scenesSegData  — full segmenter result (metadata + segments)
// STATE.scenesResult   — generated scenes from webhook

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

// ---- Webhook Payload Builder ----

function _buildWebhookPayload(segData) {
  const meta = segData.metadata || {};
  const segments = (segData.segments || [])
    .filter(s => !s.is_filler)
    .map(s => ({ index: s.index, words: s.words }));

  return {
    script: meta.transcript || '',
    style: $('#scenes-style').value || meta.style || 'cinematic',
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
  $('#scenes-results').style.display = '';
  const scenes = data.scenes || [];
  const totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 0), 0);
  const pid = data.project_id ? `${data.project_id} · ` : '';
  $('#scenes-stats').textContent = `${pid}${scenes.length} scenes · ${totalDuration.toFixed(1)}s total`;

  const typeColors = { video: '#4ECDC4', image: '#A78BFA', text: '#FFB347' };
  const typeBg = { video: 'rgba(78,205,196,0.1)', image: 'rgba(167,139,250,0.1)', text: 'rgba(255,179,71,0.1)' };

  $('#scenes-list').innerHTML = scenes.map((s, i) => {
    const tc = typeColors[s.type_of_scene] || '#6b7f93';
    const tb = typeBg[s.type_of_scene] || 'rgba(107,127,147,0.1)';
    return `
    <div class="scene-card" style="border-left-color:${tc}">
      <div class="flex items-center justify-between mb-2">
        <span class="font-mono text-xs" style="color:${tc}">#${i + 1} &middot; ${esc(s.title || '')}</span>
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
