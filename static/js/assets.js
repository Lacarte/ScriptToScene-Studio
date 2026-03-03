/* ================================================================
   ScriptToScene Studio — Assets Module (Automa Grabber)
   Consumes scene data → sends prompts to Automa → polls for results.
   ================================================================ */

// ---- Scene Type Config ----

const _ASSET_TYPES = {
  video: { color: '#4ECDC4', bg: 'rgba(78,205,196,0.12)', label: 'VIDEO' },
  image: { color: '#A78BFA', bg: 'rgba(167,139,250,0.12)', label: 'IMAGE' },
  text:  { color: '#FFB347', bg: 'rgba(255,179,71,0.12)',  label: 'TEXT' },
};

const _PROVIDER_URLS = {
  midjourney: 'https://www.midjourney.com/imagine',
  'meta-ai': 'https://www.meta.ai/media',
};

function _typeConf(type) {
  return _ASSET_TYPES[type] || _ASSET_TYPES.video;
}

// ---- Grabber polling state ----
let _grabberPollTimer = null;

// ---- Source Loading ----

function loadScenesForAssets() {
  if (!STATE.scenesResult || !STATE.scenesResult.scenes) {
    toast('No scenes available. Generate scenes first.', 'error');
    return;
  }
  STATE.assetsSceneData = STATE.scenesResult;
  STATE.assetStatuses = {};  // Clear stale statuses from previous project
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
    STATE.assetStatuses = {};  // Clear stale statuses from previous project
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
      STATE.assetStatuses = {};  // Clear stale statuses from previous project
      renderAssetsFromScenes();
      toast(`Loaded ${data.scenes.length} scenes from file`);
    } catch (err) {
      toast('Failed to parse JSON', 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ---- Provider toggle ----

function assetsProviderChanged() {
  const provider = $('#assets-provider').value;
  const argsWrap = $('#assets-args-wrap');
  argsWrap.style.display = provider === 'midjourney' ? '' : 'none';
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
      STATE.assetStatuses[s.index] = { status: 'pending', urls: [], local_files: [], editedPrompt: null };
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
  const files = st.local_files || [];
  const hasImage = st.status === 'ready' && files.length > 0;
  const isDownloading = st.status === 'downloading';
  const isError = st.status === 'error';
  const prompt = st.editedPrompt || scene.image_prompt || '';

  // Preview area — show gallery thumbnails when multiple files
  let previewContent;
  if (hasImage) {
    if (files.length === 1) {
      previewContent = `
        <img src="${esc(files[0])}" alt="Scene ${idx}" style="width:100%;height:100%;object-fit:cover;cursor:pointer" onclick="assetsOpenLightbox(${idx},0)" />`;
    } else {
      // Multi-image grid (2x2 for 4, 1x2/1x3 for 2-3)
      const thumbs = files.slice(0, 4).map((f, i) => `
        <div style="overflow:hidden;cursor:pointer;position:relative" onclick="assetsOpenLightbox(${idx},${i})">
          <img src="${esc(f)}" alt="Scene ${idx} #${i}" style="width:100%;height:100%;object-fit:cover;display:block;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform=''" />
        </div>`).join('');

      const cols = Math.min(files.length, 2);
      const rowCount = files.length <= 2 ? 1 : 2;
      previewContent = `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rowCount},1fr);gap:2px;height:100%">${thumbs}</div>`;
      if (files.length > 4) {
        previewContent += `<span style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.75);color:white;font-size:9px;padding:2px 8px;border-radius:4px;font-family:'JetBrains Mono',monospace;pointer-events:none">+${files.length - 4} more</span>`;
      }
    }
    previewContent += `<span style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);color:white;font-size:9px;padding:2px 6px;border-radius:4px;font-family:'JetBrains Mono',monospace;pointer-events:none">${files.length} file${files.length > 1 ? 's' : ''}</span>`;
  } else if (isDownloading) {
    previewContent = `
      <div style="text-align:center;color:${tc.color}">
        <div style="width:24px;height:24px;border:2px solid rgba(255,255,255,0.1);border-top-color:${tc.color};border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 8px"></div>
        <p style="font-size:10px;font-weight:500;opacity:0.8">Downloading...</p>
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

  // Status badge — hide when ready with files (file count badge is enough)
  const statusLabels = { pending: 'Pending', downloading: 'Downloading', ready: 'Ready', error: 'Error' };
  const statusBadge = hasImage
    ? ''
    : `<span class="status-badge ${st.status === 'downloading' ? 'generating' : st.status}">${statusLabels[st.status] || st.status}</span>`;

  // Text content display (for text-type scenes)
  const textContentHTML = scene.text_content
    ? `<div style="margin-bottom:8px;padding:8px 10px;border-radius:6px;background:${tc.bg};border:1px solid rgba(255,179,71,0.15)">
        <p style="font-size:12px;font-weight:600;color:${tc.color};margin:0;letter-spacing:0.02em">"${esc(scene.text_content)}"</p>
      </div>`
    : '';

  return `
  <div class="asset-card" id="asset-card-${idx}" style="border-left:3px solid ${tc.color}">
    <div class="asset-preview" style="height:180px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
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
        <button onclick="downloadAssetImage(${idx})" class="action-btn hover-accent" ${hasImage ? '' : 'disabled style="opacity:0.4"'}>${hasImage ? `Download (${files.length})` : 'Download'}</button>
      </div>
    </div>
  </div>`;
}

// ---- Lightbox for viewing full-size images ----

function assetsOpenLightbox(sceneIndex, fileIndex) {
  const st = STATE.assetStatuses[sceneIndex];
  if (!st || !st.local_files || !st.local_files.length) return;
  const files = st.local_files;

  // Remove existing lightbox
  const existing = document.getElementById('assets-lightbox');
  if (existing) existing.remove();

  let currentIdx = fileIndex;

  const overlay = document.createElement('div');
  overlay.id = 'assets-lightbox';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;backdrop-filter:blur(10px)';

  function render() {
    overlay.innerHTML = `
      <div style="position:absolute;top:16px;right:16px;display:flex;gap:8px;z-index:10">
        <span class="font-mono" style="font-size:11px;color:rgba(255,255,255,0.5);padding:6px 12px;background:rgba(255,255,255,0.08);border-radius:6px">Scene #${sceneIndex} · ${currentIdx + 1}/${files.length}</span>
        <button onclick="document.getElementById('assets-lightbox').remove()" style="background:rgba(255,255,255,0.1);border:none;color:white;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">&times;</button>
      </div>
      <img src="${esc(files[currentIdx])}" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5)" />
      ${files.length > 1 ? `
        <div style="display:flex;gap:8px;margin-top:16px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.05)">
          ${files.map((f, i) => `
            <div onclick="event.stopPropagation();document.getElementById('assets-lightbox')._goto(${i})" style="width:56px;height:56px;border-radius:6px;overflow:hidden;cursor:pointer;border:2px solid ${i === currentIdx ? 'var(--accent)' : 'transparent'};opacity:${i === currentIdx ? '1' : '0.6'};transition:all 0.2s">
              <img src="${esc(f)}" style="width:100%;height:100%;object-fit:cover" />
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  }

  overlay._goto = (i) => { currentIdx = i; render(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Keyboard nav
  const onKey = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'ArrowRight' && currentIdx < files.length - 1) { currentIdx++; render(); }
    if (e.key === 'ArrowLeft' && currentIdx > 0) { currentIdx--; render(); }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', onKey));

  render();
  document.body.appendChild(overlay);
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
  const downloading = scenes.filter(s => STATE.assetStatuses[s.index]?.status === 'downloading').length;
  const totalFiles = scenes.reduce((sum, s) => sum + (STATE.assetStatuses[s.index]?.local_files?.length || 0), 0);

  let text = `${ready} / ${total} complete`;
  if (totalFiles > 0) text += ` · ${totalFiles} files`;
  if (downloading > 0) text += ` · ${downloading} downloading`;
  $('#assets-progress').textContent = text;

  // Progress bar
  const barWrap = $('#assets-progress-bar-wrap');
  if (ready > 0 || downloading > 0) {
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
    STATE.assetStatuses[sceneIndex] = { status: 'pending', urls: [], local_files: [], editedPrompt: null };
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
  const scene = STATE.assetsSceneData?.scenes?.find(s => s.index === sceneIndex);
  const currentPrompt = STATE.assetStatuses[sceneIndex]?.editedPrompt || scene?.image_prompt || '';
  $(`#asset-prompt-input-${sceneIndex}`).value = currentPrompt;
}

// ---- Assets Grabber ----

async function assetsStartGrabber() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) {
    toast('No scenes loaded', 'error');
    return;
  }

  const scenes = STATE.assetsSceneData.scenes;
  const provider = $('#assets-provider').value;
  const arguments_ = provider === 'midjourney' ? ($('#assets-arguments').value || '-v 7 -ar 9:16') : '';
  const projectId = STATE.assetsSceneData.project_id || 'default';

  // Build scenes payload (respect edited prompts)
  const scenesPayload = scenes
    .filter(s => s.image_prompt || STATE.assetStatuses[s.index]?.editedPrompt)
    .map(s => ({
      prompt: STATE.assetStatuses[s.index]?.editedPrompt || s.image_prompt,
      scene: s.index,
    }));

  if (!scenesPayload.length) {
    toast('No prompts available', 'error');
    return;
  }

  // Disable button
  const btn = $('#assets-grabber-btn');
  btn.disabled = true;
  btn.style.opacity = '0.6';

  _setGrabberStatus('Initializing grabber job...');

  try {
    const res = await fetch('/api/assets/grabber/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        provider: provider,
        arguments: arguments_,
        scenes: scenesPayload,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start grabber');

    // Mark all scenes as pending
    scenesPayload.forEach(s => {
      if (STATE.assetStatuses[s.scene]) {
        STATE.assetStatuses[s.scene].status = 'pending';
      }
    });
    renderAssetGrid(scenes);
    updateAssetsProgress();

    // Open provider tab (reuse existing tab if already open)
    const providerUrl = _PROVIDER_URLS[provider] || _PROVIDER_URLS.midjourney;
    window.open(providerUrl, 'sts-provider-tab');

    _setGrabberStatus(`Prompts ready (${data.scene_count} scenes) — activate Automa in the ${provider === 'midjourney' ? 'Midjourney' : 'Meta AI'} tab to start`);
    toast(`Grabber ready — ${data.scene_count} prompts queued. Activate Automa to begin.`);

    // Start polling for results
    _startGrabberPolling(projectId);
  } catch (e) {
    toast(e.message || 'Grabber failed', 'error');
    _setGrabberStatus('');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
  }
}

function _setGrabberStatus(text) {
  const el = $('#assets-grabber-status');
  const textEl = $('#assets-grabber-status-text');
  if (text) {
    el.style.display = '';
    textEl.textContent = text;
  } else {
    el.style.display = 'none';
  }
}

function _startGrabberPolling(projectId) {
  if (_grabberPollTimer) clearInterval(_grabberPollTimer);

  _grabberPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/assets/grabber/status/${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = await res.json();

      // Update per-scene statuses
      const sceneStatuses = data.scene_statuses || {};
      let anyChange = false;

      for (const [sceneNum, ss] of Object.entries(sceneStatuses)) {
        const idx = parseInt(sceneNum);
        if (!STATE.assetStatuses[idx]) continue;
        const prev = STATE.assetStatuses[idx].status;

        const filesChanged = (ss.local_files?.length || 0) !== (STATE.assetStatuses[idx].local_files?.length || 0);
        if (ss.status !== prev || filesChanged) {
          STATE.assetStatuses[idx].status = ss.status;
          STATE.assetStatuses[idx].local_files = ss.local_files || [];
          STATE.assetStatuses[idx].urls = ss.urls || [];
          updateAssetCard(idx);
          anyChange = true;

          if (ss.status === 'ready' && prev !== 'ready') {
            toast(`Scene #${sceneNum} — ${ss.local_files.length} file(s) downloaded`);
          }
        }
      }

      if (anyChange) updateAssetsProgress();

      // Update status message
      const statusMap = { waiting: 'Waiting for Automa...', grabbing: 'Automa is submitting prompts...', downloading: 'Downloading images...', done: 'All assets downloaded!', error: 'Grabber encountered errors' };
      _setGrabberStatus(statusMap[data.status] || data.status);

      // Stop polling when done
      if (data.status === 'done' || data.status === 'error') {
        clearInterval(_grabberPollTimer);
        _grabberPollTimer = null;
        loadAssetsHistory(); // refresh history
      }
    } catch (e) {
      // Network error — keep polling
    }
  }, 5000);
}

// ---- Re-download (retry failed/pending scenes) ----

async function assetsRedownload() {
  const projectId = STATE.assetsSceneData?.project_id;
  if (!projectId) {
    toast('No project loaded', 'error');
    return;
  }

  const btn = $('#assets-redownload-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying...'; }

  try {
    const res = await fetch(`/api/assets/redownload/${encodeURIComponent(projectId)}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Retry failed');

    if (data.status === 'nothing_to_retry') {
      toast('All scenes already downloaded');
    } else {
      toast(`Retrying ${data.scenes_retrying} scene(s)...`);
      _startGrabberPolling(projectId);
    }
  } catch (e) {
    toast(e.message || 'Retry failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Retry Downloads'; }
  }
}

// ---- Download ----

function downloadAssetImage(sceneIndex) {
  const st = STATE.assetStatuses[sceneIndex];
  if (!st || !st.local_files || !st.local_files.length) return;
  st.local_files.forEach((url, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = url;
      a.download = url.split('/').pop();
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 200);
  });
}

function downloadAllAssets() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) return;
  const readyScenes = STATE.assetsSceneData.scenes.filter(s =>
    STATE.assetStatuses[s.index]?.status === 'ready' && STATE.assetStatuses[s.index]?.local_files?.length
  );
  if (!readyScenes.length) {
    toast('No images ready for download', 'error');
    return;
  }
  let delay = 0;
  readyScenes.forEach(s => {
    const files = STATE.assetStatuses[s.index].local_files;
    files.forEach(url => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = url.split('/').pop();
        document.body.appendChild(a); a.click(); a.remove();
      }, delay);
      delay += 200;
    });
  });
  toast(`Downloading assets from ${readyScenes.length} scenes`);
}

// ---- Assets History ----

async function loadAssetsHistory() {
  const container = $('#assets-history-list');
  if (!container) return;

  try {
    const projects = await api('/api/assets/history');
    if (!projects || !projects.length) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-muted);font-size:12px;padding:20px 0">No asset projects yet</p>`;
      return;
    }

    container.innerHTML = projects.map(p => {
      const statusColors = { done: '#4ECDC4', downloading: '#FFB347', error: '#FF6B6B', waiting: '#8B8B8B', grabbing: '#A78BFA' };
      const statusColor = statusColors[p.status] || '#8B8B8B';
      const statusLabel = p.status || 'unknown';
      const sceneCount = p.scene_count || 0;
      const readyCount = p.ready_count || 0;
      const diskFiles = p.disk_files || 0;
      const time = p.created_at ? timeAgo(p.created_at) : timeAgo(p.timestamp);

      return `
      <div class="hist-item" style="cursor:pointer;transition:background 0.15s" onclick="assetsLoadFromHistory('${esc(p.project_id)}')" onmouseover="this.style.background='var(--bg-darkest)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px">
          ${p.preview
            ? `<div style="width:48px;height:48px;border-radius:6px;overflow:hidden;flex-shrink:0;border:1px solid var(--border)"><img src="${esc(p.preview)}" style="width:100%;height:100%;object-fit:cover" /></div>`
            : `<div style="width:48px;height:48px;border-radius:6px;flex-shrink:0;background:var(--bg-darkest);display:flex;align-items:center;justify-content:center">
                <svg width="20" height="20" fill="none" stroke="var(--text-muted)" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:0.4"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              </div>`
          }
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
              <span style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.project_id)}</span>
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
              <span class="font-mono" style="font-size:9px;color:${statusColor};text-transform:uppercase;letter-spacing:0.05em">${esc(statusLabel)}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="font-mono" style="font-size:10px;color:var(--text-muted)">${sceneCount} scene${sceneCount !== 1 ? 's' : ''}</span>
              ${readyCount > 0 ? `<span class="font-mono" style="font-size:10px;color:#4ECDC4">${readyCount} ready</span>` : ''}
              ${diskFiles > 0 ? `<span class="font-mono" style="font-size:10px;color:var(--text-secondary)">${diskFiles} files</span>` : ''}
              <span class="font-mono" style="font-size:9px;color:var(--text-muted);opacity:0.7">${time}</span>
              ${p.provider ? `<span class="font-mono" style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(167,139,250,0.1);color:#A78BFA">${esc(p.provider)}</span>` : ''}
            </div>
          </div>
          <svg width="16" height="16" fill="none" stroke="var(--text-muted)" stroke-width="1.5" viewBox="0 0 24 24" style="flex-shrink:0;opacity:0.4"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<p style="text-align:center;color:var(--coral);font-size:11px;padding:16px">Failed to load history</p>`;
  }
}

async function assetsLoadFromHistory(projectId) {
  try {
    const data = await api(`/api/assets/project/${encodeURIComponent(projectId)}`);
    if (!data) throw new Error('No data returned');

    // Load corresponding scene data if available
    let sceneData = null;
    try {
      sceneData = await api(`/api/scenes/${encodeURIComponent(projectId)}`);
    } catch (e) {
      // Scene data might not exist — that's fine
    }

    if (sceneData && sceneData.scenes && sceneData.scenes.length) {
      STATE.assetsSceneData = sceneData;
    } else {
      // Build minimal scene data from the asset project
      const scenes = [];
      const prompts = data.prompts || {};
      for (const [sceneNum, sceneInfo] of Object.entries(data.scenes)) {
        scenes.push({
          index: parseInt(sceneNum),
          title: `Scene ${sceneNum}`,
          type_of_scene: 'image',
          image_prompt: prompts[sceneNum] || '',
          duration: 3,
          text_content: null,
        });
      }
      scenes.sort((a, b) => a.index - b.index);
      STATE.assetsSceneData = { project_id: projectId, scenes };
    }

    // Populate asset statuses from the project data
    STATE.assetStatuses = {};
    for (const [sceneNum, sceneInfo] of Object.entries(data.scenes)) {
      const idx = parseInt(sceneNum);
      const localFiles = sceneInfo.files_on_disk
        ? sceneInfo.files_on_disk.map(f => f.url)
        : sceneInfo.local_files || [];
      const ss = data.scene_statuses?.[sceneNum];

      STATE.assetStatuses[idx] = {
        status: localFiles.length > 0 ? 'ready' : (ss?.status || 'pending'),
        urls: sceneInfo.source_urls || ss?.urls || [],
        local_files: localFiles,
        editedPrompt: null,
      };
    }

    renderAssetsFromScenes();
    toast(`Loaded project ${projectId} (${Object.keys(data.scenes).length} scenes)`);
  } catch (e) {
    toast(e.message || 'Failed to load project', 'error');
  }
}
