import { State } from './state.js';
import { StudioAPI } from './studio-api.js';
import { Timeline } from './timeline.js';
import { validateProject, hasBlockingErrors } from './validation.js';
import { formatRelativeTime, showToast, Storage, getTotalDuration } from './utils.js';

class App {
    constructor() {
        this.timeline = null;
    }

    async init() {
        console.log('App initializing...');

        // Remove any leftover staging overlay
        const stagingOverlay = document.getElementById('staging-overlay');
        if (stagingOverlay) stagingOverlay.remove();

        // Initialize timeline
        this.timeline = new Timeline('timeline-container');

        this.timeline.onSceneClick = (scene) => {
            State.selectScene(scene);
            this.timeline.scrollToScene(scene.scene_id);
        };

        // Subscriptions
        State.subscribe(['syncStatus', 'lastSyncedAt'], () => this.updateSyncStatus());
        State.subscribe(['scenes'], () => this.runValidation());
        State.subscribe(['scenes', 'history', 'historyIndex'], () => this.updateUndoRedoButtons());

        // Set up controls
        this.setupKeyboardShortcuts();
        this.setupExportButton();
        this.setupStageButton();
        this.setupUndoRedoButtons();
        this.setupStudioSource();
        this.setupPostMessageListener();

        // Check for scenes from studio's "Send to Editor"
        this.checkStudioBridge();

        // Load recent projects history
        this.loadRecentProjects();

        // Hide the app loading overlay
        this.hideAppLoadingOverlay();

        console.log('App initialized');
    }

    hideAppLoadingOverlay() {
        const overlay = document.getElementById('app-loading-overlay');
        if (overlay) {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    }

    setupExportButton() {
        document.getElementById('export-timeline')?.addEventListener('click', () => this.exportTimeline());
    }

    setupStageButton() {
        document.getElementById('stage-timeline')?.addEventListener('click', () => this.stageTimeline());
    }

    // ---- Studio Source Integration ----

    setupStudioSource() {
        document.getElementById('use-current-btn')?.addEventListener('click', () => this.useCurrentResult());
        document.getElementById('pick-history-btn')?.addEventListener('click', () => this.pickFromHistory());
        document.getElementById('refresh-history-btn')?.addEventListener('click', () => this.loadRecentProjects());
    }

    setupPostMessageListener() {
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'load-scenes' && e.data.data) {
                this.loadStudioData(e.data.data);
                showToast('Scenes received from Studio', 'success');
            }
        });
    }

    checkStudioBridge() {
        const stored = localStorage.getItem('sts-editor-scenes');
        if (!stored) return;

        try {
            const data = JSON.parse(stored);
            if (data && data.scenes && data.scenes.length) {
                this.loadStudioData(data);
                showToast(`Loaded ${data.scenes.length} scenes from Studio`);
            }
        } catch { /* ignore */ }
    }

    useCurrentResult() {
        const stored = localStorage.getItem('sts-editor-scenes');
        if (!stored) {
            showToast('No scenes available. Generate scenes in Studio first.', 'error');
            return;
        }

        try {
            const data = JSON.parse(stored);
            if (!data || !data.scenes || !data.scenes.length) {
                showToast('No scenes in current result', 'error');
                return;
            }
            this.loadStudioData(data);
            showToast(`Loaded ${data.scenes.length} scenes from current result`);
        } catch (e) {
            showToast('Failed to parse scenes data', 'error');
        }
    }

    /**
     * Pick from ASSETS history — shows modal with asset projects.
     */
    async pickFromHistory() {
        const modal = document.getElementById('scene-picker-modal');
        const list = document.getElementById('scene-picker-list');
        const loading = document.getElementById('scene-picker-loading');
        const closeBtn = modal?.querySelector('.modal-close');

        if (!modal || !list) return;

        modal.classList.add('show');
        if (loading) loading.classList.remove('hidden');
        list.innerHTML = '';

        const closeModal = () => modal.classList.remove('show');
        closeBtn.onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        try {
            const items = await StudioAPI.fetchAssetsHistory();
            if (loading) loading.classList.add('hidden');

            if (!items || !items.length) {
                list.innerHTML = '<li class="picker-empty">No asset projects found. Generate assets in Studio first.</li>';
                return;
            }

            const currentSourceId = State.get('studioSourceId');

            list.innerHTML = items.map(item => {
                const isActive = currentSourceId && item.project_id === currentSourceId;
                const name = item.project_id || 'Untitled';
                const truncated = name.length > 35 ? name.slice(0, 35) + '...' : name;
                const timeStr = item.created_at ? formatRelativeTime(new Date(item.created_at))
                    : item.timestamp ? formatRelativeTime(new Date(item.timestamp)) : '';
                const statusColors = { done: '#4ECDC4', downloading: '#FFB347', error: '#FF6B6B', waiting: '#8B8B8B' };
                const statusColor = statusColors[item.status] || '#8B8B8B';

                // Preview image
                const previewHtml = item.preview
                    ? `<div class="recent-project-preview"><img src="${this._escHtml(item.preview)}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'recent-project-preview-fallback\\'>IMG</div>'"></div>`
                    : `<div class="recent-project-preview"><div class="recent-project-preview-fallback"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div></div>`;

                return `
                    <li class="picker-item ${isActive ? 'active' : ''}" data-project-id="${this._escHtml(item.project_id)}">
                        ${previewHtml}
                        <div class="picker-item-info">
                            <div class="picker-item-name">${this._escHtml(truncated)}</div>
                            <div class="picker-item-meta">
                                ${item.scene_count || 0} scenes ·
                                ${item.disk_files || 0} files
                                ${timeStr ? ' · ' + timeStr : ''}
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:5px">
                            <span style="width:5px;height:5px;border-radius:50%;background:${statusColor}"></span>
                            <span style="font-family:var(--font-mono);font-size:0.5rem;color:${statusColor};text-transform:uppercase;letter-spacing:0.06em;font-weight:600">${item.status || 'unknown'}</span>
                        </div>
                        ${isActive ? '<span class="picker-item-badge">ACTIVE</span>' : ''}
                    </li>
                `;
            }).join('');

            // Click handlers
            list.querySelectorAll('.picker-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const projectId = item.dataset.projectId;
                    closeModal();
                    await this.loadAssetProject(projectId);
                });
            });
        } catch (e) {
            if (loading) loading.classList.add('hidden');
            list.innerHTML = `<li class="picker-empty">Failed to load history: ${e.message}</li>`;
        }
    }

    /**
     * Load an asset project — fetches assets, scenes, segmenter, and alignment data.
     */
    async loadAssetProject(projectId) {
        const timelineLoading = document.getElementById('timeline-loading');
        if (timelineLoading) timelineLoading.classList.remove('hidden');

        try {
            const [assetsData, sceneData, segmenterData, alignmentData] = await Promise.all([
                StudioAPI.fetchAssetsProject(projectId),
                StudioAPI.fetchSceneProject(projectId).catch(() => null),
                StudioAPI.findSegmenterForProject({ project_id: projectId }),
                StudioAPI.findAlignmentForProject(projectId),
            ]);

            if (!assetsData) {
                showToast('No asset data found', 'error');
                return;
            }

            // Build scene data from assets if scene data not available
            let effectiveSceneData = sceneData;
            if (!effectiveSceneData || !effectiveSceneData.scenes || !effectiveSceneData.scenes.length) {
                const prompts = assetsData.prompts || {};
                const scenes = [];
                for (const [sceneNum, sceneInfo] of Object.entries(assetsData.scenes || {})) {
                    scenes.push({
                        index: parseInt(sceneNum),
                        type_of_scene: 'image',
                        image_prompt: prompts[sceneNum] || '',
                        duration: 3,
                        text_content: null,
                    });
                }
                scenes.sort((a, b) => a.index - b.index);
                effectiveSceneData = { project_id: projectId, scenes };
            }

            // Build timeline scenes
            const timelineScenes = StudioAPI.buildTimelineFromAssets(
                effectiveSceneData, assetsData, segmenterData
            );

            if (!timelineScenes.length) {
                showToast('No scenes to load', 'error');
                return;
            }

            // Create project object
            const project = {
                project_id: projectId,
                script: effectiveSceneData.script || '',
                duration: timelineScenes.reduce((sum, s) => sum + (s.duration || 0), 0),
                created_at: assetsData.created_at || new Date().toISOString(),
            };

            State.selectProject(project);
            State.setScenes(timelineScenes, true);
            State.set({ studioSourceId: projectId }, true);

            // Store segmenter and alignment data
            if (segmenterData) {
                State.set({ segmenterData }, true);
            }
            if (alignmentData) {
                State.set({ alignmentData }, true);
                this.renderAudioBar(alignmentData);
            }

            // Hide welcome message
            const welcomeMessage = document.getElementById('welcome-message');
            if (welcomeMessage) welcomeMessage.classList.add('hidden');

            // Update source info + project info bar
            this.updateSourceInfo(`${projectId.slice(0, 25)} · ${timelineScenes.length} scenes`, true);
            this.updateProjectInfoBar(projectId, timelineScenes, segmenterData, alignmentData, project.created_at);

            // Refresh recent projects list
            this.loadRecentProjects();

            this.runValidation();

            const doneCount = timelineScenes.filter(s => s.status === 'done').length;
            showToast(`Loaded ${timelineScenes.length} scenes (${doneCount} with images)${segmenterData ? ' + timing' : ''}${alignmentData ? ' + audio' : ''}`);
        } catch (e) {
            showToast(`Failed to load project: ${e.message}`, 'error');
        } finally {
            if (timelineLoading) timelineLoading.classList.add('hidden');
        }
    }

    /**
     * Legacy: load studio scene data (from "Use Current Result" or postMessage).
     */
    async loadStudioData(studioData) {
        const scenes = StudioAPI.transformScenes(studioData);
        if (!scenes.length) {
            showToast('No scenes to load', 'error');
            return;
        }

        const projectId = studioData.project_id || `studio_${Date.now()}`;
        const project = {
            project_id: projectId,
            script: studioData.script || '',
            duration: scenes.reduce((sum, s) => sum + (s.duration || 0), 0),
            created_at: studioData.timestamp || new Date().toISOString(),
        };

        State.selectProject(project);
        State.setScenes(scenes, true);
        State.set({ studioSourceId: projectId }, true);

        const welcomeMessage = document.getElementById('welcome-message');
        if (welcomeMessage) welcomeMessage.classList.add('hidden');

        this.updateSourceInfo(`${projectId.slice(0, 25)} · ${scenes.length} scenes`, true);
        this.updateProjectInfoBar(projectId, scenes, null, null, project.created_at);

        // Try to load segmenter + alignment data
        this.loadSegmenterForProject(studioData);
        this.loadAlignmentForProject(projectId);

        this.runValidation();
    }

    async loadSegmenterForProject(studioData) {
        try {
            const segData = await StudioAPI.findSegmenterForProject(studioData);
            if (segData) {
                State.set({ segmenterData: segData }, true);
            }
        } catch (e) {
            console.warn('Could not load segmenter data:', e);
        }
    }

    async loadAlignmentForProject(projectId) {
        try {
            const alignData = await StudioAPI.findAlignmentForProject(projectId);
            if (alignData) {
                State.set({ alignmentData: alignData }, true);
                this.renderAudioBar(alignData);
            }
        } catch (e) {
            console.warn('Could not load alignment data:', e);
        }
    }

    // ---- Project Info Bar ----

    updateProjectInfoBar(projectId, scenes, segmenterData, alignmentData, createdAt) {
        const bar = document.getElementById('project-info-bar');
        if (!bar) return;

        bar.style.display = '';

        const idEl = document.getElementById('project-info-id');
        const scenesEl = document.getElementById('project-info-scenes');
        const imagesEl = document.getElementById('project-info-images');
        const durationEl = document.getElementById('project-info-duration');
        const segEl = document.getElementById('project-info-segmenter');
        const alignEl = document.getElementById('project-info-alignment');
        const timeEl = document.getElementById('project-info-time');

        const doneCount = scenes.filter(s => s.status === 'done').length;
        const totalDur = getTotalDuration(scenes);

        if (idEl) idEl.textContent = projectId.length > 30 ? projectId.slice(0, 30) + '...' : projectId;
        if (scenesEl) scenesEl.textContent = `${scenes.length} scenes`;
        if (imagesEl) imagesEl.textContent = `${doneCount} images`;
        if (durationEl) {
            const m = Math.floor(totalDur / 60);
            const s = Math.floor(totalDur % 60);
            durationEl.textContent = `${m}:${s.toString().padStart(2, '0')} duration`;
        }

        if (segEl) {
            if (segmenterData) {
                segEl.style.display = '';
                segEl.textContent = `segmenter`;
            } else {
                segEl.style.display = 'none';
            }
        }

        if (alignEl) {
            if (alignmentData) {
                alignEl.style.display = '';
                alignEl.textContent = `audio`;
            } else {
                alignEl.style.display = 'none';
            }
        }

        if (timeEl && createdAt) {
            timeEl.textContent = formatRelativeTime(new Date(createdAt));
        }
    }

    // ---- Recent Projects ----

    async loadRecentProjects() {
        const container = document.getElementById('recent-projects-list');
        if (!container) return;

        try {
            const items = await StudioAPI.fetchAssetsHistory();
            if (!items || !items.length) {
                container.innerHTML = '<div class="recent-projects-empty"><span>No asset projects yet</span></div>';
                return;
            }

            const currentSourceId = State.get('studioSourceId');

            container.innerHTML = items.slice(0, 8).map(item => {
                const isActive = currentSourceId && item.project_id === currentSourceId;
                const name = item.project_id || 'Untitled';
                const truncated = name.length > 30 ? name.slice(0, 30) + '...' : name;
                const timeStr = item.created_at ? formatRelativeTime(new Date(item.created_at))
                    : item.timestamp ? formatRelativeTime(new Date(item.timestamp)) : '';
                const statusColors = { done: '#4ECDC4', downloading: '#FFB347', error: '#FF6B6B', waiting: '#8B8B8B' };
                const statusColor = statusColors[item.status] || '#8B8B8B';
                const statusLabel = item.status || 'unknown';
                const readyCount = item.ready_count || 0;

                // Preview
                const previewHtml = item.preview
                    ? `<div class="recent-project-preview"><img src="${this._escHtml(item.preview)}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'recent-project-preview-fallback\\'>IMG</div>'"></div>`
                    : `<div class="recent-project-preview"><div class="recent-project-preview-fallback"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div></div>`;

                return `
                    <div class="recent-project-item ${isActive ? 'active' : ''}" data-project-id="${this._escHtml(item.project_id)}">
                        ${previewHtml}
                        <div class="recent-project-info">
                            <div class="recent-project-name-row">
                                <span class="recent-project-name">${this._escHtml(truncated)}</span>
                                ${isActive ? '<span class="recent-project-badge">ACTIVE</span>' : ''}
                            </div>
                            <div class="recent-project-meta">
                                <span class="recent-project-chip">${item.scene_count || 0} scenes</span>
                                ${readyCount > 0 ? `<span class="recent-project-chip recent-project-chip-accent">${readyCount} ready</span>` : ''}
                                ${item.disk_files > 0 ? `<span class="recent-project-chip">${item.disk_files} files</span>` : ''}
                                ${timeStr ? `<span class="recent-project-chip" style="opacity:0.6">${timeStr}</span>` : ''}
                            </div>
                        </div>
                        <div class="recent-project-status">
                            <span class="recent-project-status-dot" style="background:${statusColor}"></span>
                            <span class="recent-project-status-label" style="color:${statusColor}">${statusLabel}</span>
                        </div>
                    </div>
                `;
            }).join('');

            // Click handlers
            container.querySelectorAll('.recent-project-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const projectId = item.dataset.projectId;
                    await this.loadAssetProject(projectId);
                });
            });
        } catch (e) {
            container.innerHTML = '<div class="recent-projects-empty"><span>Could not load projects</span></div>';
        }
    }

    // ---- Audio bar ----

    renderAudioBar(alignmentData) {
        const existing = document.getElementById('audio-bar');
        if (existing) existing.remove();

        if (!alignmentData || !alignmentData.folder) return;

        const audioUrl = this._getAudioUrl(alignmentData);
        const sourceFile = alignmentData.source_file || 'audio';
        const duration = alignmentData.duration_seconds
            ? `${alignmentData.duration_seconds.toFixed(1)}s`
            : '';

        const bar = document.createElement('div');
        bar.id = 'audio-bar';
        bar.className = 'audio-bar';
        bar.innerHTML = `
            <span class="audio-bar-label">Audio</span>
            <audio controls preload="metadata" src="${this._escHtml(audioUrl)}"></audio>
            <span class="audio-bar-file" title="${this._escHtml(sourceFile)}">${this._escHtml(sourceFile)}${duration ? ' · ' + duration : ''}</span>
        `;

        const timelineHeader = document.querySelector('.timeline-header');
        if (timelineHeader) {
            timelineHeader.after(bar);
        }
    }

    _getAudioUrl(alignmentData) {
        if (!alignmentData || !alignmentData.folder) return '';
        const sourceFile = alignmentData.source_file || '';
        return `/output/alignments/${encodeURIComponent(alignmentData.folder)}/${encodeURIComponent(sourceFile)}`;
    }

    updateSourceInfo(text, loaded) {
        const el = document.getElementById('studio-source-info');
        if (el) {
            el.textContent = text;
            el.classList.toggle('loaded', !!loaded);
        }
    }

    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ---- Validation ----

    runValidation() {
        const scenes = State.get('scenes');
        const project = State.get('currentProject');
        const projectDuration = project?.duration || null;

        const errors = validateProject(scenes, projectDuration);
        State.setValidationErrors(errors);
    }

    // ---- Sync Status ----

    updateSyncStatus() {
        const status = State.get('syncStatus');
        const lastSynced = State.get('lastSyncedAt');

        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');

        if (!statusDot || !statusText) return;

        statusDot.classList.remove('status-synced', 'status-saving', 'status-error');

        switch (status) {
            case 'synced':
                statusDot.classList.add('status-synced');
                statusText.textContent = lastSynced
                    ? `Synced ${formatRelativeTime(lastSynced)}`
                    : 'Synced';
                break;
            case 'saving':
                statusDot.classList.add('status-saving');
                statusText.textContent = 'Saving...';
                break;
            case 'error':
                statusDot.classList.add('status-error');
                statusText.textContent = 'Sync error';
                break;
        }
    }

    // ---- Keyboard shortcuts ----

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea, select')) {
                if (e.key !== 'Escape') return;
            }

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    this.timeline.navigateScene(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.timeline.navigateScene(1);
                    break;
                case 'Escape':
                    e.preventDefault();
                    State.selectScene(null);
                    break;
                case 'Delete':
                    if (State.get('selectedScene')) {
                        e.preventDefault();
                        const scene = State.get('selectedScene');
                        if (confirm(`Delete scene ${scene.scene_id}?`)) {
                            State.removeScene(scene.scene_id);
                        }
                    }
                    break;
                case 's':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.saveAll();
                    }
                    break;
                case 'z':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (e.shiftKey) {
                            if (State.redo()) showToast('Redo', 'info');
                        } else {
                            if (State.undo()) showToast('Undo', 'info');
                        }
                    }
                    break;
                case '?':
                    e.preventDefault();
                    this.showShortcutsModal();
                    break;
            }
        });
    }

    showShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        const closeBtn = modal?.querySelector('.modal-close');
        if (!modal) return;

        modal.classList.add('show');
        const closeModal = () => modal.classList.remove('show');
        closeBtn.onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    showScriptModal(script) {
        const modal = document.getElementById('script-modal');
        const content = document.getElementById('script-content');
        const closeBtn = modal.querySelector('.modal-close');
        const copyBtn = document.getElementById('copy-script');

        if (!modal || !content) return;

        content.textContent = script || 'No script available';
        modal.classList.add('show');

        const closeModal = () => modal.classList.remove('show');
        closeBtn.onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        copyBtn.onclick = async () => {
            if (script) {
                await navigator.clipboard.writeText(script);
                showToast('Script copied to clipboard', 'success');
            }
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    // ---- Save / Export / Stage ----

    async saveAll() {
        const scenes = State.get('scenes');
        if (!scenes.length) return;
        State.backupScenes();
        showToast('Scenes saved locally', 'success');
    }

    async exportTimeline() {
        const project = State.get('currentProject');
        const scenes = State.get('scenes');

        if (!project || !scenes.length) {
            showToast('No project or scenes to export', 'warning');
            return;
        }

        const errors = State.get('validationErrors');
        if (hasBlockingErrors(errors)) {
            showToast('Cannot export: fix validation errors first', 'error');
            return;
        }

        const exportBtn = document.getElementById('export-timeline');
        exportBtn?.classList.add('btn-loading');

        await new Promise(resolve => setTimeout(resolve, 600));

        let imageCounter = 1;
        const timeline = {
            project_id: project.project_id,
            total_duration: getTotalDuration(scenes),
            scene_count: scenes.length,
            exported_at: new Date().toISOString(),
            scenes: scenes.map(scene => {
                const isVisualScene = !['text', 'cta'].includes(scene.scene_type);
                const imageFile = isVisualScene ? `image${imageCounter++}.jpg` : null;

                return {
                    id: scene.scene_id,
                    type: scene.scene_type,
                    timestamp: scene.timestamp,
                    duration: scene.duration,
                    description: scene.description || '',
                    visual_fx: scene.visual_fx,
                    style: scene.style || '',
                    status: scene.status,
                    ...(isVisualScene && {
                        image: imageFile,
                        image_url: scene.image_url || '',
                        prompt: scene.prompt || ''
                    }),
                    ...(!isVisualScene && {
                        text_content: scene.text_content || '',
                        text_bg: scene.text_bg || ''
                    }),
                    ...(scene.segment_start != null && {
                        segment_start: scene.segment_start,
                        segment_end: scene.segment_end,
                        segment_words: scene.segment_words || ''
                    })
                };
            })
        };

        const alignmentData = State.get('alignmentData');
        if (alignmentData) {
            timeline.audio = {
                source_file: alignmentData.source_file || '',
                folder: alignmentData.folder || '',
                duration: alignmentData.duration_seconds || 0,
            };
        }

        const blob = new Blob([JSON.stringify(timeline, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timeline_${project.project_id.slice(0, 20)}.json`;
        a.click();
        URL.revokeObjectURL(url);

        exportBtn?.classList.remove('btn-loading');
        showToast(`Timeline exported with ${imageCounter - 1} images`, 'success');
    }

    stageTimeline() {
        const project = State.get('currentProject');
        const scenes = State.get('scenes');

        if (!project || !scenes.length) {
            showToast('No project or scenes to stage', 'warning');
            return;
        }

        const errors = State.get('validationErrors');
        if (hasBlockingErrors(errors)) {
            showToast('Cannot stage: fix validation errors first', 'error');
            return;
        }

        const stageBtn = document.getElementById('stage-timeline');
        if (stageBtn) {
            stageBtn.classList.add('btn-loading');
            stageBtn.disabled = true;
        }

        this.showStagingOverlay();

        setTimeout(() => {
            let imageCounter = 1;
            const stagedData = {
                project_id: project.project_id,
                project_name: project.name || project.project_id,
                total_duration: getTotalDuration(scenes),
                scene_count: scenes.length,
                staged_at: new Date().toISOString(),
                scenes: scenes.map(scene => {
                    const isVisualScene = !['text', 'cta'].includes(scene.scene_type);
                    const imageFile = isVisualScene ? `image${imageCounter++}.jpg` : null;

                    return {
                        id: scene.scene_id,
                        type: scene.scene_type,
                        timestamp: scene.timestamp,
                        duration: scene.duration,
                        description: scene.description || '',
                        visual_fx: scene.visual_fx,
                        style: scene.style || '',
                        status: scene.status,
                        ...(isVisualScene && {
                            image: imageFile,
                            image_url: scene.image_url || '',
                            prompt: scene.prompt || ''
                        }),
                        ...(!isVisualScene && {
                            text_content: scene.text_content || '',
                            text_bg: scene.text_bg || ''
                        })
                    };
                })
            };

            const alignmentData = State.get('alignmentData');
            if (alignmentData) {
                stagedData.audio = {
                    source_file: alignmentData.source_file || '',
                    folder: alignmentData.folder || '',
                    url: this._getAudioUrl(alignmentData),
                    duration: alignmentData.duration_seconds || 0,
                };
            }

            sessionStorage.setItem('staged_timeline', JSON.stringify(stagedData));

            this.updateStagingOverlay('Opening Video Editor...');

            setTimeout(() => {
                window.location.href = 'editor.html';
            }, 300);
        }, 100);
    }

    showStagingOverlay() {
        let overlay = document.getElementById('staging-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'staging-overlay';
            overlay.className = 'staging-overlay';
            overlay.innerHTML = `
                <div class="staging-content">
                    <div class="staging-spinner"></div>
                    <div class="staging-message">Preparing Timeline...</div>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    updateStagingOverlay(message) {
        const msgEl = document.querySelector('.staging-message');
        if (msgEl) msgEl.textContent = message;
    }

    // ---- Undo / Redo ----

    setupUndoRedoButtons() {
        document.getElementById('undo-btn')?.addEventListener('click', () => {
            if (State.undo()) showToast('Undo', 'info');
        });

        document.getElementById('redo-btn')?.addEventListener('click', () => {
            if (State.redo()) showToast('Redo', 'info');
        });

        this.setupHistoryDropdown();
        this.updateUndoRedoButtons();
    }

    setupHistoryDropdown() {
        const historyBtn = document.getElementById('history-btn');
        const historyDropdown = document.getElementById('history-dropdown');
        const clearHistoryBtn = document.getElementById('clear-history-btn');

        if (!historyBtn || !historyDropdown) return;

        historyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = historyDropdown.classList.contains('show');
            if (isOpen) {
                historyDropdown.classList.remove('show');
            } else {
                this.renderHistoryList();
                historyDropdown.classList.add('show');
            }
        });

        document.addEventListener('click', (e) => {
            if (!historyDropdown.contains(e.target) && !historyBtn.contains(e.target)) {
                historyDropdown.classList.remove('show');
            }
        });

        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Clear all edit history?')) {
                    State.clearHistory();
                    this.renderHistoryList();
                    showToast('History cleared', 'info');
                }
            });
        }
    }

    renderHistoryList() {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;

        const history = State.get('history');
        const historyIndex = State.get('historyIndex');

        if (!history || history.length <= 1) {
            historyList.innerHTML = '<li class="history-empty">No history yet</li>';
            return;
        }

        historyList.innerHTML = history.map((scenes, index) => {
            if (index === 0) {
                return `
                    <li class="history-item ${index === historyIndex ? 'current' : ''}" data-index="${index}">
                        <span class="history-item-index">${index}</span>
                        <div class="history-item-info">
                            <div class="history-item-label">Initial state</div>
                            <div class="history-item-meta">${scenes.length} scenes</div>
                        </div>
                    </li>
                `;
            }

            const prevScenes = history[index - 1];
            const changeDesc = this.describeHistoryChange(prevScenes, scenes);

            return `
                <li class="history-item ${index === historyIndex ? 'current' : ''}" data-index="${index}">
                    <span class="history-item-index">${index}</span>
                    <div class="history-item-info">
                        <div class="history-item-label">${changeDesc}</div>
                        <div class="history-item-meta">${scenes.length} scenes</div>
                    </div>
                    <button class="history-item-delete" data-index="${index}" title="Delete this state">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18"></path>
                            <path d="M6 6l12 12"></path>
                        </svg>
                    </button>
                </li>
            `;
        }).reverse().join('');

        historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.history-item-delete')) return;
                const index = parseInt(item.dataset.index);
                State.jumpToHistory(index);
                this.renderHistoryList();
                showToast(`Jumped to state ${index}`, 'info');
            });
        });

        historyList.querySelectorAll('.history-item-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                State.deleteHistoryAt(index);
                this.renderHistoryList();
                showToast('State removed', 'info');
            });
        });
    }

    describeHistoryChange(prevScenes, currentScenes) {
        if (!prevScenes || !currentScenes) return 'Unknown change';

        if (prevScenes.length !== currentScenes.length) {
            return currentScenes.length > prevScenes.length ? 'Added scene' : 'Removed scene';
        }

        for (let i = 0; i < currentScenes.length; i++) {
            const prev = prevScenes[i];
            const curr = currentScenes[i];
            if (!prev || !curr) continue;

            if (prev.duration !== curr.duration) return `Scene ${curr.scene_id}: duration → ${curr.duration}s`;
            if (prev.scene_type !== curr.scene_type) return `Scene ${curr.scene_id}: type → ${curr.scene_type}`;
            if (prev.visual_fx !== curr.visual_fx) return `Scene ${curr.scene_id}: effect → ${curr.visual_fx}`;
            if (prev.text_content !== curr.text_content) return `Scene ${curr.scene_id}: text changed`;
            if (prev.status !== curr.status) return `Scene ${curr.scene_id}: status → ${curr.status}`;
            if (prev.prompt !== curr.prompt) return `Scene ${curr.scene_id}: prompt changed`;
        }

        return 'Scene modified';
    }

    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const historyBadge = document.getElementById('history-badge');

        if (undoBtn) undoBtn.disabled = !State.canUndo();
        if (redoBtn) redoBtn.disabled = !State.canRedo();

        if (historyBadge) {
            const historyIndex = State.get('historyIndex');
            historyBadge.textContent = historyIndex;
            historyBadge.classList.toggle('has-history', historyIndex > 0);
        }
    }

    restoreFromBackup() {
        if (State.restoreFromBackup()) {
            showToast('Restored from backup', 'success');
            this.runValidation();
        } else {
            showToast('No backup found', 'warning');
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    window.app = app;
});
