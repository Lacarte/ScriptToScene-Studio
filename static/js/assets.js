/* ================================================================
   ScriptToScene Studio — Assets Module (Image Generation & Management)
   Consumes scene data → manages per-scene image generation via webhook.
   ================================================================ */

// ---- Scene Type Config ----

const _ASSET_TYPES = {
  video: { color: '#4ECDC4', bg: 'rgba(78,205,196,0.12)', label: 'VIDEO' },
  image: { color: '#A78BFA', bg: 'rgba(167,139,250,0.12)', label: 'IMAGE' },
  text:  { color: '#FFB347', bg: 'rgba(255,179,71,0.12)',  label: 'TEXT' },
};

function _typeConf(type) {
  return _ASSET_TYPES[type] || _ASSET_TYPES.video;
}

// ---- Source Loading ----

function loadScenesForAssets() {
  if (!STATE.scenesResult || !STATE.scenesResult.scenes) {
    toast('No scenes available. Generate scenes first.', 'error');
    return;
  }
  STATE.assetsSceneData = STATE.scenesResult;
  renderAssetsFromScenes();
  toast(`Loaded ${STATE.scenesResult.scenes.length} scenes`);
}

async function assetsPickSceneHistory() {
  let items;
  try {
    items = await api('/api/scenes/history');
  } catch (e) {
    toast('Failed to load scene history', 'error');
    return;
  }
  if (!items || !items.length) {
    toast('No scene history. Generate scenes first.', 'error');
    return;
  }

  const modal = $('#assets-scene-picker-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  $('#assets-scene-picker-list').innerHTML = items.map(item => `
    <div class="hist-item" style="cursor:pointer" onclick="assetsSelectSceneProject('${esc(item.project_id)}')">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px">
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;color:var(--text);margin:0">${esc(item.project_id)}</p>
          <p class="font-mono" style="font-size:10px;color:var(--text-muted);margin:2px 0 0">${item.scene_count} scenes · ${timeAgo(item.timestamp)}</p>
        </div>
        ${item.source_folder ? `<span class="font-mono" style="font-size:9px;color:var(--text-muted);flex-shrink:0;background:var(--bg-darkest);padding:2px 6px;border-radius:4px">${esc(item.source_folder.length > 30 ? item.source_folder.slice(0, 30) + '...' : item.source_folder)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

async function assetsSelectSceneProject(projectId) {
  assetsCloseScenePicker();
  try {
    const data = await api(`/api/scenes/${projectId}`);
    if (!data.scenes || !data.scenes.length) throw new Error('No scenes found');
    STATE.assetsSceneData = data;
    renderAssetsFromScenes();
    toast(`Loaded ${data.scenes.length} scenes from history`);
  } catch (e) {
    toast(e.message || 'Failed to load scene project', 'error');
  }
}

function assetsCloseScenePicker() {
  const modal = $('#assets-scene-picker-modal');
  modal.classList.add('hidden');
  modal.style.display = '';
}

function importAssetsJSON() {
  $('#assets-json-input').click();
}

function handleAssetsJSONImport(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.scenes || !Array.isArray(data.scenes)) {
        toast('Invalid JSON — must contain a "scenes" array', 'error');
        return;
      }
      STATE.assetsSceneData = data;
      renderAssetsFromScenes();
      toast(`Loaded ${data.scenes.length} scenes from file`);
    } catch (err) {
      toast('Failed to parse JSON', 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ---- Main Render ----

function renderAssetsFromScenes() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) return;
  const scenes = STATE.assetsSceneData.scenes;
  const data = STATE.assetsSceneData;

  // Source label
  const pid = data.project_id ? `${data.project_id} · ` : '';
  $('#assets-source-label').textContent = `${pid}${scenes.length} scenes`;
  $('#assets-source-label').style.color = 'var(--accent)';

  // Show controls, hide empty state
  $('#assets-controls').style.display = '';
  $('#assets-empty').style.display = 'none';

  // Init statuses (keyed by scene index)
  scenes.forEach(s => {
    if (!STATE.assetStatuses[s.index]) {
      STATE.assetStatuses[s.index] = { status: 'pending', image_url: null, job_id: null, editedPrompt: null };
    }
  });

  // Render sections
  _renderAnalysisBar(data);
  _renderTypeMix(data);
  renderAssetGrid(scenes);
  updateAssetsProgress();
}

function _renderAnalysisBar(data) {
  const bar = $('#assets-analysis-bar');
  const a = data.analysis;
  if (!a) { bar.style.display = 'none'; return; }
  bar.style.display = '';

  const chips = [];
  if (a.mood) chips.push({ label: 'Mood', value: a.mood });
  if (a.environment) chips.push({ label: 'Env', value: a.environment });
  if (a.color_palette) chips.push({ label: 'Palette', value: a.color_palette });
  if (a.tone) chips.push({ label: 'Tone', value: a.tone });
  if (a.visual_style) chips.push({ label: 'Style', value: a.visual_style });

  $('#assets-analysis-chips').innerHTML = chips.map((c, i) => `
    <div style="display:flex;align-items:center;gap:5px${i > 0 ? ';padding-left:16px;border-left:1px solid var(--border)' : ''}">
      <span style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted)">${c.label}</span>
      <span style="font-size:11px;color:var(--text-secondary)">${esc(c.value)}</span>
    </div>
  `).join('');
}

function _renderTypeMix(data) {
  const mix = data.type_mix;
  const el = $('#assets-type-mix');
  if (!mix) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.style.gap = '6px';

  const entries = [];
  if (mix.video) entries.push({ type: 'video', pct: mix.video });
  if (mix.image) entries.push({ type: 'image', pct: mix.image });
  if (mix.text) entries.push({ type: 'text', pct: mix.text });

  el.innerHTML = entries.map(e => {
    const tc = _typeConf(e.type);
    return `<span class="font-mono" style="font-size:9px;padding:2px 6px;border-radius:4px;background:${tc.bg};color:${tc.color}">${tc.label} ${e.pct}</span>`;
  }).join('');
}

// ---- Asset Grid ----

function renderAssetGrid(scenes) {
  $('#assets-grid').innerHTML = scenes.map(s => _buildAssetCard(s)).join('');
}

function _buildAssetCard(scene) {
  const idx = scene.index;
  const st = STATE.assetStatuses[idx] || { status: 'pending' };
  const tc = _typeConf(scene.type_of_scene);
  const hasImage = st.status === 'ready' && st.image_url;
  const isGenerating = st.status === 'generating';
  const isError = st.status === 'error';
  const prompt = st.editedPrompt || scene.image_prompt || '';

  // Preview area content
  let previewContent;
  if (hasImage) {
    previewContent = `<img src="${esc(st.image_url)}" alt="${esc(scene.title || 'Scene ' + idx)}" style="width:100%;height:100%;object-fit:cover" />`;
  } else if (isGenerating) {
    previewContent = `
      <div style="text-align:center;color:${tc.color}">
        <div style="width:24px;height:24px;border:2px solid rgba(255,255,255,0.1);border-top-color:${tc.color};border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 8px"></div>
        <p style="font-size:10px;font-weight:500;opacity:0.8">Generating...</p>
      </div>`;
  } else if (isError) {
    previewContent = `
      <div style="text-align:center;color:var(--coral)">
        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin:0 auto 6px">
          <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
        </svg>
        <p style="font-size:10px;font-weight:500">Failed</p>
      </div>`;
  } else {
    const typeIcons = {
      video: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21"/></svg>`,
      image: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
      text:  `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/></svg>`,
    };
    previewContent = `
      <div style="text-align:center;color:var(--text-muted);opacity:0.5">
        ${typeIcons[scene.type_of_scene] || typeIcons.video}
        <p style="font-size:10px;margin-top:6px">#${idx}</p>
      </div>`;
  }

  // Status badge
  const statusLabels = { pending: 'Pending', generating: 'Generating', ready: 'Ready', error: 'Error' };
  const statusBadge = `<span class="status-badge ${st.status}">${statusLabels[st.status] || st.status}</span>`;

  // Text content display (for text-type scenes)
  const textContentHTML = scene.text_content
    ? `<div style="margin-bottom:8px;padding:8px 10px;border-radius:6px;background:${tc.bg};border:1px solid rgba(255,179,71,0.15)">
        <p style="font-size:12px;font-weight:600;color:${tc.color};margin:0;letter-spacing:0.02em">"${esc(scene.text_content)}"</p>
      </div>`
    : '';

  return `
  <div class="asset-card" id="asset-card-${idx}" style="border-left:3px solid ${tc.color}">
    <div class="asset-preview" style="height:180px;display:flex;align-items:center;justify-content:center;position:relative">
      ${previewContent}
      ${statusBadge}
    </div>
    <div style="padding:14px">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span class="font-mono" style="font-size:10px;color:var(--text-muted);flex-shrink:0">#${idx}</span>
          <span style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(scene.title || '')}</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <span class="font-mono" style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:4px;background:${tc.bg};color:${tc.color};text-transform:uppercase;letter-spacing:0.05em">${tc.label}</span>
          ${scene.narrative_role ? `<span class="font-mono" style="font-size:8px;padding:2px 6px;border-radius:4px;background:var(--bg-darkest);color:var(--text-muted);letter-spacing:0.03em">${esc(scene.narrative_role)}</span>` : ''}
          <span class="font-mono" style="font-size:9px;color:var(--text-muted)">${(scene.duration || 0).toFixed(1)}s</span>
        </div>
      </div>

      ${textContentHTML}

      <!-- Prompt (view/edit) -->
      <div id="asset-prompt-wrap-${idx}">
        <div id="asset-prompt-view-${idx}" style="display:flex;gap:6px;align-items:flex-start">
          <p style="flex:1;font-size:11px;color:var(--text-secondary);line-height:1.5;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(prompt)}</p>
          <button onclick="assetsEditPrompt(${idx})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;flex-shrink:0;opacity:0.5;transition:opacity 0.2s" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'" title="Edit prompt">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
        <div id="asset-prompt-edit-${idx}" style="display:none">
          <textarea id="asset-prompt-input-${idx}" class="input-field" style="width:100%;padding:8px 10px;font-size:11px;line-height:1.5;resize:vertical;font-family:inherit;min-height:60px" rows="3">${esc(prompt)}</textarea>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button onclick="assetsSavePrompt(${idx})" class="action-btn hover-accent" style="font-size:10px">Save</button>
            <button onclick="assetsCancelPromptEdit(${idx})" class="action-btn" style="font-size:10px;color:var(--text-muted)">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:6px;margin-top:10px">
        <button onclick="generateSingleImage(${idx})" class="action-btn hover-accent" ${isGenerating ? 'disabled style="opacity:0.5"' : ''}>
          ${isGenerating ? 'Generating...' : st.status === 'ready' ? 'Regenerate' : 'Generate'}
        </button>
        <button onclick="downloadAssetImage(${idx})" class="action-btn hover-accent" ${hasImage ? '' : 'disabled style="opacity:0.4"'}>Download</button>
      </div>
    </div>
  </div>`;
}

// ---- Single Card Update ----

function updateAssetCard(sceneIndex) {
  if (!STATE.assetsSceneData) return;
  const scene = STATE.assetsSceneData.scenes.find(s => s.index === sceneIndex);
  if (!scene) return;
  const el = document.getElementById(`asset-card-${sceneIndex}`);
  if (el) {
    el.outerHTML = _buildAssetCard(scene);
  }
}

// ---- Progress ----

function updateAssetsProgress() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) return;
  const scenes = STATE.assetsSceneData.scenes;
  const total = scenes.length;
  const ready = scenes.filter(s => STATE.assetStatuses[s.index]?.status === 'ready').length;
  const generating = scenes.filter(s => STATE.assetStatuses[s.index]?.status === 'generating').length;

  let text = `${ready} / ${total} complete`;
  if (generating > 0) text += ` · ${generating} generating`;
  $('#assets-progress').textContent = text;

  // Progress bar
  const barWrap = $('#assets-progress-bar-wrap');
  if (ready > 0 || generating > 0) {
    barWrap.style.display = '';
    const pct = total > 0 ? (ready / total) * 100 : 0;
    $('#assets-progress-bar').style.width = pct + '%';
  } else {
    barWrap.style.display = 'none';
  }
}

// ---- Prompt Editing ----

function assetsEditPrompt(sceneIndex) {
  $(`#asset-prompt-view-${sceneIndex}`).style.display = 'none';
  $(`#asset-prompt-edit-${sceneIndex}`).style.display = '';
  const input = $(`#asset-prompt-input-${sceneIndex}`);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function assetsSavePrompt(sceneIndex) {
  const input = $(`#asset-prompt-input-${sceneIndex}`);
  const newPrompt = input.value.trim();
  if (!newPrompt) {
    toast('Prompt cannot be empty', 'error');
    return;
  }
  if (!STATE.assetStatuses[sceneIndex]) {
    STATE.assetStatuses[sceneIndex] = { status: 'pending', image_url: null, job_id: null, editedPrompt: null };
  }
  STATE.assetStatuses[sceneIndex].editedPrompt = newPrompt;

  // Update view mode
  $(`#asset-prompt-view-${sceneIndex}`).style.display = 'flex';
  $(`#asset-prompt-edit-${sceneIndex}`).style.display = 'none';
  const viewP = $(`#asset-prompt-view-${sceneIndex} p`);
  if (viewP) viewP.textContent = newPrompt;
  toast('Prompt updated');
}

function assetsCancelPromptEdit(sceneIndex) {
  $(`#asset-prompt-view-${sceneIndex}`).style.display = 'flex';
  $(`#asset-prompt-edit-${sceneIndex}`).style.display = 'none';
  // Reset textarea to current prompt
  const scene = STATE.assetsSceneData?.scenes?.find(s => s.index === sceneIndex);
  const currentPrompt = STATE.assetStatuses[sceneIndex]?.editedPrompt || scene?.image_prompt || '';
  $(`#asset-prompt-input-${sceneIndex}`).value = currentPrompt;
}

// ---- Generation ----

async function generateSingleImage(sceneIndex) {
  if (!STATE.assetsSceneData) return;
  const scene = STATE.assetsSceneData.scenes.find(s => s.index === sceneIndex);
  if (!scene) return;

  const prompt = STATE.assetStatuses[sceneIndex]?.editedPrompt || scene.image_prompt;
  if (!prompt) {
    toast('No prompt available for this scene', 'error');
    return;
  }

  STATE.assetStatuses[sceneIndex] = {
    ...STATE.assetStatuses[sceneIndex],
    status: 'generating',
    image_url: null,
    job_id: null,
  };
  updateAssetCard(sceneIndex);
  updateAssetsProgress();

  try {
    const payload = {
      scene_id: sceneIndex,
      prompt: prompt,
      provider: $('#assets-provider').value,
      project_id: STATE.assetsSceneData.project_id || 'default',
    };

    // Include webhook URL override if configured
    const webhookUrl = $('#assets-webhook-url').value.trim();
    if (webhookUrl) payload.webhook_url = webhookUrl;

    const res = await fetch('/api/assets/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    STATE.assetStatuses[sceneIndex].job_id = data.job_id;
    pollImageStatus(sceneIndex, data.job_id);
  } catch (e) {
    STATE.assetStatuses[sceneIndex].status = 'error';
    updateAssetCard(sceneIndex);
    updateAssetsProgress();
    toast(`Scene #${sceneIndex}: ${e.message}`, 'error');
  }
}

async function pollImageStatus(sceneIndex, jobId) {
  const poll = async () => {
    try {
      const res = await fetch(`/api/assets/status/${jobId}`);
      const data = await res.json();
      if (data.status === 'ready') {
        STATE.assetStatuses[sceneIndex] = {
          ...STATE.assetStatuses[sceneIndex],
          status: 'ready',
          image_url: data.image_url,
          job_id: jobId,
        };
        updateAssetCard(sceneIndex);
        updateAssetsProgress();
        toast(`Scene #${sceneIndex} image ready`);
      } else if (data.status === 'error') {
        STATE.assetStatuses[sceneIndex].status = 'error';
        updateAssetCard(sceneIndex);
        updateAssetsProgress();
        toast(`Scene #${sceneIndex} generation failed`, 'error');
      } else {
        setTimeout(poll, 3000);
      }
    } catch (e) {
      STATE.assetStatuses[sceneIndex].status = 'error';
      updateAssetCard(sceneIndex);
      updateAssetsProgress();
    }
  };
  poll();
}

async function generateAllImages() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) {
    toast('No scenes loaded', 'error');
    return;
  }
  const scenes = STATE.assetsSceneData.scenes;
  for (const s of scenes) {
    const st = STATE.assetStatuses[s.index];
    if (st?.status !== 'ready' && st?.status !== 'generating') {
      await generateSingleImage(s.index);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// ---- Download ----

function downloadAssetImage(sceneIndex) {
  const st = STATE.assetStatuses[sceneIndex];
  if (!st || !st.image_url) return;
  const a = document.createElement('a');
  a.href = st.image_url;
  a.download = `scene_${sceneIndex}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}

function downloadAllAssets() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) return;
  const readyScenes = STATE.assetsSceneData.scenes.filter(s =>
    STATE.assetStatuses[s.index]?.status === 'ready' && STATE.assetStatuses[s.index]?.image_url
  );
  if (!readyScenes.length) {
    toast('No images ready for download', 'error');
    return;
  }
  readyScenes.forEach((s, i) => {
    setTimeout(() => downloadAssetImage(s.index), i * 200);
  });
  toast(`Downloading ${readyScenes.length} images`);
}

// ---- Webhook Config ----

async function assetsInitWebhookUrl() {
  try {
    const data = await api('/api/assets/webhook-url');
    STATE._assetsDefaultWebhookUrl = data.url || '';
  } catch (e) {
    STATE._assetsDefaultWebhookUrl = '';
  }
  const saved = localStorage.getItem('sts-assets-webhook-url');
  $('#assets-webhook-url').value = saved !== null ? saved : STATE._assetsDefaultWebhookUrl;
}

function assetsResetWebhookUrl() {
  $('#assets-webhook-url').value = STATE._assetsDefaultWebhookUrl || '';
  localStorage.removeItem('sts-assets-webhook-url');
  toast('Webhook URL reset to default');
}

// ---- Init ----
assetsInitWebhookUrl();
