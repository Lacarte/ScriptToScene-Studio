/* ================================================================
   ScriptToScene Studio — Scenes Module (AI Scene Script Generator)
   ================================================================ */

function useCurrentAlignmentForScenes() {
  if (!STATE.alignResult || !STATE.alignResult.alignment) {
    toast('No alignment result available. Run alignment in TIMING first.', 'error');
    return;
  }
  STATE.scenesAlignment = STATE.alignResult;
  const wordCount = STATE.alignResult.alignment.length;
  const duration = wordCount ? STATE.alignResult.alignment[wordCount - 1].end : 0;
  $('#scenes-source-info').textContent = `${wordCount} words · ${duration.toFixed(1)}s from ${STATE.alignResult.folder || 'current result'}`;
  $('#scenes-source-info').style.color = 'var(--accent)';
  $('#scenes-json-preview').style.display = '';
  $('#scenes-json-preview').textContent = JSON.stringify(STATE.alignResult.alignment.slice(0, 5), null, 2) + (wordCount > 5 ? '\n... (' + (wordCount - 5) + ' more words)' : '');
  toast('Alignment loaded');
}

function pickHistoryForScenes() {
  if (!STATE.alignHistory.length) {
    toast('No alignment history. Run alignment first.', 'error');
    return;
  }
  const modal = $('#history-picker-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  $('#history-picker-list').innerHTML = STATE.alignHistory.map((h, i) => {
    const text = h.transcript || '';
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    return `
    <div class="hist-item" style="cursor:pointer" onclick="selectHistoryForScenes(${i})">
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

function selectHistoryForScenes(idx) {
  const h = STATE.alignHistory[idx];
  if (!h) return;
  STATE.scenesAlignment = { folder: h.folder, alignment: h.word_alignment, transcript: h.transcript };
  const wordCount = h.word_count || (h.word_alignment ? h.word_alignment.length : 0);
  $('#scenes-source-info').textContent = `${wordCount} words · ${h.duration_seconds}s from ${h.source_file || h.folder}`;
  $('#scenes-source-info').style.color = 'var(--accent)';
  $('#scenes-json-preview').style.display = '';
  const alignment = h.word_alignment || [];
  $('#scenes-json-preview').textContent = JSON.stringify(alignment.slice(0, 5), null, 2) + (alignment.length > 5 ? '\n... (' + (alignment.length - 5) + ' more words)' : '');
  closeHistoryPicker();
  toast('Alignment loaded from history');
}

function closeHistoryPicker() {
  const modal = $('#history-picker-modal');
  modal.classList.add('hidden');
  modal.style.display = '';
}

async function handleGenerateScenes() {
  if (!STATE.scenesAlignment || !STATE.scenesAlignment.alignment) {
    toast('Select an alignment source first', 'error');
    return;
  }
  const btn = $('#scenes-generate-btn');
  btn.disabled = true;
  $('#scenes-btn-label').textContent = 'Generating...';
  $('#scenes-btn-spinner').style.display = 'inline-block';
  $('#scenes-results').style.display = 'none';

  try {
    const payload = {
      alignment: STATE.scenesAlignment.alignment,
      transcript: STATE.scenesAlignment.transcript || '',
      source_folder: STATE.scenesAlignment.folder || '',
      style: $('#scenes-style').value,
      aspect_ratio: $('#scenes-aspect').value,
    };
    const res = await fetch('/api/scenes/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scene generation failed');

    STATE.scenesResult = data;
    renderSceneResults(data);
    toast('Scene script generated');
    loadScenesHistory();
  } catch (e) {
    toast(e.message || 'Scene generation failed', 'error');
  } finally {
    btn.disabled = false;
    $('#scenes-btn-label').textContent = 'Generate Scene Script';
    $('#scenes-btn-spinner').style.display = 'none';
  }
}

function renderSceneResults(data) {
  $('#scenes-results').style.display = '';
  const scenes = data.scenes || [];
  const totalDuration = scenes.length ? scenes[scenes.length - 1].end : 0;
  $('#scenes-stats').textContent = `${scenes.length} scenes · ${totalDuration.toFixed(1)}s total`;

  $('#scenes-list').innerHTML = scenes.map(s => `
    <div class="scene-card">
      <div class="flex items-center justify-between mb-2">
        <span class="font-mono text-xs" style="color:var(--accent)">Scene ${s.scene_id} &middot; ${(s.start || 0).toFixed(2)}s - ${(s.end || 0).toFixed(2)}s</span>
        <div style="display:flex;gap:6px;align-items:center">
          ${s.emotion ? `<span class="font-mono text-xs" style="padding:2px 8px;border-radius:4px;background:rgba(167,139,250,0.1);color:#A78BFA">${esc(s.emotion)}</span>` : ''}
          ${s.intensity_level !== undefined ? `<span class="font-mono text-xs" style="padding:2px 6px;border-radius:4px;background:rgba(78,205,196,0.1);color:var(--accent)">L${s.intensity_level}</span>` : ''}
        </div>
      </div>
      <p style="font-size:13px;color:var(--text);margin-bottom:8px;line-height:1.5">${esc(s.text_fragment)}</p>
      <p style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;font-style:italic;line-height:1.5">${esc(s.visual_prompt)}</p>
      <div class="flex gap-3" style="font-size:10px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">
        ${s.camera_motion ? `<span>Camera: ${esc(s.camera_motion)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

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
