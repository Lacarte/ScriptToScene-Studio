/* ================================================================
   ScriptToScene Studio — DNA Module (Viral DNA Analyzer)
   Analyze viral videos → extract style DNA → generate blueprints.
   ================================================================ */

let _dnaData = null;       // Current niche data (raw_features, dna_profile, blueprint)
let _dnaCurrentNiche = '';  // Currently loaded niche name

// ---- Init ----

(async function dnaInit() {
  await dnaLoadNiches();
  await dnaLoadHistory();
  // Update consistency preview on input
  ['dna-con-character', 'dna-con-setting', 'dna-con-mood'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', dnaUpdatePreview);
  });
})();

// ---- Load niches dropdown ----

async function dnaLoadNiches() {
  try {
    const niches = await api('/api/dna/niches');
    const sel = $('#dna-niche-select');
    if (!niches || !niches.length) {
      sel.innerHTML = '<option value="">No niche folders found in niche-analyzer/</option>';
      return;
    }
    sel.innerHTML = niches.map(n => {
      const flags = [
        n.has_video ? 'video' : null,
        n.has_audio ? 'audio' : null,
        n.has_alignment ? 'align' : null,
      ].filter(Boolean).join(', ');
      const status = n.analyzed ? ' [analyzed]' : '';
      return `<option value="${esc(n.name)}">${esc(n.name)}${status} (${flags})</option>`;
    }).join('');

    sel.addEventListener('change', () => {
      const name = sel.value;
      if (!name) return;
      const niche = niches.find(n => n.name === name);
      const info = $('#dna-niche-info');
      if (niche) {
        info.style.display = '';
        info.innerHTML = [
          niche.has_video ? '<span style="color:var(--accent)">video</span>' : '<span style="color:var(--coral)">no video</span>',
          niche.has_alignment ? '<span style="color:var(--accent)">alignment</span>' : '<span style="color:var(--coral)">no alignment</span>',
          niche.has_audio ? '<span style="color:var(--accent)">audio</span>' : '',
          niche.analyzed ? '<span style="color:var(--accent);font-weight:600">already analyzed</span>' : '',
        ].filter(Boolean).join(' · ');
      }
      // Auto-load if already analyzed
      if (niche && niche.analyzed) dnaLoadNiche(name);
    });
  } catch (e) {
    $('#dna-niche-select').innerHTML = '<option value="">Failed to load niches</option>';
  }
}

// ---- Start analysis ----

async function dnaStartAnalysis() {
  const niche = $('#dna-niche-select').value;
  if (!niche) { toast('Select a niche first', 'error'); return; }

  const btn = $('#dna-analyze-btn');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.textContent = 'Analyzing...';

  const progress = $('#dna-progress');
  progress.style.display = '';

  const steps = ['text', 'audio', 'video', 'caption', 'profile', 'niche', 'blueprint'];
  const stepLabels = {
    text: 'Text Features', audio: 'Audio Features', video: 'Video Features',
    caption: 'Caption Features', profile: 'DNA Profile', niche: 'Niche DNA', blueprint: 'Blueprint',
  };

  $('#dna-steps').innerHTML = steps.map(s => `
    <div id="dna-step-${s}" style="display:flex;align-items:center;gap:10px;padding:6px 0">
      <div id="dna-step-icon-${s}" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:10px;color:var(--text-muted)">&#x2022;</span>
      </div>
      <span style="font-size:12px;color:var(--text-secondary)">${stepLabels[s]}</span>
    </div>
  `).join('');

  try {
    const res = await fetch('/api/dna/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    // SSE progress
    const evtSource = new EventSource(`/api/dna/progress/${data.job_id}`);
    evtSource.onmessage = (e) => {
      const evt = JSON.parse(e.data);

      if (evt.event === 'step') {
        const icon = $(`#dna-step-icon-${evt.step}`);
        if (icon) {
          if (evt.status === 'running') {
            icon.innerHTML = '<div style="width:10px;height:10px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite"></div>';
            icon.style.borderColor = 'var(--accent)';
          } else if (evt.status === 'done') {
            icon.innerHTML = '<svg width="12" height="12" fill="none" stroke="var(--accent)" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
            icon.style.borderColor = 'var(--accent)';
            icon.style.background = 'rgba(78,205,196,0.1)';
          }
        }
      }

      if (evt.event === 'done') {
        evtSource.close();
        toast('DNA analysis complete!');
        dnaLoadNiche(niche);
        dnaLoadHistory();
        btn.disabled = false;
        btn.style.opacity = '';
        btn.textContent = 'Analyze';
      }

      if (evt.event === 'error') {
        evtSource.close();
        toast(evt.message || 'Analysis failed', 'error');
        btn.disabled = false;
        btn.style.opacity = '';
        btn.textContent = 'Analyze';
      }
    };
    evtSource.onerror = () => {
      evtSource.close();
      btn.disabled = false;
      btn.style.opacity = '';
      btn.textContent = 'Analyze';
    };
  } catch (e) {
    toast(e.message || 'Failed to start analysis', 'error');
    btn.disabled = false;
    btn.style.opacity = '';
    btn.textContent = 'Analyze';
  }
}

// ---- Load analyzed niche data ----

async function dnaLoadNiche(name) {
  try {
    const data = await api(`/api/dna/niche/${encodeURIComponent(name)}`);
    _dnaData = data;
    _dnaCurrentNiche = name;
    dnaRenderFeatures(data.raw_features);
    dnaRenderProfile(data.dna_profile);
    dnaRenderConsistency(data.blueprint);
    dnaRenderBlueprint(data.blueprint);
  } catch (e) {
    toast('Failed to load niche data', 'error');
  }
}

// ---- Render: Raw Features ----

function dnaRenderFeatures(raw) {
  if (!raw) { $('#dna-features-section').style.display = 'none'; return; }
  $('#dna-features-section').style.display = '';

  const v = raw.video || {};
  const a = raw.audio || {};
  const t = raw.text || {};

  // Color swatches
  const palette = (v.dominant_palette || []).map(c =>
    `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${c};border:2px solid var(--border)" title="${c}"></span>`
  ).join('');

  // Pacing curve bars
  const curve = v.pacing_curve || [];
  const maxCurve = Math.max(...curve, 1);
  const pacingBars = curve.map((val, i) =>
    `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
      <div style="width:100%;background:var(--accent);border-radius:2px;height:${Math.max(4, (val / maxCurve) * 40)}px;opacity:${0.4 + (val / maxCurve) * 0.6}"></div>
      <span style="font-size:8px;color:var(--text-muted)">${(i * 3)}s</span>
    </div>`
  ).join('');

  $('#dna-features-grid').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${_badge('Duration', (v.duration || 0).toFixed(1) + 's')}
      ${_badge('FPS', v.fps || 0)}
      ${_badge('Cuts', v.cut_count || 0)}
      ${_badge('Cut Rate', (v.cut_rate_per_10s || 0).toFixed(1) + '/10s')}
      ${_badge('Avg Shot', (v.avg_shot_length || 0).toFixed(1) + 's')}
      ${_badge('Motion', (v.optical_flow_mean || 0).toFixed(2))}
      ${_badge('BPM', (a.bpm || 0).toFixed(0))}
      ${_badge('WPS', (t.words_per_second || 0).toFixed(1))}
      ${_badge('Silence', ((a.silence_ratio || 0) * 100).toFixed(0) + '%')}
      ${_badge('Hook WPS', (t.hook_wps || 0).toFixed(1))}
      ${_badge('Pauses', (t.pause_durations || []).length)}
    </div>
    ${palette ? `<div style="margin-top:8px"><span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;display:block;margin-bottom:4px">Color Palette</span><div style="display:flex;gap:6px">${palette}</div></div>` : ''}
    ${curve.length ? `<div style="margin-top:8px"><span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;display:block;margin-bottom:4px">Pacing Curve (cuts per ${3}s)</span><div style="display:flex;gap:2px;align-items:flex-end;height:50px">${pacingBars}</div></div>` : ''}
  `;
}

function _badge(label, value) {
  return `<span class="font-mono" style="font-size:10px;padding:3px 8px;border-radius:5px;background:var(--bg-darkest);border:1px solid var(--border);color:var(--text-secondary)"><span style="color:var(--text-muted)">${label}</span> ${value}</span>`;
}

// ---- Render: DNA Profile ----

function dnaRenderProfile(profile) {
  if (!profile) { $('#dna-profile-section').style.display = 'none'; return; }
  $('#dna-profile-section').style.display = '';

  const t = profile.timing || {};
  const v = profile.visual || {};
  const a = profile.audio || {};
  const c = profile.caption || {};

  const badges = [
    _traitBadge('Pacing', t.pacing_label),
    _traitBadge('Motion', v.motion_level),
    _traitBadge('Voice', a.voice_style),
    _traitBadge('Brightness', v.brightness),
    _traitBadge('Energy', a.energy_level),
    _traitBadge('Contrast', v.contrast),
    _traitBadge('Caption', c.style_preset),
    _traitBadge('Highlight', c.highlight_mode),
  ];
  $('#dna-profile-badges').innerHTML = badges.join('');

  // Timing range
  const minD = (t.avg_shot_length * 0.5 || 0.8).toFixed(1);
  const targetD = (t.avg_shot_length || 2.5).toFixed(1);
  const maxD = Math.min(5, (t.avg_shot_length || 2.5) * 1.8).toFixed(1);
  $('#dna-profile-timing').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--text-secondary)">
      <span>Min <strong>${minD}s</strong></span>
      <span style="color:var(--accent);font-weight:600">Target <strong>${targetD}s</strong></span>
      <span>Max <strong>${maxD}s</strong></span>
      <span style="border-left:1px solid var(--border);padding-left:12px">Hook <strong>${(t.hook_duration || 3).toFixed(1)}s</strong></span>
      <span>Hook WPS <strong>${(t.hook_wps || 0).toFixed(1)}</strong></span>
      <span>Latency <strong>${(t.first_word_latency || 0).toFixed(2)}s</strong></span>
    </div>
  `;
}

function _traitBadge(label, value) {
  const colors = {
    fast: '#4ECDC4', frantic: '#FF6B6B', dynamic: '#4ECDC4', intense: '#FF6B6B',
    energetic: '#FFB347', dramatic: '#FF6B6B', high: '#FFB347',
    karaoke: '#A78BFA', bold_popup: '#4ECDC4', word: '#A78BFA',
  };
  const c = colors[value] || 'var(--text-secondary)';
  return `<span style="font-size:10px;padding:3px 10px;border-radius:5px;background:${c}15;border:1px solid ${c}30;color:${c}"><span style="opacity:0.7">${label}:</span> <strong>${value || 'n/a'}</strong></span>`;
}

// ---- Render: Visual Consistency ----

function dnaRenderConsistency(blueprint) {
  if (!blueprint) { $('#dna-consistency-section').style.display = 'none'; return; }
  $('#dna-consistency-section').style.display = '';

  const con = blueprint.consistency || {};
  $('#dna-con-character').value = con.character || '';
  $('#dna-con-setting').value = con.setting || '';
  $('#dna-con-mood').value = con.mood || '';
  dnaUpdatePreview();
}

function dnaUpdatePreview() {
  const char = ($('#dna-con-character')?.value || '').trim();
  const setting = ($('#dna-con-setting')?.value || '').trim();
  const mood = ($('#dna-con-mood')?.value || '').trim();
  const preview = $('#dna-con-preview');

  if (!char && !setting && !mood) {
    preview.style.display = 'none';
    return;
  }

  preview.style.display = '';
  const lines = [];
  if (char) lines.push(`CHARACTER: ${char}`);
  if (setting) lines.push(`SETTING: ${setting}`);
  if (mood) lines.push(`MOOD: ${mood}`);
  preview.textContent = lines.join('\n');
}

async function dnaSaveConsistency() {
  if (!_dnaCurrentNiche) { toast('No niche loaded', 'error'); return; }

  try {
    await fetch('/api/dna/blueprint/consistency', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        niche: _dnaCurrentNiche,
        character: $('#dna-con-character').value.trim(),
        setting: $('#dna-con-setting').value.trim(),
        mood: $('#dna-con-mood').value.trim(),
      }),
    });
    toast('Consistency saved');
    // Refresh blueprint display
    const data = await api(`/api/dna/niche/${encodeURIComponent(_dnaCurrentNiche)}`);
    _dnaData = data;
    dnaRenderBlueprint(data.blueprint);
  } catch (e) {
    toast('Failed to save consistency', 'error');
  }
}

// ---- Render: Blueprint Preview ----

function dnaRenderBlueprint(bp) {
  if (!bp) { $('#dna-blueprint-section').style.display = 'none'; return; }
  $('#dna-blueprint-section').style.display = '';

  const seg = bp.segmentation || {};
  const vis = bp.visual || {};
  const cap = bp.caption || {};
  const hook = bp.hook || {};
  const con = bp.consistency || {};
  const timing = seg.timing || {};

  $('#dna-blueprint-cards').innerHTML = `
    ${_bpCard('Segmentation', `
      Target: <strong>${timing.target_duration}s</strong> (${timing.min_duration}–${timing.max_duration}s)
      · WPS: ${timing.words_per_second} · Pause threshold: ${timing.pause_threshold}s
      <br>Break weights: pause=${(seg.break_weights||{}).pause}, punct=${(seg.break_weights||{}).punctuation}, density=${(seg.break_weights||{}).density}
    `)}
    ${_bpCard('Visual', `
      Motion: <strong>${vis.motion_level}</strong> · Cut rate: ${vis.cut_rate}/10s · Zoom: ${vis.zoom_behavior} · Transition: ${vis.transition_type}
      <br>Type mix: video ${((vis.type_mix||{}).video*100||70).toFixed(0)}% / image ${((vis.type_mix||{}).image*100||20).toFixed(0)}% / text ${((vis.type_mix||{}).text*100||10).toFixed(0)}%
    `)}
    ${_bpCard('Caption', `
      Preset: <strong>${cap.style_preset}</strong> · Position: ${cap.position} · Lines: ${cap.lines} · Max words: ${cap.max_words_per_line}
      <br>Highlight: ${cap.highlight_mode} · Weight: ${cap.font_weight} · Stroke: ${cap.stroke}
    `)}
    ${_bpCard('Hook', `
      Duration: <strong>${hook.duration}s</strong> · Intensity: ${hook.visual_intensity} · Caption scale: ${hook.caption_scale}x · WPS: ${hook.word_density}
    `)}
    ${con.character || con.setting || con.mood ? _bpCard('Consistency', `
      ${con.character ? `<strong>Character:</strong> ${esc(con.character)}<br>` : ''}
      ${con.setting ? `<strong>Setting:</strong> ${esc(con.setting)}<br>` : ''}
      ${con.mood ? `<strong>Mood:</strong> ${esc(con.mood)}` : ''}
    `) : ''}
  `;
}

function _bpCard(title, html) {
  return `<div style="padding:10px 12px;border-radius:8px;background:var(--bg-darkest);border:1px solid var(--border)">
    <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);display:block;margin-bottom:4px">${title}</span>
    <div style="font-size:11px;color:var(--text-secondary);line-height:1.6">${html}</div>
  </div>`;
}

// ---- Use in Pipeline ----

function dnaUseInPipeline() {
  if (!_dnaData || !_dnaData.blueprint) { toast('No blueprint loaded', 'error'); return; }

  // Find the blueprint path from the niche output dir
  const bpPath = _dnaData.blueprint_path || '';

  // Store in global state + localStorage
  window.STATE.activeBlueprint = { niche: _dnaCurrentNiche, blueprint: _dnaData.blueprint };
  window.STATE.activeBlueprintPath = bpPath;
  localStorage.setItem('sts-active-blueprint', bpPath);

  // Set the pipeline dropdown selector if it exists
  const sel = document.getElementById('pipeline-blueprint');
  if (sel) {
    // Ensure option exists (may need to refresh list first)
    let found = false;
    for (const opt of sel.options) {
      if (opt.value === bpPath) { opt.selected = true; found = true; break; }
    }
    if (!found && bpPath) {
      const opt = document.createElement('option');
      opt.value = bpPath;
      opt.textContent = _dnaCurrentNiche;
      sel.appendChild(opt);
      sel.value = bpPath;
    }
    // Trigger the pipeline badge update
    if (typeof _plUpdateBlueprintBadge === 'function') _plUpdateBlueprintBadge();
  }

  toast(`Blueprint "${_dnaCurrentNiche}" activated for pipeline`);
}

function dnaClearBlueprint() {
  window.STATE.activeBlueprint = null;
  window.STATE.activeBlueprintPath = null;
  localStorage.removeItem('sts-active-blueprint');

  const sel = document.getElementById('pipeline-blueprint');
  if (sel) {
    sel.value = '';
    if (typeof _plUpdateBlueprintBadge === 'function') _plUpdateBlueprintBadge();
  }
  toast('Blueprint cleared');
}

// ---- Export ----

function dnaExportBlueprint() {
  if (!_dnaData || !_dnaData.blueprint) { toast('No blueprint loaded', 'error'); return; }
  const blob = new Blob([JSON.stringify(_dnaData.blueprint, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `blueprint_${_dnaCurrentNiche}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- History ----

async function dnaLoadHistory() {
  const container = $('#dna-history-list');
  if (!container) return;

  try {
    const blueprints = await api('/api/dna/blueprints');
    if (!blueprints || !blueprints.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:12px;padding:20px 0">No analyzed niches yet</p>';
      return;
    }
    container.innerHTML = blueprints.map(bp => {
      const isActive = bp.niche === _dnaCurrentNiche;
      return `
      <div class="hist-item" style="cursor:pointer;transition:background 0.15s;${isActive ? 'background:rgba(78,205,196,0.06);border-left:3px solid var(--accent)' : 'border-left:3px solid transparent'}" onclick="dnaLoadNiche('${esc(bp.niche)}')" onmouseover="this.style.background='var(--bg-darkest)'" onmouseout="this.style.background='${isActive ? 'rgba(78,205,196,0.06)' : ''}'">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;font-weight:${isActive ? '600' : '400'};color:${isActive ? 'var(--accent)' : 'var(--text)'}">${esc(bp.niche)}</span>
              ${isActive ? '<span class="font-mono" style="font-size:8px;padding:1px 6px;border-radius:3px;background:rgba(78,205,196,0.15);color:var(--accent)">ACTIVE</span>' : ''}
              ${bp.has_character ? '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(167,139,250,0.1);color:#A78BFA">char</span>' : ''}
            </div>
            <div class="font-mono" style="font-size:10px;color:var(--text-muted);margin-top:2px">
              target ${bp.target_duration}s · ${bp.motion_level} · ${bp.caption_preset} · ${timeAgo(bp.timestamp)}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p style="text-align:center;color:var(--coral);font-size:11px;padding:16px">Failed to load history</p>';
  }
}

// ---- Restore blueprint on page load ----

(function restoreBlueprint() {
  try {
    const stored = localStorage.getItem('sts-active-blueprint');
    if (stored) {
      window.STATE.activeBlueprintPath = stored;
      // Pipeline dropdown will be set by pipelineLoadBlueprints() in pipeline.js
    }
  } catch (e) { /* ignore */ }
})();
