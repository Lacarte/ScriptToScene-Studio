/* ================================================================
   ScriptToScene Studio — Assets Module (Image Generation & Management)
   ================================================================ */

function loadScenesForAssets() {
  if (!STATE.scenesResult || !STATE.scenesResult.scenes) {
    toast('No scenes available. Generate scenes first.', 'error');
    return;
  }
  STATE.assetsSceneData = STATE.scenesResult;
  renderAssetsFromScenes();
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

function renderAssetsFromScenes() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) return;
  const scenes = STATE.assetsSceneData.scenes;
  $('#assets-source-label').textContent = `${scenes.length} scenes loaded from ${STATE.assetsSceneData.project_id || 'imported data'}`;
  $('#assets-source-label').style.color = 'var(--accent)';
  $('#assets-empty').style.display = 'none';

  scenes.forEach(s => {
    if (!STATE.assetStatuses[s.scene_id]) {
      STATE.assetStatuses[s.scene_id] = { status: 'pending', image_url: null, job_id: null };
    }
  });

  renderAssetGrid(scenes);
  updateAssetsProgress();
}

function renderAssetGrid(scenes) {
  const grid = $('#assets-grid');
  grid.innerHTML = scenes.map(s => {
    const st = STATE.assetStatuses[s.scene_id] || { status: 'pending' };
    const hasImage = st.status === 'ready' && st.image_url;
    return `
    <div class="asset-card" id="asset-card-${s.scene_id}">
      <div class="asset-preview">
        ${hasImage
          ? `<img src="${esc(st.image_url)}" alt="Scene ${s.scene_id}" />`
          : `<div style="text-align:center;color:var(--text-muted);font-size:11px">
              <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 6px;opacity:0.4">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
              Scene ${s.scene_id}
            </div>`
        }
        <span class="status-badge ${st.status}">${st.status === 'generating' ? 'Generating...' : st.status}</span>
      </div>
      <div style="padding:12px">
        <p style="font-size:10px;color:var(--accent);font-family:'JetBrains Mono',monospace;margin-bottom:4px">${(s.start || 0).toFixed(2)}s - ${(s.end || 0).toFixed(2)}s</p>
        <p style="font-size:11px;color:var(--text-secondary);line-height:1.5;max-height:48px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">${esc(s.visual_prompt)}</p>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button onclick="generateSingleImage(${s.scene_id})" class="action-btn hover-accent" ${st.status === 'generating' ? 'disabled' : ''}>${st.status === 'generating' ? 'Working...' : 'Generate'}</button>
          <button onclick="downloadAssetImage(${s.scene_id})" class="action-btn hover-accent" ${hasImage ? '' : 'disabled style="opacity:0.4"'}>Download</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function updateAssetCard(sceneId) {
  if (!STATE.assetsSceneData) return;
  renderAssetGrid(STATE.assetsSceneData.scenes);
}

function updateAssetsProgress() {
  if (!STATE.assetsSceneData || !STATE.assetsSceneData.scenes) return;
  const total = STATE.assetsSceneData.scenes.length;
  const ready = STATE.assetsSceneData.scenes.filter(s => STATE.assetStatuses[s.scene_id]?.status === 'ready').length;
  $('#assets-progress').textContent = `${ready} / ${total} complete`;
}

async function generateSingleImage(sceneId) {
  if (!STATE.assetsSceneData) return;
  const scene = STATE.assetsSceneData.scenes.find(s => s.scene_id === sceneId);
  if (!scene) return;

  STATE.assetStatuses[sceneId] = { status: 'generating', image_url: null, job_id: null };
  updateAssetCard(sceneId);

  try {
    const res = await fetch('/api/assets/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene_id: sceneId,
        prompt: scene.visual_prompt,
        provider: $('#assets-provider').value,
        project_id: STATE.assetsSceneData.project_id || 'default',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    STATE.assetStatuses[sceneId].job_id = data.job_id;
    pollImageStatus(sceneId, data.job_id);
  } catch (e) {
    STATE.assetStatuses[sceneId].status = 'error';
    updateAssetCard(sceneId);
    toast(`Scene ${sceneId}: ${e.message}`, 'error');
  }
}

async function pollImageStatus(sceneId, jobId) {
  const poll = async () => {
    try {
      const res = await fetch(`/api/assets/status/${jobId}`);
      const data = await res.json();
      if (data.status === 'ready') {
        STATE.assetStatuses[sceneId] = { status: 'ready', image_url: data.image_url, job_id: jobId };
        updateAssetCard(sceneId);
        updateAssetsProgress();
        toast(`Scene ${sceneId} image ready`);
      } else if (data.status === 'error') {
        STATE.assetStatuses[sceneId].status = 'error';
        updateAssetCard(sceneId);
        toast(`Scene ${sceneId} generation failed`, 'error');
      } else {
        setTimeout(poll, 3000);
      }
    } catch (e) {
      STATE.assetStatuses[sceneId].status = 'error';
      updateAssetCard(sceneId);
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
    if (STATE.assetStatuses[s.scene_id]?.status !== 'ready' && STATE.assetStatuses[s.scene_id]?.status !== 'generating') {
      await generateSingleImage(s.scene_id);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function downloadAssetImage(sceneId) {
  const st = STATE.assetStatuses[sceneId];
  if (!st || !st.image_url) return;
  const a = document.createElement('a');
  a.href = st.image_url;
  a.download = `scene_${sceneId}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}
