/**
 * Video Editor - Stage 2
 * Receives staged timeline data from Stage 1 and provides video editing capabilities
 */

import { SCENE_COLORS, formatTimestamp, showToast } from './utils.js';
import { CanvasPreview } from './preview.js';
import { ExportAPI, EXPORT_PROFILES, prepareExportData, validateExportData } from './export-api.js';

// Export API instance
const exportAPI = new ExportAPI();

/**
 * Format seconds to HH:MM:SS:MS timecode (e.g. 00:01:19:04)
 */
function formatTimecode(seconds) {
    if (isNaN(seconds) || seconds == null || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(ms).padStart(2, '0')}`;
}

// Scene type icons - flat outline style SVG icons
const SCENE_ICONS = {
    hook: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>
    </svg>`,
    buildup: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="4" y="14" width="4" height="6" rx="1"/><rect x="10" y="10" width="4" height="10" rx="1"/><rect x="16" y="6" width="4" height="14" rx="1"/>
    </svg>`,
    text: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M6 4h12M12 4v16M8 20h8"/>
    </svg>`,
    peak: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 4l2.5 5h5.5l-4.5 3.5 1.7 5.5-5.2-3.5-5.2 3.5 1.7-5.5L4 9h5.5z"/>
    </svg>`,
    transition: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
    </svg>`,
    cta: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="7" width="18" height="10" rx="2"/><path d="M9 12h6M12 9v6"/>
    </svg>`,
    speaker: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-6 7-6s7 2 7 6"/>
    </svg>`,
    final_statement: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>
    </svg>`,
    default: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M20 16l-5-5-7 9"/>
    </svg>`
};

// LocalStorage keys
const STORAGE_KEYS = {
    ZOOM_LEVEL: 'editor_zoom_level',
    TIMELINE_HEIGHT: 'editor_timeline_height',
    LOOP_STATE: 'editor_loop_state',
    PROJECT_EDITS: 'project_edits_',  // + projectId
    PROJECT_HISTORY: 'project_history_'  // + projectId
};

// Maximum history entries per project
const MAX_HISTORY_ENTRIES = 50;

// Load saved settings from localStorage
function loadSavedSettings() {
    const savedZoom = localStorage.getItem(STORAGE_KEYS.ZOOM_LEVEL);
    const savedLoop = localStorage.getItem(STORAGE_KEYS.LOOP_STATE);

    return {
        zoomLevel: savedZoom ? parseFloat(savedZoom) : 1,
        isLooping: savedLoop === 'true',
        timelineHeight: parseInt(localStorage.getItem(STORAGE_KEYS.TIMELINE_HEIGHT)) || 180
    };
}

const savedSettings = loadSavedSettings();

// Editor State
const EditorState = {
    project: null,
    scenes: [],
    originalScenes: [],  // Original scenes for comparison/reset
    selectedScene: null,
    mediaFolder: null,
    mediaFiles: new Map(),
    playbackPosition: 0,
    isPlaying: false,
    isLooping: savedSettings.isLooping,  // Loop playback mode - restored from localStorage
    zoomLevel: savedSettings.zoomLevel,   // Restored from localStorage
    timelineHeight: savedSettings.timelineHeight, // Restored from localStorage
    pixelsPerSecond: 20,
    preview: null,  // CanvasPreview instance
    audio: null,    // Audio info
    audioElement: null,  // HTML Audio element for playback
    isMuted: false,  // Audio mute state
    editHistory: [],  // History of edits for undo
    historyIndex: -1,  // Current position in history (-1 = no history)
    sceneErrors: new Map(),  // Map of sceneId -> [error messages]
    savedAudioSettings: null,  // Saved audio settings from localStorage
    captionData: null,      // Caption data { captions: [], style: {} }
    captionsEnabled: false, // Whether caption track is visible
    selectedExportProfile: 'yt_shorts',  // Export profile ID
    bgMusic: null,          // { file, path, duration, volume, duckingEnabled, duckingLevel, fadeIn, fadeOut, loop }
    bgMusicElement: null,   // HTML Audio element for bgmusic playback
    disabledTracks: new Set(), // Keep track of which tracks are disabled
    storageEnabled: localStorage.getItem('editor_storage_enabled') !== 'false', // localStorage toggle (default ON)
    sessionStorageEnabled: localStorage.getItem('editor_session_storage_enabled') !== 'false' // sessionStorage toggle (default ON)
};

// ============================================================
// Edit History & Persistence System
// ============================================================

/**
 * Get localStorage key for project edits
 */
function getProjectEditsKey(projectId) {
    return STORAGE_KEYS.PROJECT_EDITS + projectId;
}

/**
 * Get localStorage key for project history
 */
function getProjectHistoryKey(projectId) {
    return STORAGE_KEYS.PROJECT_HISTORY + projectId;
}

/**
 * Save current scene edits to localStorage
 */
function saveProjectEdits() {
    if (!EditorState.project?.id || !EditorState.storageEnabled) return;

    const edits = EditorState.scenes.map(scene => ({
        id: scene.id,
        duration: scene.duration,
        visual_fx: scene.visual_fx,
        text_content: scene.text_content,
        text_color: scene.text_color,
        text_size: scene.text_size,
        font_family: scene.font_family,
        font_style: scene.font_style,
        text_align: scene.text_align,
        vertical_align: scene.vertical_align,
        text_x: scene.text_x,
        text_y: scene.text_y
    }));

    // Include audio settings if audio is loaded
    const audioSettings = EditorState.audio?.loaded ? {
        trimmedDuration: EditorState.audio.trimmedDuration,
        fileName: EditorState.audio.fileName
    } : null;

    const data = {
        projectId: EditorState.project.id,
        savedAt: new Date().toISOString(),
        edits: edits,
        audio: audioSettings
    };

    try {
        localStorage.setItem(getProjectEditsKey(EditorState.project.id), JSON.stringify(data));
        console.log('Project edits saved to localStorage');
    } catch (e) {
        console.warn('Failed to save project edits:', e);
    }
}

/**
 * Load saved edits from localStorage and apply to scenes
 */
function loadProjectEdits() {
    if (!EditorState.project?.id) return false;

    try {
        const saved = localStorage.getItem(getProjectEditsKey(EditorState.project.id));
        if (!saved) return false;

        const data = JSON.parse(saved);
        if (data.projectId !== EditorState.project.id) return false;

        // Apply saved edits to scenes
        let appliedCount = 0;
        for (const edit of data.edits) {
            const scene = EditorState.scenes.find(s => s.id === edit.id);
            if (scene) {
                if (edit.duration !== undefined) scene.duration = edit.duration;
                if (edit.visual_fx !== undefined) scene.visual_fx = edit.visual_fx;
                if (edit.text_content !== undefined) scene.text_content = edit.text_content;
                if (edit.text_color !== undefined) scene.text_color = edit.text_color;
                if (edit.text_size !== undefined) scene.text_size = edit.text_size;
                if (edit.font_family !== undefined) scene.font_family = edit.font_family;
                if (edit.font_style !== undefined) scene.font_style = edit.font_style;
                if (edit.text_align !== undefined) scene.text_align = edit.text_align;
                if (edit.vertical_align !== undefined) scene.vertical_align = edit.vertical_align;
                if (edit.text_x !== undefined) scene.text_x = edit.text_x;
                if (edit.text_y !== undefined) scene.text_y = edit.text_y;
                appliedCount++;
            }
        }

        // Store saved audio settings to apply after audio loads
        if (data.audio) {
            EditorState.savedAudioSettings = data.audio;
            console.log('Saved audio settings found:', data.audio);
        }

        if (appliedCount > 0) {
            console.log(`Loaded ${appliedCount} saved edits from localStorage`);
            showToast(`Restored ${appliedCount} saved edits`, 'info');
            return true;
        }
    } catch (e) {
        console.warn('Failed to load project edits:', e);
    }
    return false;
}

/**
 * Record an edit action to history
 */
function recordEdit(action, sceneId, field, oldValue, newValue) {
    if (!EditorState.project?.id) return;

    const historyEntry = {
        timestamp: Date.now(),
        action: action,
        sceneId: sceneId,
        field: field,
        oldValue: oldValue,
        newValue: newValue
    };

    // If we're not at the end of history, truncate future entries
    if (EditorState.historyIndex < EditorState.editHistory.length - 1) {
        EditorState.editHistory = EditorState.editHistory.slice(0, EditorState.historyIndex + 1);
    }

    // Add new entry
    EditorState.editHistory.push(historyEntry);
    EditorState.historyIndex = EditorState.editHistory.length - 1;

    // Limit history size
    if (EditorState.editHistory.length > MAX_HISTORY_ENTRIES) {
        EditorState.editHistory.shift();
        EditorState.historyIndex--;
    }

    // Save to localStorage
    saveEditHistory();
    saveProjectEdits();

    // Update undo button state
    updateUndoButton();

    // Re-validate scenes and update error indicators
    validateScenes();
    applySceneErrorStyles();
}

/**
 * Save edit history to localStorage
 */
function saveEditHistory() {
    if (!EditorState.project?.id || !EditorState.storageEnabled) return;

    try {
        const data = {
            projectId: EditorState.project.id,
            history: EditorState.editHistory,
            historyIndex: EditorState.historyIndex
        };
        localStorage.setItem(getProjectHistoryKey(EditorState.project.id), JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save edit history:', e);
    }
}

/**
 * Load edit history from localStorage
 */
function loadEditHistory() {
    if (!EditorState.project?.id) return;

    try {
        const saved = localStorage.getItem(getProjectHistoryKey(EditorState.project.id));
        if (!saved) return;

        const data = JSON.parse(saved);
        if (data.projectId === EditorState.project.id) {
            EditorState.editHistory = data.history || [];
            EditorState.historyIndex = data.historyIndex ?? -1;
            updateUndoButton();
        }
    } catch (e) {
        console.warn('Failed to load edit history:', e);
    }
}

/**
 * Undo the last edit
 */
function undoEdit() {
    if (EditorState.historyIndex < 0 || EditorState.editHistory.length === 0) {
        showToast('Nothing to undo', 'info');
        return;
    }

    const entry = EditorState.editHistory[EditorState.historyIndex];

    // Handle audio edits
    if (entry.sceneId === 'audio') {
        if (entry.field === 'trimmedDuration' && EditorState.audio) {
            EditorState.audio.trimmedDuration = entry.oldValue;
            recalculateDuration();
            renderAudioTrack();
            renderTimeRuler();
            if (EditorState.preview) {
                EditorState.preview.setDuration(getTotalDuration());
            }
        }
        showToast(`Undo: ${entry.action}`, 'info');
    } else {
        // Handle scene edits
        const scene = EditorState.scenes.find(s => s.id === entry.sceneId);

        if (scene && entry.field) {
            // Revert the change
            scene[entry.field] = entry.oldValue;

            // Update UI
            if (entry.field === 'duration') {
                recalculateDuration();
                renderTimeline();
            }
            if (EditorState.selectedScene?.id === entry.sceneId) {
                renderSceneProperties();
            }
            if (EditorState.preview) {
                EditorState.preview.seek(EditorState.playbackPosition);
            }

            showToast(`Undo: ${entry.action}`, 'info');
        }
    }

    EditorState.historyIndex--;
    saveEditHistory();
    saveProjectEdits();

    // Re-validate scenes and update error indicators
    validateScenes();
    applySceneErrorStyles();
    updateUndoButton();
}

/**
 * Redo the last undone edit
 */
function redoEdit() {
    if (EditorState.historyIndex >= EditorState.editHistory.length - 1) {
        showToast('Nothing to redo', 'info');
        return;
    }

    EditorState.historyIndex++;
    const entry = EditorState.editHistory[EditorState.historyIndex];

    // Handle audio edits
    if (entry.sceneId === 'audio') {
        if (entry.field === 'trimmedDuration' && EditorState.audio) {
            EditorState.audio.trimmedDuration = entry.newValue;
            recalculateDuration();
            renderAudioTrack();
            renderTimeRuler();
            if (EditorState.preview) {
                EditorState.preview.setDuration(getTotalDuration());
            }
        }
        showToast(`Redo: ${entry.action}`, 'info');
    } else {
        // Handle scene edits
        const scene = EditorState.scenes.find(s => s.id === entry.sceneId);

        if (scene && entry.field) {
            // Apply the change again
            scene[entry.field] = entry.newValue;

            // Update UI
            if (entry.field === 'duration') {
                recalculateDuration();
                renderTimeline();
            }
            if (EditorState.selectedScene?.id === entry.sceneId) {
                renderSceneProperties();
            }
            if (EditorState.preview) {
                EditorState.preview.seek(EditorState.playbackPosition);
            }

            showToast(`Redo: ${entry.action}`, 'info');
        }
    }

    saveEditHistory();
    saveProjectEdits();

    // Re-validate scenes and update error indicators
    validateScenes();
    applySceneErrorStyles();
    updateUndoButton();
}

/**
 * Update undo/redo button states
 */
function updateUndoButton() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const historyBadge = document.getElementById('history-badge');

    if (undoBtn) {
        undoBtn.disabled = EditorState.historyIndex < 0;
        undoBtn.title = EditorState.historyIndex >= 0
            ? `Undo: ${EditorState.editHistory[EditorState.historyIndex]?.action || ''}`
            : 'Nothing to undo';
    }

    if (redoBtn) {
        redoBtn.disabled = EditorState.historyIndex >= EditorState.editHistory.length - 1;
        redoBtn.title = EditorState.historyIndex < EditorState.editHistory.length - 1
            ? `Redo: ${EditorState.editHistory[EditorState.historyIndex + 1]?.action || ''}`
            : 'Nothing to redo';
    }

    // Update history badge
    if (historyBadge) {
        const count = EditorState.historyIndex + 1;
        historyBadge.textContent = count;
        historyBadge.classList.toggle('has-history', count > 0);
    }
}

/**
 * Setup history dropdown functionality
 */
function setupHistoryDropdown() {
    const historyBtn = document.getElementById('history-btn');
    const historyDropdown = document.getElementById('history-dropdown');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    if (!historyBtn || !historyDropdown) return;

    // Toggle dropdown
    historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = historyDropdown.classList.contains('show');
        if (isOpen) {
            historyDropdown.classList.remove('show');
        } else {
            renderHistoryList();
            historyDropdown.classList.add('show');
        }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!historyDropdown.contains(e.target) && !historyBtn.contains(e.target)) {
            historyDropdown.classList.remove('show');
        }
    });

    // Clear all history
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Clear all edit history? This cannot be undone.')) {
                clearProjectEdits();
                renderHistoryList();
            }
        });
    }
}

/**
 * Render the history list in the dropdown
 */
function renderHistoryList() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;

    const history = EditorState.editHistory;
    const historyIndex = EditorState.historyIndex;

    if (!history || history.length === 0) {
        historyList.innerHTML = '<li class="history-empty">No history yet</li>';
        return;
    }

    // Render history items (most recent first)
    historyList.innerHTML = history.map((entry, index) => {
        const isCurrent = index === historyIndex;
        const label = entry.action || 'Unknown change';
        const meta = entry.sceneId ? `Scene ${entry.sceneId}` : 'Project';

        return `
            <li class="history-item ${isCurrent ? 'current' : ''}" data-index="${index}">
                <span class="history-item-index">${index + 1}</span>
                <div class="history-item-info">
                    <div class="history-item-label">${label}</div>
                    <div class="history-item-meta">${meta}</div>
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

    // Add click handlers for jumping to history state
    historyList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.history-item-delete')) return;
            const index = parseInt(item.dataset.index);
            jumpToHistoryState(index);
            renderHistoryList();
        });
    });

    // Add click handlers for delete buttons
    historyList.querySelectorAll('.history-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            deleteHistoryAt(index);
            renderHistoryList();
        });
    });
}

/**
 * Jump to a specific history state
 */
function jumpToHistoryState(targetIndex) {
    if (targetIndex < 0 || targetIndex >= EditorState.editHistory.length) return;

    // Apply all states from current to target
    if (targetIndex < EditorState.historyIndex) {
        // Going back - undo from current to target
        while (EditorState.historyIndex > targetIndex) {
            const entry = EditorState.editHistory[EditorState.historyIndex];
            applyHistoryEntry(entry, true); // true = undo (use oldValue)
            EditorState.historyIndex--;
        }
    } else if (targetIndex > EditorState.historyIndex) {
        // Going forward - redo from current to target
        while (EditorState.historyIndex < targetIndex) {
            EditorState.historyIndex++;
            const entry = EditorState.editHistory[EditorState.historyIndex];
            applyHistoryEntry(entry, false); // false = redo (use newValue)
        }
    }

    saveEditHistory();
    updateUndoButton();
    renderTimeline();
    showToast(`Jumped to state ${targetIndex + 1}`, 'info');
}

/**
 * Apply a history entry (for undo/redo operations)
 */
function applyHistoryEntry(entry, isUndo) {
    const scene = EditorState.scenes.find(s => s.id === entry.sceneId);
    if (!scene) return;

    const value = isUndo ? entry.oldValue : entry.newValue;
    scene[entry.field] = value;
}

/**
 * Delete a specific history entry
 */
function deleteHistoryAt(index) {
    if (index < 0 || index >= EditorState.editHistory.length) return;

    // Remove the entry
    EditorState.editHistory.splice(index, 1);

    // Adjust historyIndex if needed
    if (EditorState.historyIndex >= index) {
        EditorState.historyIndex = Math.max(-1, EditorState.historyIndex - 1);
    }

    saveEditHistory();
    updateUndoButton();
    showToast('History entry removed', 'info');
}

/**
 * Clear all saved edits for current project
 */
function clearProjectEdits() {
    if (!EditorState.project?.id) return;

    localStorage.removeItem(getProjectEditsKey(EditorState.project.id));
    localStorage.removeItem(getProjectHistoryKey(EditorState.project.id));
    EditorState.editHistory = [];
    EditorState.historyIndex = -1;
    updateUndoButton();
    showToast('Cleared saved edits', 'info');
}

// ============================================================
// Scene Error Validation
// ============================================================

/**
 * Validate all scenes and track errors
 */
function validateScenes() {
    EditorState.sceneErrors.clear();

    EditorState.scenes.forEach(scene => {
        const errors = [];

        // Check for missing media (image scenes should have media)
        if (!['text', 'cta'].includes(scene.type)) {
            if (!scene.mediaUrl && !scene.mediaFile) {
                errors.push('Image not found');
            }
        }

        // Check for text scenes without content
        if (['text', 'cta'].includes(scene.type)) {
            if (!scene.text_content || !scene.text_content.trim()) {
                errors.push('Missing text content');
            }
        }

        // Check for zero or negative duration
        if (scene.duration <= 0) {
            errors.push('Invalid duration');
        }

        // Check for very short duration (less than 0.5s)
        if (scene.duration > 0 && scene.duration < 0.5) {
            errors.push('Duration too short');
        }

        if (errors.length > 0) {
            EditorState.sceneErrors.set(scene.id, errors);
        }
    });

    updateErrorIndicator();
}

/**
 * Update the error indicator in the header
 */
function updateErrorIndicator() {
    const errorIndicator = document.getElementById('error-indicator');
    const errorCount = document.getElementById('error-count');

    if (!errorIndicator || !errorCount) return;

    const errorTotal = EditorState.sceneErrors.size;

    if (errorTotal > 0) {
        errorIndicator.classList.remove('hidden');
        errorCount.textContent = errorTotal;
        errorIndicator.title = `${errorTotal} scene${errorTotal > 1 ? 's' : ''} with errors`;
    } else {
        errorIndicator.classList.add('hidden');
    }
}

/**
 * Apply error styling to scene clips in timeline
 */
function applySceneErrorStyles() {
    if (!elements.videoTrack) return;

    elements.videoTrack.querySelectorAll('.scene-clip').forEach(clip => {
        const sceneId = parseInt(clip.dataset.id);
        const errors = EditorState.sceneErrors.get(sceneId);

        if (errors && errors.length > 0) {
            clip.classList.add('has-error');
            clip.title = `${clip.title}\n⚠ ${errors.join(', ')}`;
        } else {
            clip.classList.remove('has-error');
        }
    });
}

/**
 * Setup error dropdown toggle and interactions
 */
function setupErrorDropdown() {
    const errorIndicator = document.getElementById('error-indicator');
    const errorDropdown = document.getElementById('error-dropdown');

    if (!errorIndicator || !errorDropdown) return;

    // Toggle dropdown on indicator click
    errorIndicator.addEventListener('click', (e) => {
        e.stopPropagation();
        if (errorDropdown.classList.contains('show')) {
            errorDropdown.classList.remove('show');
        } else {
            renderErrorList();
            errorDropdown.classList.add('show');
        }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!errorDropdown.contains(e.target) && !errorIndicator.contains(e.target)) {
            errorDropdown.classList.remove('show');
        }
    });
}

/**
 * Render the error list in the dropdown
 */
function renderErrorList() {
    const errorList = document.getElementById('error-list');
    if (!errorList) return;

    if (EditorState.sceneErrors.size === 0) {
        errorList.innerHTML = '<li class="error-empty">No errors</li>';
        return;
    }

    let html = '';
    EditorState.sceneErrors.forEach((errors, sceneId) => {
        const scene = EditorState.scenes.find(s => s.id === sceneId);
        const sceneLabel = scene ? `Scene ${scene.id}` : `Scene ${sceneId}`;
        const sceneType = scene?.type || 'unknown';

        errors.forEach(error => {
            html += `
                <li class="error-item" data-scene-id="${sceneId}">
                    <span class="error-item-scene">${sceneLabel}</span>
                    <div class="error-item-info">
                        <div class="error-item-type">${sceneType}</div>
                        <div class="error-item-message">${error}</div>
                    </div>
                </li>
            `;
        });
    });

    errorList.innerHTML = html;

    // Add click handlers to navigate to scene
    errorList.querySelectorAll('.error-item').forEach(item => {
        item.addEventListener('click', () => {
            const sceneId = parseInt(item.dataset.sceneId);
            selectScene(sceneId);
            const clip = elements.videoTrack?.querySelector(`.scene-clip[data-id="${sceneId}"]`);
            if (clip) {
                clip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
            // Close dropdown after selection
            document.getElementById('error-dropdown')?.classList.remove('show');
        });
    });
}

// ============================================================
// Timeline Calculation Helpers - Single Source of Truth
// ============================================================

/**
 * Get the total duration of all scenes
 */
function getScenesDuration() {
    return EditorState.scenes.reduce((sum, s) => sum + s.duration, 0);
}

/**
 * Get the total project duration (max of scenes and audio)
 */
function getTotalDuration() {
    const scenesDuration = getScenesDuration();

    // Use trimmed duration if set, otherwise use full audio duration
    const audioDuration = EditorState.audio?.loaded
        ? (EditorState.audio.trimmedDuration || EditorState.audio.duration)
        : 0;

    const bgMusicDuration = EditorState.bgMusic?.duration || 0;

    let captionsDuration = 0;
    if (EditorState.captionsEnabled && EditorState.captionData?.captions?.length > 0) {
        const lastCaption = EditorState.captionData.captions[EditorState.captionData.captions.length - 1];
        captionsDuration = lastCaption.end || 0;
    }

    return Math.max(scenesDuration, audioDuration, bgMusicDuration, captionsDuration);
}

/**
 * Convert time (seconds) to pixel position on timeline
 */
function timeToPixels(time) {
    return time * EditorState.pixelsPerSecond * EditorState.zoomLevel;
}

/**
 * Convert pixel position to time (seconds)
 */
function pixelsToTime(pixels) {
    return pixels / (EditorState.pixelsPerSecond * EditorState.zoomLevel);
}

/**
 * Get the start time of a scene by its index
 */
function getSceneStartTime(sceneIndex) {
    let startTime = 0;
    for (let i = 0; i < sceneIndex && i < EditorState.scenes.length; i++) {
        startTime += EditorState.scenes[i].duration;
    }
    return startTime;
}

/**
 * Get the scene at a given time
 */
function getSceneAtTime(time) {
    let accumulated = 0;
    for (let i = 0; i < EditorState.scenes.length; i++) {
        const scene = EditorState.scenes[i];
        if (time >= accumulated && time < accumulated + scene.duration) {
            return {
                scene,
                index: i,
                startTime: accumulated,
                endTime: accumulated + scene.duration,
                localTime: time - accumulated,
                progress: (time - accumulated) / scene.duration
            };
        }
        accumulated += scene.duration;
    }
    return null; // Time is past all scenes (in audio-only region)
}

/**
 * Get the pixel position of a scene on the timeline
 */
function getScenePixelPosition(sceneIndex) {
    const startTime = getSceneStartTime(sceneIndex);
    return timeToPixels(startTime);
}

/**
 * Get the pixel width of a scene
 */
function getScenePixelWidth(scene) {
    return timeToPixels(scene.duration);
}

/**
 * Track base offset (header + padding)
 */
const TRACK_BASE_OFFSET = 40; // 36px header + 4px padding

// DOM Elements
const elements = {
    projectName: document.getElementById('project-name'),
    noDataOverlay: document.getElementById('no-data-overlay'),
    timelineTracks: document.getElementById('timeline-tracks'),
    videoTrack: document.getElementById('video-track'),
    textTrack: document.getElementById('text-track'),
    captionTrack: document.getElementById('caption-track'),
    captionTrackRow: document.getElementById('caption-track-row'),
    audioTrack: document.getElementById('audio-track'),
    previewCanvas: document.getElementById('preview-canvas'),
    previewPlaceholder: document.getElementById('preview-placeholder'),
    currentTime: document.getElementById('current-time'),
    totalTime: document.getElementById('total-time'),
    timeScrubber: document.getElementById('time-scrubber'),
    playBtn: document.getElementById('play-btn'),
    loopBtn: document.getElementById('loop-btn'),  // Loop toggle button
    volumeBtn: document.getElementById('volume-btn'),  // Volume/mute button
    fullscreenBtn: document.getElementById('fullscreen-btn'),  // Fullscreen toggle
    previewPanel: document.getElementById('preview-panel'),  // Preview panel for fullscreen
    selectFolderBtn: document.getElementById('select-folder'),
    randomizeMediaBtn: document.getElementById('randomize-media'),
    mediaStatus: document.getElementById('media-status'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    zoomLevel: document.getElementById('zoom-level'),
    infoScenes: document.getElementById('info-scenes'),
    infoDuration: document.getElementById('info-duration'),
    sceneProperties: document.getElementById('scene-properties'),
    previewJsonBtn: document.getElementById('preview-json'),
    exportBtn: document.getElementById('export-mp4'),
    timeRuler: document.getElementById('time-ruler'),
    timelineResizeHandle: document.getElementById('timeline-resize-handle'),
    timelineHeaderMarker: document.getElementById('timeline-header-marker'),
    headerMarkerIndicator: document.querySelector('.header-marker-indicator'),
    headerMarkerTrail: document.querySelector('.header-marker-trail'),
    editorLayout: document.querySelector('.editor-layout'),
    timelinePanel: document.querySelector('.timeline-panel'),
    // Export progress modal
    exportProgressModal: document.getElementById('export-progress-modal'),
    exportProgressTitle: document.getElementById('export-progress-title'),
    exportProgressBar: document.getElementById('export-progress-bar'),
    exportProgressPercent: document.getElementById('export-progress-percent'),
    exportProgressMessage: document.getElementById('export-progress-message'),
    cancelExportBtn: document.getElementById('cancel-export'),
    previewExportBtn: document.getElementById('preview-export'),
    downloadExportBtn: document.getElementById('download-export')
};

// ---------------------------------------------------------------------------
// Font Registry — loads custom + system fonts from backend
// ---------------------------------------------------------------------------
let _fontRegistry = [];  // [{family, source, variants:{variant: url}}]

async function loadFontRegistry() {
    try {
        const res = await fetch('/api/fonts');
        if (!res.ok) throw new Error(`Font API ${res.status}`);
        _fontRegistry = await res.json();
        console.log(`Font registry loaded: ${_fontRegistry.length} fonts`);

        // Inject @font-face rules for custom fonts
        const style = document.createElement('style');
        style.id = 'custom-font-faces';
        const rules = [];
        for (const font of _fontRegistry) {
            if (font.source !== 'custom') continue;
            for (const [variant, url] of Object.entries(font.variants)) {
                const weight = variant.includes('bold') || variant === 'black' || variant === 'extrabold' ? 'bold'
                    : variant.includes('light') || variant === 'thin' || variant === 'extralight' ? '300'
                        : variant === 'medium' ? '500'
                            : variant === 'semibold' ? '600'
                                : 'normal';
                const fontStyle = variant.includes('italic') ? 'italic' : 'normal';
                rules.push(`@font-face {
  font-family: '${font.family}';
  src: url('${url}') format('${url.endsWith('.otf') ? 'opentype' : 'truetype'}');
  font-weight: ${weight};
  font-style: ${fontStyle};
  font-display: swap;
}`);
            }
        }
        style.textContent = rules.join('\n');
        document.head.appendChild(style);

        // Wait for fonts to be ready for canvas rendering
        if (rules.length > 0) {
            await document.fonts.ready;
            console.log(`Custom @font-face rules injected: ${rules.length}`);
        }
    } catch (err) {
        console.warn('Failed to load font registry:', err);
    }
}

/**
 * Build <option> elements for a font <select>, grouped by custom/system.
 * Each option is styled in its own font for preview.
 */
function buildFontOptions(selectEl, selectedFamily) {
    selectEl.innerHTML = '';
    const custom = _fontRegistry.filter(f => f.source === 'custom');
    const system = _fontRegistry.filter(f => f.source === 'system');

    if (custom.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'Custom Fonts';
        for (const f of custom) {
            const opt = document.createElement('option');
            opt.value = f.family;
            opt.textContent = f.family;
            opt.style.fontFamily = `'${f.family}', sans-serif`;
            if (f.family === selectedFamily) opt.selected = true;
            grp.appendChild(opt);
        }
        selectEl.appendChild(grp);
    }

    if (system.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'System Fonts';
        for (const f of system) {
            const opt = document.createElement('option');
            opt.value = f.family;
            opt.textContent = f.family;
            opt.style.fontFamily = `'${f.family}', sans-serif`;
            if (f.family === selectedFamily) opt.selected = true;
            grp.appendChild(opt);
        }
        selectEl.appendChild(grp);
    }
}

/**
 * Initialize the editor with sequential loading
 */
async function init() {
    console.log('Video Editor initializing...');

    // Check for staged data FIRST before showing any loading UI
    const stagedData = sessionStorage.getItem('staged_timeline');
    if (!stagedData) {
        // No data - show overlay immediately without any loading animations
        showNoDataOverlay();
        return;
    }

    let data;
    try {
        data = JSON.parse(stagedData);
    } catch (error) {
        console.error('Failed to parse staged data:', error);
        showNoDataOverlay();
        return;
    }

    // Data exists - hide no-data overlay immediately (in case browser cached old HTML)
    hideNoDataOverlay();

    // Show single loading overlay that stays until everything is ready
    showLoadingOverlay('Initializing editor...');

    // Load font registry FIRST (custom + system fonts)
    updateLoadingOverlay('Loading fonts...');
    await loadFontRegistry();

    // Setup UI now that fonts and other dependencies are ready
    setupEventListeners();
    applySavedSettings();

    // Load project data
    updateLoadingOverlay('Loading project data...');
    loadProjectData(data);

    // Load assets with progress
    await loadProjectMediaWithProgress();

    // Load captions from localStorage if available
    _loadCaptionsFromStorage();

    // Listen for captions sent from parent studio via postMessage
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'load-captions' && e.data.data) {
            _receiveCaptionData(e.data.data);
        }
    });

    // Hide loading overlay and show editor
    await hideLoadingOverlay();
    showToast('Editor ready', 'success');

    console.log('Video Editor initialized');
}

/**
 * Sleep utility for sequential loading
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Load project data without media (fast)
 */
function loadProjectData(data) {
    EditorState.project = {
        id: data.project_id,
        name: data.project_name,
        totalDuration: data.total_duration,
        sceneCount: data.scene_count,
        stagedAt: data.staged_at
    };

    EditorState.scenes = data.scenes.map(scene => ({
        ...scene,
        id: scene.id || scene.scene_id,
        mediaLoaded: !!scene.image_url,
        mediaUrl: scene.image_url || null
    }));

    // Store original scenes for reset functionality
    EditorState.originalScenes = JSON.parse(JSON.stringify(EditorState.scenes));

    // Load saved edits from localStorage (if any)
    loadProjectEdits();

    // Load edit history from localStorage
    loadEditHistory();

    // Initialize Canvas Preview
    if (elements.previewCanvas) {
        EditorState.preview = new CanvasPreview(elements.previewCanvas, {
            onTimeUpdate: (time) => {
                EditorState.playbackPosition = time;
                updateTimeScrubber();
                updatePlayhead();

                if (EditorState.isPlaying && elements.timelineTracks) {
                    scrollTimelineToTime(time);
                }
            },
            onPlaybackEnd: () => {
                if (EditorState.isLooping) {
                    EditorState.playbackPosition = 0;
                    if (EditorState.audioElement && EditorState.audio?.loaded) {
                        EditorState.audioElement.currentTime = 0;
                        EditorState.audioElement.play().catch(e => console.warn('Loop audio play failed:', e));
                    }
                    if (EditorState.preview) {
                        EditorState.preview.seek(0);
                        EditorState.preview.play();
                        if (EditorState.audioElement && EditorState.audio?.loaded) {
                            EditorState.preview.setTimeSource(() => EditorState.audioElement.currentTime);
                        }
                    }
                    if (elements.timelineTracks) {
                        elements.timelineTracks.scrollLeft = 0;
                    }
                    updatePlayhead();
                    updateTimeScrubber();
                    return;
                }

                EditorState.isPlaying = false;
                if (EditorState.audioElement) {
                    EditorState.audioElement.pause();
                    EditorState.audioElement.currentTime = 0;
                }
                if (EditorState.preview) {
                    EditorState.preview.setTimeSource(null);
                }
                EditorState.playbackPosition = 0;
                if (elements.timelineTracks) {
                    elements.timelineTracks.scrollLeft = 0;
                }
                updatePlayhead();
                updateTimeScrubber();
                updatePlayButton();
            }
        });

        EditorState.preview.setProjectPath(`working-assets/${EditorState.project.id}`);
        EditorState.preview.setScenes(EditorState.scenes);
        EditorState.preview.render();

        EditorState.preview.enableTextDrag((x, y, scene) => {
            if (!EditorState._textDragDebounce) {
                EditorState._textDragDebounce = setTimeout(() => {
                    recordEdit(`Move text position (Scene ${scene.id})`, scene.id, 'text_position', null, { x, y });
                    saveProjectEdits();
                    EditorState._textDragDebounce = null;
                }, 500);
            }
        });
    }

    EditorState.playbackPosition = 0;

    // Update UI
    updateProjectInfo();
    renderTimeline();
    renderMediaGrid();
    renderTimeRuler();
    updateTimeScrubber();
    updatePlayhead();

    // Load audio — use staged alignment URL when available
    loadDefaultAudio(data);
}

/**
 * Load project media with progress tracking.
 * Uses image_url from staged data when available, falls back to working-assets/ probing.
 */
async function loadProjectMediaWithProgress() {
    const projectId = EditorState.project?.id;
    if (!projectId) {
        console.warn('No project ID available for auto-loading media');
        return;
    }

    const visualScenes = EditorState.scenes.filter(s => s.type !== 'text');
    const totalScenes = visualScenes.length;
    let loadedCount = 0;

    updateLoadingOverlay(`Loading assets (0/${totalScenes})...`);

    for (let i = 0; i < EditorState.scenes.length; i++) {
        const scene = EditorState.scenes[i];
        const sceneNumber = i;

        if (scene.type === 'text') continue;

        // If image_url was set from staged data, verify it loads
        if (scene.mediaUrl) {
            updateLoadingOverlay(`Loading scene ${sceneNumber} (${loadedCount}/${totalScenes})...`);
            const isVideo = isVideoFile(scene.mediaUrl);
            const exists = isVideo
                ? await checkMediaExists(scene.mediaUrl)
                : await checkImageExists(scene.mediaUrl);
            if (exists) {
                scene.isVideo = isVideo;
                if (isVideo) {
                    const meta = await getVideoMeta(scene.mediaUrl);
                    if (meta) {
                        scene.videoDuration = meta.duration;
                        scene.videoThumb = meta.thumbDataUrl;
                        console.log(`Scene ${sceneNumber}: video src=${meta.duration.toFixed(1)}s, scene trimmed to ${scene.duration}s`);
                    }
                }
                loadedCount++;
                console.log(`Scene ${sceneNumber}: loaded from mediaUrl (${isVideo ? 'video' : 'image'}): ${scene.mediaUrl}`);
                updateSceneClipThumb(scene.id, scene.mediaUrl, isVideo, scene.videoThumb);
                await sleep(30);
                continue;
            }
            // mediaUrl didn't load, clear and fall through to probing
            console.warn(`Scene ${sceneNumber}: mediaUrl failed (${scene.mediaUrl}), trying fallback`);
            scene.mediaUrl = null;
            scene.mediaLoaded = false;
        }

        // Fallback: probe working-assets/{project_id}/ for images then videos
        updateLoadingOverlay(`Loading scene ${sceneNumber} (${loadedCount}/${totalScenes})...`);
        const basePath = `working-assets/${projectId}/`;
        const allExtensions = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

        const pathsToTry = [];
        for (const ext of allExtensions) {
            pathsToTry.push({ path: `${basePath}${sceneNumber}.${ext}`, filename: `${sceneNumber}.${ext}` });
        }
        if (scene.image) {
            pathsToTry.push({ path: `${basePath}${scene.image}`, filename: scene.image });
            const bareFilename = scene.image.split('/').pop();
            if (bareFilename !== scene.image) {
                pathsToTry.push({ path: `${basePath}${bareFilename}`, filename: bareFilename });
            }
        }

        let found = false;
        for (const { path: mediaPath, filename } of pathsToTry) {
            try {
                const isVideo = isVideoFile(mediaPath);
                const exists = isVideo
                    ? await checkMediaExists(mediaPath)
                    : await checkImageExists(mediaPath);
                if (exists) {
                    scene.mediaUrl = mediaPath;
                    scene.mediaLoaded = true;
                    scene.isVideo = isVideo;
                    scene.image = filename;
                    if (isVideo) {
                        const meta = await getVideoMeta(mediaPath);
                        if (meta) {
                            scene.videoDuration = meta.duration;
                            scene.videoThumb = meta.thumbDataUrl;
                            console.log(`Scene ${sceneNumber}: video src=${meta.duration.toFixed(1)}s, scene trimmed to ${scene.duration}s`);
                        }
                    }
                    loadedCount++;
                    found = true;
                    console.log(`Scene ${sceneNumber}: fallback loaded ${isVideo ? 'video' : 'image'} ${mediaPath}`);
                    updateSceneClipThumb(scene.id, mediaPath, isVideo, scene.videoThumb);
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (!found) {
            console.warn(`Scene ${sceneNumber} (id: ${scene.id}): No media found`);
        }

        await sleep(50);
    }

    updateLoadingOverlay(`Loaded ${loadedCount}/${totalScenes} assets. Finalizing...`);

    const scenesWithMedia = EditorState.scenes.filter(s => s.mediaUrl);
    console.log(`Auto-load complete: ${scenesWithMedia.length} scenes have mediaUrl`);

    if (EditorState.preview) {
        EditorState.preview.setScenes(EditorState.scenes);
        EditorState.preview.render();
    }

    // Recalculate total duration (video scenes may have updated durations)
    recalculateDuration();

    if (scenesWithMedia.length > 0) {
        elements.previewPlaceholder?.classList.add('hidden');
        renderTimeline();
        renderMediaGrid();
        if (elements.mediaStatus) {
            const videoCount = scenesWithMedia.filter(s => s.isVideo).length;
            const imageCount = scenesWithMedia.length - videoCount;
            const parts = [];
            if (imageCount) parts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);
            if (videoCount) parts.push(`${videoCount} video${videoCount > 1 ? 's' : ''}`);
            elements.mediaStatus.textContent = `${parts.join(' + ')} loaded`;
        }
        showToast(`Loaded ${scenesWithMedia.length} scene assets`, 'success');
    } else {
        showToast('No media found for this project', 'info');
    }
}

/**
 * Apply saved settings from localStorage
 */
function applySavedSettings() {
    // Apply saved timeline height
    const timelineHeight = EditorState.timelineHeight;
    if (elements.editorLayout) {
        elements.editorLayout.style.setProperty('--timeline-height', `${timelineHeight}px`);
    }
    updateClipSizes(timelineHeight);

    // Apply saved zoom level
    updateZoom();

    // Apply saved loop state
    if (EditorState.isLooping && elements.loopBtn) {
        elements.loopBtn.classList.add('active');
    }
}

// ===== SIMPLE LOADING OVERLAY =====

/**
 * Show unified loading overlay - single black screen with current step
 */
function showLoadingOverlay(message = 'Loading...') {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <div class="loading-text">${message}</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    return overlay;
}

/**
 * Update loading overlay text
 */
function updateLoadingOverlay(message) {
    const textEl = document.querySelector('.loading-overlay .loading-text');
    if (textEl) textEl.textContent = message;
}

/**
 * Hide loading overlay with fade
 */
function hideLoadingOverlay() {
    return new Promise(resolve => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 300);
        } else {
            resolve();
        }
    });
}

/**
 * Show the no data overlay
 */
function showNoDataOverlay() {
    elements.noDataOverlay?.classList.remove('hidden');
}

/**
 * Hide the no data overlay
 */
function hideNoDataOverlay() {
    elements.noDataOverlay?.classList.add('hidden');
}

// Old loading functions removed - replaced by sequential loading system

/**
 * Update a single scene clip thumbnail in the timeline
 */
function updateSceneClipThumb(sceneId, mediaPath, isVideo = false, videoThumbUrl = null) {
    const clip = document.querySelector(`.scene-clip[data-id="${sceneId}"]`);
    if (!clip) return;
    const thumb = clip.querySelector('.scene-clip-thumb');
    if (!thumb) return;

    if (isVideo && videoThumbUrl) {
        // Use pre-generated thumbnail data URL
        thumb.innerHTML = `<img src="${videoThumbUrl}" alt="Scene ${sceneId}">
            <span class="media-video-badge">VIDEO</span>`;
    } else if (isVideo) {
        // Fallback: generate thumbnail from video
        thumb.classList.add('loading');
        getVideoMeta(mediaPath).then(meta => {
            if (meta?.thumbDataUrl) {
                thumb.innerHTML = `<img src="${meta.thumbDataUrl}" alt="Scene ${sceneId}">
                    <span class="media-video-badge">VIDEO</span>`;
            }
            thumb.classList.remove('loading');
        });
    } else {
        thumb.classList.add('loading');
        const img = new Image();
        img.onload = () => {
            thumb.innerHTML = `<img src="${mediaPath}" alt="Scene ${sceneId}">`;
            thumb.classList.remove('loading');
        };
        img.onerror = () => thumb.classList.remove('loading');
        img.src = mediaPath;
    }
}

/**
 * Render the media panel grid with scene thumbnails (CapCut-style)
 */
function renderMediaGrid() {
    const pane = document.querySelector('.tab-pane[data-pane="media"] .tab-pane-body');
    if (!pane || !EditorState.scenes.length) return;

    const emptyEl = pane.querySelector('.media-empty');
    if (emptyEl) emptyEl.style.display = 'none';

    let grid = pane.querySelector('.media-grid');
    if (!grid) {
        grid = document.createElement('div');
        grid.className = 'media-grid';
        pane.appendChild(grid);
    }

    grid.innerHTML = EditorState.scenes.map(scene => {
        const hasMedia = !!scene.mediaUrl;
        const dur = (scene.duration || 0).toFixed(1);
        const icon = SCENE_ICONS[scene.type] || SCENE_ICONS.default;
        const label = scene.image_prompt
            ? scene.image_prompt.substring(0, 30)
            : `Scene ${scene.id}`;

        return `
            <div class="media-grid-item${EditorState.selectedScene?.id === scene.id ? ' selected' : ''}"
                 data-scene-id="${scene.id}" title="${(scene.image_prompt || 'Scene ' + scene.id).replace(/"/g, '&quot;')}">
                ${hasMedia
                ? (scene.isVideo && scene.videoThumb
                    ? `<img src="${scene.videoThumb}" alt="Scene ${scene.id}" style="width:100%;height:100%;object-fit:cover">
                       <span class="media-video-badge">VIDEO</span>`
                    : scene.isVideo
                        ? `<div class="media-grid-placeholder">${icon}</div>
                           <span class="media-video-badge">VIDEO</span>`
                        : `<img src="${scene.mediaUrl}" alt="Scene ${scene.id}">`)
                : `<div class="media-grid-placeholder">${icon}</div>`}
                ${hasMedia ? '<span class="media-grid-badge">Added</span>' : ''}
                <span class="media-grid-duration">${dur}s</span>
                <span class="media-grid-label">${label}</span>
            </div>`;
    }).join('');

    // Click to select scene
    grid.querySelectorAll('.media-grid-item').forEach(item => {
        item.addEventListener('click', () => {
            const sceneId = parseInt(item.dataset.sceneId);
            selectScene(sceneId);
            renderMediaGrid();
            // Scroll timeline to this clip
            const clip = elements.videoTrack?.querySelector(`.scene-clip[data-id="${sceneId}"]`);
            if (clip) clip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        });
    });
}

/**
 * Check if an image exists at the given path
 */
function checkImageExists(imagePath) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = imagePath;
    });
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/**
 * Check if a media file (image or video) exists via HEAD request
 */
function checkMediaExists(mediaPath) {
    return fetch(mediaPath, { method: 'HEAD' })
        .then(res => res.ok)
        .catch(() => false);
}

/**
 * Determine if a file path is a video
 */
function isVideoFile(path) {
    const ext = (path || '').split('.').pop().toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Load video metadata (duration) and capture a poster thumbnail.
 * Returns { duration, thumbDataUrl } or null on failure.
 */
function getVideoMeta(videoUrl) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            const duration = video.duration;
            // Seek to 1s or 10% for a representative frame
            video.currentTime = Math.min(1, duration * 0.1);
            video.onseeked = () => {
                let thumbDataUrl = null;
                try {
                    const c = document.createElement('canvas');
                    c.width = video.videoWidth;
                    c.height = video.videoHeight;
                    c.getContext('2d').drawImage(video, 0, 0);
                    thumbDataUrl = c.toDataURL('image/jpeg', 0.7);
                } catch (_) { /* cross-origin, ignore */ }
                resolve({ duration, thumbDataUrl });
            };
        };
        video.onerror = () => resolve(null);
        video.src = videoUrl;
    });
}

/**
 * Load audio — uses staged alignment URL when available, falls back to working-assets/
 */
function loadDefaultAudio(stagedData) {
    const projectId = EditorState.project?.id || 'default';

    // Determine audio source: staged alignment URL first, then working-assets fallback
    let audioPath, audioFileName;
    if (stagedData?.audio?.url) {
        audioPath = stagedData.audio.url;
        audioFileName = stagedData.audio.source_file || audioPath.split('/').pop();
        console.log('Using staged audio URL:', audioPath);
    } else {
        audioFileName = 'main-audio.mp3';
        audioPath = `working-assets/${projectId}/${audioFileName}`;
        console.log('No staged audio — falling back to:', audioPath);
    }

    // Create audio element
    const audio = new Audio(audioPath);
    EditorState.audioElement = audio;

    // Store audio info in state
    EditorState.audio = {
        file: audioFileName,
        path: audioPath,
        duration: stagedData?.audio?.duration || 0,
        loaded: false
    };

    // When audio metadata is loaded, get the duration
    audio.addEventListener('loadedmetadata', () => {
        EditorState.audio.duration = audio.duration;
        EditorState.audio.loaded = true;

        // Restore saved audio trim duration if available
        if (EditorState.savedAudioSettings?.trimmedDuration) {
            EditorState.audio.trimmedDuration = EditorState.savedAudioSettings.trimmedDuration;
            console.log('Restored audio trim duration:', EditorState.audio.trimmedDuration);
        }

        // Extend last scene to fill any trailing gap between segments and actual audio end.
        // Segmenter segments may end before the audio file's true duration (trailing silence).
        const audioDur = EditorState.audio.trimmedDuration || audio.duration;
        const scenesDur = getScenesDuration();
        if (EditorState.scenes.length > 0 && audioDur > scenesDur + 0.05) {
            const lastScene = EditorState.scenes[EditorState.scenes.length - 1];
            const gap = parseFloat((audioDur - scenesDur).toFixed(3));
            lastScene.duration = parseFloat((lastScene.duration + gap).toFixed(3));
            console.log(`Extended last scene by ${gap}s to match audio duration`);
        }

        recalculateDuration();
        renderAudioTrack();
        showToast('Audio loaded: ' + formatTimestamp(EditorState.audio.trimmedDuration || audio.duration), 'success');
    });

    audio.addEventListener('error', (e) => {
        console.warn('Failed to load audio:', audioPath, e);

        // Try alternative extension before failing
        if (!stagedData?._triedAltExtensionFallback && !stagedData?.audio?.url) {
            const projectId = EditorState.project?.id || 'default';
            const altFileName = audioFileName.endsWith('.wav')
                ? audioFileName.replace('.wav', '.mp3')
                : audioFileName.replace('.mp3', '.wav');
            const altPath = `working-assets/${projectId}/${altFileName}`;
            console.log('Trying alternative audio fallback:', altPath);
            loadDefaultAudio({
                audio: { url: altPath, source_file: altFileName, duration: 0 },
                _triedAltExtensionFallback: true
            });
            return;
        }

        EditorState.audio.loaded = false;
        EditorState.audio.error = true;
        renderAudioTrack();

        // Only show toast if we aren't about to successfully load from picker
        if (stagedData?._triedAltExtensionFallback) {
            showToast(`Audio not found: ${audioFileName}`, 'warning');
        }
    });

    // Initial render (before duration is known)
    renderAudioTrack();
}

/**
 * Load audio from a URL (used by TTS picker and other sources)
 */
function loadAudioFromURL(audioPath, audioFileName, hintDuration) {
    // Stop any existing audio
    if (EditorState.audioElement) {
        EditorState.audioElement.pause();
        EditorState.audioElement.src = '';
    }

    const audio = new Audio(audioPath);
    EditorState.audioElement = audio;

    EditorState.audio = {
        file: audioFileName,
        path: audioPath,
        duration: hintDuration || 0,
        loaded: false
    };

    audio.addEventListener('loadedmetadata', () => {
        EditorState.audio.duration = audio.duration;
        EditorState.audio.loaded = true;

        const audioDur = audio.duration;
        const scenesDur = getScenesDuration();
        if (EditorState.scenes.length > 0 && audioDur > scenesDur + 0.05) {
            const lastScene = EditorState.scenes[EditorState.scenes.length - 1];
            const gap = parseFloat((audioDur - scenesDur).toFixed(3));
            lastScene.duration = parseFloat((lastScene.duration + gap).toFixed(3));
        }

        recalculateDuration();
        renderAudioTrack();
        saveProjectEdits();
        showToast('Audio loaded: ' + formatTimestamp(audio.duration), 'success');
    });

    audio.addEventListener('error', () => {
        EditorState.audio.loaded = false;
        EditorState.audio.error = true;
        renderAudioTrack();
        showToast(`Audio not found: ${audioFileName}`, 'warning');
    });

    renderAudioTrack();
}

// Listen for audio load requests from the TTS picker
window.addEventListener('editor-load-audio', (e) => {
    const { url, filename, duration } = e.detail;
    loadAudioFromURL(url, filename, duration);
});

// Handle aspect ratio changes from the dropdown
window.addEventListener('editor-ratio-change', (e) => {
    const { ratio, width, height } = e.detail;
    if (EditorState.preview) {
        EditorState.preview.width = width;
        EditorState.preview.height = height;
        EditorState.preview.render();
    }
    // Update detail panel
    const infoRatio = document.getElementById('info-ratio');
    const infoRes = document.getElementById('info-resolution');
    if (infoRatio) infoRatio.textContent = ratio;
    if (infoRes) infoRes.textContent = `${width}x${height}`;
});

/**
 * Render audio track with loaded audio - uses helper for width calculation
 */
function renderAudioTrack() {
    if (!elements.audioTrack) return;

    if (EditorState.audio && EditorState.audio.file) {
        // Use trimmed duration if set, otherwise use actual audio duration
        const audioDuration = EditorState.audio.trimmedDuration ||
            (EditorState.audio.loaded ? EditorState.audio.duration : EditorState.project.totalDuration);
        const totalWidth = timeToPixels(audioDuration);

        // Show error state if audio failed to load
        const errorClass = EditorState.audio.error ? 'audio-clip-error' : '';
        const statusText = EditorState.audio.error ? '(not found)' : formatTimestamp(audioDuration);

        elements.audioTrack.innerHTML = `
            <div class="audio-clip ${errorClass}" style="width: ${totalWidth}px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                </svg>
                <span class="audio-clip-name">${EditorState.audio.file}</span>
                <span class="audio-clip-duration">${statusText}</span>
                <div class="resize-handle resize-handle-right audio-resize-handle"></div>
            </div>
        `;

        // Setup audio resize handler
        setupAudioResizeHandler();
    } else {
        elements.audioTrack.innerHTML = `
            <div class="audio-placeholder">Click + to add background audio</div>
        `;
    }
}

/**
 * Setup resize handler for audio clip
 */
function setupAudioResizeHandler() {
    const audioClip = elements.audioTrack?.querySelector('.audio-clip');
    const resizeHandle = audioClip?.querySelector('.audio-resize-handle');

    if (!resizeHandle || !EditorState.audio?.loaded) return;

    resizeHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startAudioResize(e);
    });
}

/**
 * Start resizing the audio clip
 */
function startAudioResize(startEvent) {
    if (!EditorState.audio?.loaded) return;

    const startX = startEvent.clientX;
    const startDuration = EditorState.audio.trimmedDuration || EditorState.audio.duration;
    const maxDuration = EditorState.audio.duration; // Can't extend beyond original audio length

    const audioClip = elements.audioTrack?.querySelector('.audio-clip');
    const durationSpan = audioClip?.querySelector('.audio-clip-duration');

    const onMouseMove = (e) => {
        const deltaX = e.clientX - startX;
        const deltaDuration = pixelsToTime(deltaX);

        // Calculate new duration (min 1s, max original audio duration)
        let newDuration = Math.max(1, Math.min(maxDuration, startDuration + deltaDuration));

        // Snap to 0.5s increments
        newDuration = Math.round(newDuration * 2) / 2;

        // Update audio trimmed duration
        EditorState.audio.trimmedDuration = newDuration;

        // Update clip width visually
        if (audioClip) {
            const newWidth = timeToPixels(newDuration);
            audioClip.style.width = `${newWidth}px`;
        }

        // Update duration display
        if (durationSpan) {
            durationSpan.textContent = formatTimestamp(newDuration);
        }
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const newDuration = EditorState.audio.trimmedDuration || EditorState.audio.duration;

        // Record the edit if duration actually changed
        if (newDuration !== startDuration) {
            recordEdit('Resize audio duration', 'audio', 'trimmedDuration', startDuration, newDuration);
        }

        // Recalculate total duration
        recalculateDuration();
        renderTimeRuler();

        // Update preview duration
        if (EditorState.preview) {
            EditorState.preview.setDuration(getTotalDuration());
        }

        showToast(`Audio duration: ${formatTimestamp(newDuration)}`, 'info');
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

/**
 * Update project info in the UI
 */
function updateProjectInfo() {
    if (elements.projectName) {
        elements.projectName.textContent = EditorState.project.name;
    }
    if (elements.infoScenes) {
        elements.infoScenes.textContent = EditorState.project.sceneCount;
    }

    const displayTotalDuration = getTotalDuration();

    if (elements.infoDuration) {
        elements.infoDuration.textContent = formatTimestamp(displayTotalDuration);
    }
    if (elements.totalTime) {
        elements.totalTime.textContent = formatTimecode(displayTotalDuration);
    }
}

/**
 * Render the timeline with scene clips - uses helper for width calculation
 */
function renderTimeline() {
    if (!elements.videoTrack) return;

    const clips = EditorState.scenes.map(scene => {
        const width = getScenePixelWidth(scene);
        const color = SCENE_COLORS[scene.type] || '#666666';
        const icon = SCENE_ICONS[scene.type] || SCENE_ICONS.default;

        return `
            <div class="scene-clip"
                 data-id="${scene.id}"
                 data-type="${scene.type}"
                 style="width: ${width}px; --scene-color: ${color};"
                 title="${scene.type} - ${scene.duration}s">
                <div class="scene-clip-thumb">
                    ${scene.isVideo && scene.videoThumb
                ? `<img src="${scene.videoThumb}" alt="Scene ${scene.id}"><span class="media-video-badge">VIDEO</span>`
                : scene.mediaUrl
                    ? `<img src="${scene.mediaUrl}" alt="Scene ${scene.id}">`
                    : icon
            }
                </div>
                <div class="scene-clip-info">
                    <div class="scene-clip-id">${scene.id}</div>
                    <div class="scene-clip-duration">${scene.duration}s</div>
                </div>
                <div class="resize-handle resize-handle-left"></div>
                <div class="resize-handle resize-handle-right"></div>
            </div>
        `;
    }).join('');

    elements.videoTrack.innerHTML = clips;

    // Render text track — text clips positioned at matching scene times
    renderTextTrack();

    // Render caption track
    renderCaptionTrack();

    // Add click listeners
    elements.videoTrack.querySelectorAll('.scene-clip').forEach(clip => {
        clip.addEventListener('click', (e) => {
            if (!e.target.classList.contains('resize-handle')) {
                selectScene(parseInt(clip.dataset.id));
            }
        });
    });

    // Add resize listeners
    setupResizeHandlers();

    // Validate and show errors
    validateScenes();
    applySceneErrorStyles();
}

/**
 * Render text track — shows text_content for scenes that have it, aligned to scene times
 */
function renderTextTrack() {
    if (!elements.textTrack) return;

    // Build text clips for scenes that have text_content
    let offset = 0;
    const textClips = [];

    for (const scene of EditorState.scenes) {
        const width = getScenePixelWidth(scene);
        const text = scene.text_content;

        if (text) {
            const truncText = text.length > 30 ? text.substring(0, 30) + '...' : text;
            textClips.push(`
                <div class="text-clip"
                     data-id="${scene.id}"
                     style="position:absolute;left:${offset}px;width:${width}px;"
                     title="${text.replace(/"/g, '&quot;')}">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.6">
                        <path d="M4 7V4h16v3"/><path d="M12 4v16"/><path d="M8 20h8"/>
                    </svg>
                    <span class="text-clip-label">${truncText.replace(/</g, '&lt;')}</span>
                    <span class="text-clip-duration">${scene.duration}s</span>
                </div>
            `);
        }
        offset += width;
    }

    if (textClips.length > 0) {
        elements.textTrack.innerHTML = `<div style="position:relative;width:${offset}px;height:100%">${textClips.join('')}</div>`;

        // Click to select scene
        elements.textTrack.querySelectorAll('.text-clip').forEach(clip => {
            clip.addEventListener('click', () => {
                selectScene(parseInt(clip.dataset.id));
            });
        });
    } else {
        elements.textTrack.innerHTML = `<div class="text-track-empty">No text overlays</div>`;
    }
}

/**
 * Render caption track — shows caption text clips from caption data
 */
function renderCaptionTrack() {
    if (!elements.captionTrack) return;

    const captionData = EditorState.captionData;
    if (!captionData || !captionData.captions || !captionData.captions.length) {
        elements.captionTrack.innerHTML = `<div class="caption-track-empty">No captions</div>`;
        return;
    }

    const captions = captionData.captions;
    const totalDuration = EditorState.scenes.reduce((sum, s) => sum + (s.duration || 0), 0);
    if (!totalDuration) return;

    // Total timeline width from scenes
    let totalWidth = 0;
    for (const scene of EditorState.scenes) {
        totalWidth += getScenePixelWidth(scene);
    }

    const pxPerSec = totalWidth / totalDuration;
    const clips = captions.map((c, i) => {
        const left = c.start * pxPerSec;
        const width = Math.max((c.end - c.start) * pxPerSec, 8);
        const label = c.text.length > 20 ? c.text.substring(0, 20) + '...' : c.text;
        return `<div class="caption-clip" data-cap-idx="${i}" style="left:${left}px;width:${width}px" title="${c.text.replace(/"/g, '&quot;')}">
            <span class="caption-clip-label">${label.replace(/</g, '&lt;')}</span>
        </div>`;
    }).join('');

    elements.captionTrack.innerHTML = `<div style="position:relative;width:${totalWidth}px;height:100%">${clips}</div>`;
}

/**
 * Setup caption enable toggle and style controls in the sidebar Caption tab.
 */
function setupCaptionControls() {
    const toggle = document.getElementById('caption-enabled-toggle');
    if (!toggle) return;

    toggle.addEventListener('change', () => {
        EditorState.captionsEnabled = toggle.checked;
        const row = elements.captionTrackRow;
        if (row) row.style.display = toggle.checked ? '' : 'none';

        // Show/hide caption overlay in preview
        if (EditorState.preview) {
            if (toggle.checked && EditorState.captionData) {
                EditorState.preview.setCaptions(EditorState.captionData.captions, EditorState.captionData.style || {});
            } else {
                EditorState.preview.setCaptions(null, null);
            }
        }

        // Update UI
        _capUpdateUI();
        renderCaptionTrack();
    });

    // Style controls
    const presetSel = document.getElementById('cap-ed-preset');
    const fontSel = document.getElementById('cap-ed-font');
    if (fontSel) buildFontOptions(fontSel, EditorState.captionData?.style?.font_family || 'Montserrat');
    const sizeInput = document.getElementById('cap-ed-size');
    const colorInput = document.getElementById('cap-ed-color');
    const strokeInput = document.getElementById('cap-ed-stroke');
    const posInput = document.getElementById('cap-ed-position');
    const posVal = document.getElementById('cap-ed-pos-val');

    const updateStyle = (key, value) => {
        if (!EditorState.captionData?.style) return;
        EditorState.captionData.style[key] = value;
        if (EditorState.preview && EditorState.captionsEnabled) {
            EditorState.preview.setCaptions(EditorState.captionData.captions, EditorState.captionData.style);
        }
    };

    presetSel?.addEventListener('change', () => {
        const PRESETS = {
            bold_popup: { font_family: 'Montserrat', font_size: 64, font_weight: '800', color: '#FFFFFF', stroke_color: '#000000', stroke_width: 4, position_y: 75, animation: 'pop', text_transform: 'uppercase' },
            subtitle_bar: { font_family: 'Inter', font_size: 48, font_weight: '600', color: '#FFFFFF', stroke_color: 'none', stroke_width: 0, position_y: 85, animation: 'none', text_transform: 'none', bg_bar: true },
            karaoke: { font_family: 'Bebas Neue', font_size: 72, font_weight: '400', color: '#FFFFFF', stroke_color: '#000000', stroke_width: 3, position_y: 70, animation: 'none', text_transform: 'uppercase', highlight: true },
            minimal: { font_family: 'DM Sans', font_size: 42, font_weight: '500', color: '#FFFFFF', stroke_color: 'none', stroke_width: 0, position_y: 80, animation: 'none', text_transform: 'none' },
        };
        const p = PRESETS[presetSel.value];
        if (p && EditorState.captionData) {
            EditorState.captionData.style = { ...p, preset: presetSel.value };
            _capSyncStyleUI();
            if (EditorState.preview && EditorState.captionsEnabled) {
                EditorState.preview.setCaptions(EditorState.captionData.captions, EditorState.captionData.style);
            }
        }
    });

    fontSel?.addEventListener('change', () => updateStyle('font_family', fontSel.value));
    sizeInput?.addEventListener('change', () => updateStyle('font_size', parseInt(sizeInput.value)));
    colorInput?.addEventListener('input', () => updateStyle('color', colorInput.value));
    strokeInput?.addEventListener('input', () => updateStyle('stroke_color', strokeInput.value));
    posInput?.addEventListener('input', () => {
        if (posVal) posVal.textContent = posInput.value + '%';
        updateStyle('position_y', parseInt(posInput.value));
    });
}

/**
 * Sync style controls UI from caption data
 */
function _capSyncStyleUI() {
    const style = EditorState.captionData?.style;
    if (!style) return;
    const s = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    s('cap-ed-preset', style.preset || 'bold_popup');
    s('cap-ed-font', style.font_family || 'Montserrat');
    s('cap-ed-size', style.font_size || 64);
    s('cap-ed-color', style.color || '#FFFFFF');
    s('cap-ed-stroke', style.stroke_color || '#000000');
    s('cap-ed-position', style.position_y || 75);
    const posVal = document.getElementById('cap-ed-pos-val');
    if (posVal) posVal.textContent = (style.position_y || 75) + '%';
}

/**
 * Update caption tab UI based on whether data is loaded
 */
function _capUpdateUI() {
    const hasData = !!(EditorState.captionData && EditorState.captionData.captions && EditorState.captionData.captions.length);
    const noDataEl = document.getElementById('caption-no-data');
    const infoEl = document.getElementById('caption-info');
    const styleEl = document.getElementById('caption-style-controls');

    if (noDataEl) noDataEl.style.display = hasData ? 'none' : '';
    if (infoEl) infoEl.style.display = hasData ? '' : 'none';
    if (styleEl) styleEl.style.display = hasData ? 'flex' : 'none';

    if (hasData) {
        const countEl = document.getElementById('caption-info-count');
        if (countEl) countEl.textContent = EditorState.captionData.captions.length + ' captions';
    }
}

/**
 * Load captions from localStorage (sent by studio)
 */
function _loadCaptionsFromStorage() {
    try {
        const stored = localStorage.getItem('sts-editor-captions');
        if (stored) {
            const data = JSON.parse(stored);
            _receiveCaptionData(data);
        }
    } catch { /* ignore */ }
}

/**
 * Receive caption data (from postMessage or localStorage) and update editor state
 */
function _receiveCaptionData(captionData) {
    if (!captionData || !captionData.captions || !captionData.captions.length) return;
    EditorState.captionData = captionData;

    // Auto-enable captions when data arrives
    EditorState.captionsEnabled = true;
    const toggle = document.getElementById('caption-enabled-toggle');
    if (toggle) toggle.checked = true;
    if (elements.captionTrackRow) elements.captionTrackRow.style.display = '';

    // Update preview
    if (EditorState.preview) {
        EditorState.preview.setCaptions(captionData.captions, captionData.style || {});
    }

    _capSyncStyleUI();
    _capUpdateUI();
    renderCaptionTrack();
}

/**
 * Setup resize handlers for scene clips
 */
function setupResizeHandlers() {
    elements.videoTrack.querySelectorAll('.scene-clip').forEach(clip => {
        const leftHandle = clip.querySelector('.resize-handle-left');
        const rightHandle = clip.querySelector('.resize-handle-right');
        const sceneId = parseInt(clip.dataset.id);

        if (rightHandle) {
            rightHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                startResize(sceneId, 'right', e);
            });
        }

        if (leftHandle) {
            leftHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                startResize(sceneId, 'left', e);
            });
        }
    });
}

/**
 * Start resizing a scene clip
 */
function startResize(sceneId, handle, startEvent) {
    const scene = EditorState.scenes.find(s => s.id === sceneId);
    if (!scene) return;

    const startX = startEvent.clientX;
    const startDuration = scene.duration;

    const onMouseMove = (e) => {
        const deltaX = e.clientX - startX;
        const deltaDuration = deltaX / (EditorState.pixelsPerSecond * EditorState.zoomLevel);

        let newDuration;
        if (handle === 'right') {
            newDuration = Math.max(0.5, startDuration + deltaDuration);
        } else {
            newDuration = Math.max(0.5, startDuration - deltaDuration);
        }

        // Snap to 0.5s increments
        newDuration = Math.round(newDuration * 2) / 2;

        // Update scene duration
        scene.duration = newDuration;

        // Re-render the clip
        const clip = elements.videoTrack.querySelector(`[data-id="${sceneId}"]`);
        if (clip) {
            const width = newDuration * EditorState.pixelsPerSecond * EditorState.zoomLevel;
            clip.style.width = `${width}px`;
            clip.querySelector('.scene-clip-duration').textContent = `${newDuration}s`;
        }
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Record the edit if duration actually changed
        if (scene.duration !== startDuration) {
            recordEdit(`Resize duration (Scene ${sceneId})`, sceneId, 'duration', startDuration, scene.duration);
        }

        // Recalculate total duration
        recalculateDuration();
        renderTimeRuler();

        // Sync preview with updated scenes
        if (EditorState.preview) {
            EditorState.preview.setScenes(EditorState.scenes);
            EditorState.preview.render();
        }

        showToast(`Scene ${sceneId} duration: ${scene.duration}s`, 'info');
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

/**
 * Recalculate total duration from scenes and audio - uses helper functions
 */
function recalculateDuration() {
    // Use helper to get total duration (max of scenes and audio)
    const totalDuration = getTotalDuration();
    EditorState.project.totalDuration = totalDuration;

    // Update preview duration if available
    if (EditorState.preview) {
        EditorState.preview.setDuration(totalDuration);
    }

    updateProjectInfo();
    updateTimeScrubber();
    renderAudioTrack();
    renderTimeRuler();
}

/**
 * Select a scene
 */
function selectScene(sceneId) {
    // Deselect previous
    elements.videoTrack.querySelectorAll('.scene-clip.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // Select new
    const clip = elements.videoTrack.querySelector(`[data-id="${sceneId}"]`);
    if (clip) {
        clip.classList.add('selected');
    }

    EditorState.selectedScene = EditorState.scenes.find(s => s.id === sceneId);

    // Calculate scene start time and seek to it using helper
    const sceneIndex = EditorState.scenes.findIndex(s => s.id === sceneId);
    if (sceneIndex >= 0) {
        const startTime = getSceneStartTime(sceneIndex);

        // Seek preview and timeline to scene start
        EditorState.playbackPosition = startTime;
        if (EditorState.preview) {
            EditorState.preview.seek(startTime);
        }
        seekAudio(startTime);
        updateTimeScrubber();
        updatePlayhead();
    }

    renderSceneProperties();
    updateEffectsTab();
    updateTransitionsTab();

    // Sync media grid selection
    document.querySelectorAll('.media-grid-item').forEach(item => {
        item.classList.toggle('selected', parseInt(item.dataset.sceneId) === sceneId);
    });
}

/**
 * Render scene properties panel
 */
function renderSceneProperties() {
    if (!elements.sceneProperties) return;

    const scene = EditorState.selectedScene;
    if (!scene) {
        elements.sceneProperties.innerHTML = '<div class="detail-placeholder">Select a scene to edit</div>';
        return;
    }

    const isTextScene = scene.type === 'text' || scene.type === 'cta';

    elements.sceneProperties.innerHTML = `
        <div class="property-group">
            <label>Scene ID</label>
            <span class="property-value">${scene.id}</span>
        </div>
        <div class="property-group">
            <label>Type</label>
            <span class="property-value">${scene.type}</span>
        </div>
        <div class="property-group">
            <label>Duration</label>
            <input type="number" class="property-input" id="prop-duration"
                   value="${scene.duration}" min="0.5" step="0.5">
        </div>
        ${isTextScene ? `
            <div class="property-group">
                <label>Text Content</label>
                <textarea class="property-textarea" id="prop-text-content"
                          rows="4" placeholder="Enter text to display...">${scene.text_content || scene.script || ''}</textarea>
            </div>
            <div class="property-group">
                <label>Font Family</label>
                <select class="property-select" id="prop-font-family"></select>
            </div>
            <div class="property-row">
                <div class="property-group property-half">
                    <label>Font Size (px)</label>
                    <input type="number" class="property-input" id="prop-text-size"
                           value="${scene.text_size || 48}" min="12" max="200" step="2">
                </div>
                <div class="property-group property-half">
                    <label>Font Style</label>
                    <select class="property-select" id="prop-font-style">
                        <option value="bold" ${(scene.font_style || 'bold') === 'bold' ? 'selected' : ''}>Bold</option>
                        <option value="normal" ${scene.font_style === 'normal' ? 'selected' : ''}>Regular</option>
                        <option value="light" ${scene.font_style === 'light' ? 'selected' : ''}>Light</option>
                        <option value="italic" ${scene.font_style === 'italic' ? 'selected' : ''}>Italic</option>
                        <option value="bold-italic" ${scene.font_style === 'bold-italic' ? 'selected' : ''}>Bold Italic</option>
                    </select>
                </div>
            </div>
            <div class="property-row">
                <div class="property-group property-half">
                    <label>Text Align</label>
                    <select class="property-select" id="prop-text-align">
                        <option value="center" ${(scene.text_align || 'center') === 'center' ? 'selected' : ''}>Center</option>
                        <option value="left" ${scene.text_align === 'left' ? 'selected' : ''}>Left</option>
                        <option value="right" ${scene.text_align === 'right' ? 'selected' : ''}>Right</option>
                    </select>
                </div>
                <div class="property-group property-half">
                    <label>Vertical Align</label>
                    <select class="property-select" id="prop-vertical-align">
                        <option value="center" ${(scene.vertical_align || 'center') === 'center' ? 'selected' : ''}>Center</option>
                        <option value="top" ${scene.vertical_align === 'top' ? 'selected' : ''}>Top</option>
                        <option value="bottom" ${scene.vertical_align === 'bottom' ? 'selected' : ''}>Bottom</option>
                    </select>
                </div>
            </div>
            <div class="property-group">
                <label>Text Color</label>
                <select class="property-select" id="prop-text-color">
                    <option value="white" ${(scene.text_color || 'white') === 'white' ? 'selected' : ''}>White (dark bg)</option>
                    <option value="black" ${scene.text_color === 'black' ? 'selected' : ''}>Black (light bg)</option>
                </select>
            </div>
            <div class="property-group">
                <label>Position</label>
                <div class="property-position-info">
                    ${scene.text_x !== undefined && scene.text_x !== null ?
                `<span class="position-value">X: ${Math.round(scene.text_x)}%, Y: ${Math.round(scene.text_y)}%</span>` :
                `<span class="position-value position-auto">Using alignment</span>`}
                    <button class="btn btn-small btn-reset-position" id="reset-text-position"
                            ${scene.text_x === undefined || scene.text_x === null ? 'disabled' : ''}>
                        Reset
                    </button>
                </div>
                <span class="property-hint">Drag text in preview to position</span>
            </div>
        ` : `
            <div class="property-group">
                <label>Effect</label>
                <select class="property-select" id="prop-effect">
                    <option value="static" ${scene.visual_fx === 'static' ? 'selected' : ''}>Static</option>
                    <option value="zoom_in" ${scene.visual_fx === 'zoom_in' ? 'selected' : ''}>Zoom In</option>
                    <option value="zoom_out" ${scene.visual_fx === 'zoom_out' ? 'selected' : ''}>Zoom Out</option>
                    <option value="pan_left" ${scene.visual_fx === 'pan_left' ? 'selected' : ''}>Pan Left</option>
                    <option value="pan_right" ${scene.visual_fx === 'pan_right' ? 'selected' : ''}>Pan Right</option>
                    <option value="fade" ${scene.visual_fx === 'fade' ? 'selected' : ''}>Fade</option>
                    <option value="shake" ${scene.visual_fx === 'shake' ? 'selected' : ''}>Shake</option>
                </select>
            </div>
        `}
        ${scene.image ? `
            <div class="property-group">
                <label>Image</label>
                <span class="property-value">${scene.image}</span>
            </div>
        ` : ''}
    `;

    // Add event listeners for property changes
    const durationInput = document.getElementById('prop-duration');
    const effectSelect = document.getElementById('prop-effect');
    const textContentInput = document.getElementById('prop-text-content');
    const textColorSelect = document.getElementById('prop-text-color');
    const fontFamilySelect = document.getElementById('prop-font-family');
    if (fontFamilySelect) buildFontOptions(fontFamilySelect, scene.font_family || 'Inter');
    const textSizeInput = document.getElementById('prop-text-size');
    const fontStyleSelect = document.getElementById('prop-font-style');
    const textAlignSelect = document.getElementById('prop-text-align');
    const verticalAlignSelect = document.getElementById('prop-vertical-align');

    durationInput?.addEventListener('change', (e) => {
        const oldValue = scene.duration;
        const newValue = parseFloat(e.target.value) || 0.5;
        scene.duration = newValue;
        recordEdit(`Change duration (Scene ${scene.id})`, scene.id, 'duration', oldValue, newValue);
        recalculateDuration();
        renderTimeline();
    });

    effectSelect?.addEventListener('change', (e) => {
        const oldValue = scene.visual_fx;
        const newValue = e.target.value;
        scene.visual_fx = newValue;
        recordEdit(`Change effect (Scene ${scene.id})`, scene.id, 'visual_fx', oldValue, newValue);
    });

    // Text content change - update scene and refresh preview (debounced save)
    let textDebounceTimer = null;
    textContentInput?.addEventListener('input', (e) => {
        const oldValue = scene.text_content;
        scene.text_content = e.target.value;
        // Refresh preview to show updated text
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
        // Debounce recording to avoid saving every keystroke
        clearTimeout(textDebounceTimer);
        textDebounceTimer = setTimeout(() => {
            if (oldValue !== scene.text_content) {
                recordEdit(`Edit text (Scene ${scene.id})`, scene.id, 'text_content', oldValue, scene.text_content);
            }
        }, 1000);
    });

    // Text size change (pixels) - update scene and refresh preview
    textSizeInput?.addEventListener('change', (e) => {
        const oldValue = scene.text_size;
        const newValue = parseInt(e.target.value) || 48;
        scene.text_size = newValue;
        recordEdit(`Change font size (Scene ${scene.id})`, scene.id, 'text_size', oldValue, newValue);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
    });

    // Font family change - update scene and refresh preview
    fontFamilySelect?.addEventListener('change', (e) => {
        const oldValue = scene.font_family;
        const newValue = e.target.value;
        scene.font_family = newValue;
        recordEdit(`Change font family (Scene ${scene.id})`, scene.id, 'font_family', oldValue, newValue);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
    });

    // Font style change - update scene and refresh preview
    fontStyleSelect?.addEventListener('change', (e) => {
        const oldValue = scene.font_style;
        const newValue = e.target.value;
        scene.font_style = newValue;
        recordEdit(`Change font style (Scene ${scene.id})`, scene.id, 'font_style', oldValue, newValue);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
    });

    // Text align change - update scene and refresh preview
    textAlignSelect?.addEventListener('change', (e) => {
        const oldValue = scene.text_align;
        const newValue = e.target.value;
        scene.text_align = newValue;
        recordEdit(`Change text align (Scene ${scene.id})`, scene.id, 'text_align', oldValue, newValue);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
    });

    // Vertical align change - update scene and refresh preview
    verticalAlignSelect?.addEventListener('change', (e) => {
        const oldValue = scene.vertical_align;
        const newValue = e.target.value;
        scene.vertical_align = newValue;
        recordEdit(`Change vertical align (Scene ${scene.id})`, scene.id, 'vertical_align', oldValue, newValue);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
    });

    // Text color change - update scene and refresh preview
    textColorSelect?.addEventListener('change', (e) => {
        const oldValue = scene.text_color;
        const newValue = e.target.value;
        scene.text_color = newValue;
        recordEdit(`Change text color (Scene ${scene.id})`, scene.id, 'text_color', oldValue, newValue);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
    });

    // Reset text position - clear custom position to use alignment
    const resetPositionBtn = document.getElementById('reset-text-position');
    resetPositionBtn?.addEventListener('click', () => {
        const oldX = scene.text_x;
        const oldY = scene.text_y;
        scene.text_x = undefined;
        scene.text_y = undefined;
        recordEdit(`Reset text position (Scene ${scene.id})`, scene.id, 'text_position', { x: oldX, y: oldY }, null);
        saveProjectEdits();
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
        // Re-render properties to update position display
        renderSceneProperties();
    });
}

/**
 * Render time ruler
 */
function renderTimeRuler() {
    if (!elements.timeRuler) return;

    const totalSeconds = getTotalDuration();
    const interval = EditorState.zoomLevel >= 1 ? 5 : 10; // Show markers every 5s or 10s
    let markers = '';

    for (let t = 0; t <= totalSeconds; t += interval) {
        const left = timeToPixels(t);
        markers += `<span class="time-marker" style="left: ${left}px">${formatTimestamp(t)}</span>`;
    }

    elements.timeRuler.innerHTML = markers;
}

/**
 * Update time scrubber
 */
function updateTimeScrubber() {
    if (elements.timeScrubber) {
        elements.timeScrubber.max = getTotalDuration();
        elements.timeScrubber.value = EditorState.playbackPosition;
    }
    if (elements.currentTime) {
        elements.currentTime.textContent = formatTimecode(EditorState.playbackPosition);
    }
}

/**
 * Scroll timeline to show a specific time position with smooth behavior
 * Keeps playhead at a fixed position from left, then gradually scrolls
 * as content approaches the end
 */
function scrollTimelineToTime(time) {
    if (!elements.timelineTracks) return;

    const containerWidth = elements.timelineTracks.clientWidth;
    const totalDuration = getTotalDuration();
    const totalContentWidth = timeToPixels(totalDuration);
    const pixelPos = timeToPixels(time);

    // Fixed playhead position from left edge (20% or 150px max)
    const fixedPlayheadOffset = Math.min(150, containerWidth * 0.2);

    // Right edge buffer - how far from right edge playhead should stay
    const rightEdgeBuffer = 50;

    // Calculate the maximum scroll position (when content ends)
    const maxScroll = Math.max(0, totalContentWidth - containerWidth + TRACK_BASE_OFFSET + rightEdgeBuffer);

    // Calculate target scroll to keep playhead at fixed position
    const targetScrollLeft = pixelPos - fixedPlayheadOffset + TRACK_BASE_OFFSET;

    // Smooth interpolation when near the end
    // As we get closer to end, gradually allow playhead to move right
    const progress = time / totalDuration;
    const endPhaseStart = 0.7; // Start transitioning at 70% progress

    let finalScrollLeft;

    if (progress > endPhaseStart && totalContentWidth > containerWidth) {
        // In the end phase - smoothly transition playhead from fixed position to end
        const endProgress = (progress - endPhaseStart) / (1 - endPhaseStart); // 0 to 1 in end phase
        const eased = easeOutCubic(endProgress);

        // Interpolate between keeping playhead fixed and letting it reach the end
        const normalScroll = pixelPos - fixedPlayheadOffset + TRACK_BASE_OFFSET;
        const endScroll = maxScroll;

        finalScrollLeft = normalScroll + (endScroll - normalScroll) * eased;
    } else {
        // Normal phase - keep playhead at fixed position
        finalScrollLeft = targetScrollLeft;
    }

    // Clamp to valid range and apply
    elements.timelineTracks.scrollLeft = Math.max(0, Math.min(finalScrollLeft, maxScroll));
}

/**
 * Easing function for smooth end-phase transition
 */
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

/**
 * Setup playhead drag functionality
 * Uses the header marker trail for visual feedback
 */
function setupPlayheadDrag() {
    const playhead = document.getElementById('timeline-playhead');
    const timelineTracks = document.getElementById('timeline-tracks');
    const headerMarker = elements.timelineHeaderMarker;
    const headerTrail = elements.headerMarkerTrail;

    if (!playhead || !timelineTracks) return;

    let isDragging = false;
    let dragStartPosition = 0;

    // Calculate time from X position using helper
    const getTimeFromX = (clientX) => {
        const tracksRect = timelineTracks.getBoundingClientRect();
        const relativeX = clientX - tracksRect.left - TRACK_BASE_OFFSET + timelineTracks.scrollLeft;
        const time = pixelsToTime(relativeX);
        return Math.max(0, Math.min(time, getTotalDuration()));
    };

    // Convert time position to header marker position (relative to visible area)
    const timeToMarkerPosition = (time) => {
        if (!headerMarker) return 0;
        const scrollLeft = timelineTracks.scrollLeft;
        const visibleWidth = timelineTracks.clientWidth - TRACK_BASE_OFFSET;
        const markerWidth = headerMarker.getBoundingClientRect().width;
        const timePixels = timeToPixels(time);
        const visiblePixelPos = timePixels - scrollLeft;
        return (visiblePixelPos / visibleWidth) * markerWidth;
    };

    // Update header marker trail based on drag
    const updateTrail = () => {
        if (!headerTrail || !headerMarker) return;

        const startMarkerPos = timeToMarkerPosition(dragStartPosition);
        const currentMarkerPos = timeToMarkerPosition(EditorState.playbackPosition);

        const left = Math.min(startMarkerPos, currentMarkerPos);
        const width = Math.abs(currentMarkerPos - startMarkerPos);

        headerTrail.style.left = `${Math.max(0, left)}px`;
        headerTrail.style.width = `${width}px`;
    };

    // Reset trail
    const resetTrail = () => {
        if (headerTrail) {
            setTimeout(() => {
                headerTrail.style.width = '0px';
            }, 300);
        }
    };

    // Start drag on playhead
    playhead.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        dragStartPosition = EditorState.playbackPosition;
        playhead.classList.add('dragging');
        headerMarker?.classList.add('scrubbing');

        // Initialize trail at start position
        if (headerTrail) {
            const startPos = timeToMarkerPosition(dragStartPosition);
            headerTrail.style.left = `${startPos}px`;
            headerTrail.style.width = '0px';
        }

        // Pause playback while dragging
        if (EditorState.isPlaying) {
            togglePlayback();
        }
    });

    // Also allow clicking on timeline to seek
    timelineTracks.addEventListener('mousedown', (e) => {
        // Only if clicking on track content area, not on clips
        if (e.target.closest('.scene-clip') || e.target.closest('.track-header')) return;

        isDragging = true;
        dragStartPosition = EditorState.playbackPosition;
        playhead.classList.add('dragging');
        headerMarker?.classList.add('scrubbing');

        // Initialize trail at start position
        if (headerTrail) {
            const startPos = timeToMarkerPosition(dragStartPosition);
            headerTrail.style.left = `${startPos}px`;
            headerTrail.style.width = '0px';
        }

        // Pause playback while dragging
        if (EditorState.isPlaying) {
            togglePlayback();
        }

        // Seek to clicked position
        EditorState.playbackPosition = getTimeFromX(e.clientX);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
        seekAudio(EditorState.playbackPosition);
        updateTimeScrubber();
        updatePlayhead();
        updateTrail();
    });

    // Handle drag movement
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        EditorState.playbackPosition = getTimeFromX(e.clientX);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
        seekAudio(EditorState.playbackPosition);
        updateTimeScrubber();
        updatePlayhead();
        updateTrail();
    });

    // End drag
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            playhead.classList.remove('dragging');
            headerMarker?.classList.remove('scrubbing');
            resetTrail();
        }
    });
}


function setupEventListeners() {
    // Play/Pause
    elements.playBtn?.addEventListener('click', togglePlayback);

    // Skip to Start / End
    document.getElementById('skip-start-btn')?.addEventListener('click', skipToStart);
    document.getElementById('skip-end-btn')?.addEventListener('click', skipToEnd);

    // Loop Toggle
    elements.loopBtn?.addEventListener('click', toggleLoop);

    // Volume/Mute Toggle
    elements.volumeBtn?.addEventListener('click', toggleMute);

    // Fullscreen Toggle
    elements.fullscreenBtn?.addEventListener('click', toggleFullscreen);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.previewPanel?.classList.contains('fullscreen-mode')) {
            toggleFullscreen();
        }
    });

    // Undo/Redo buttons
    document.getElementById('undo-btn')?.addEventListener('click', undoEdit);
    document.getElementById('redo-btn')?.addEventListener('click', redoEdit);

    // History dropdown
    setupHistoryDropdown();

    // Error dropdown
    setupErrorDropdown();

    // Keyboard shortcuts for undo/redo
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                redoEdit();
            } else {
                undoEdit();
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            redoEdit();
        }
    });

    // Time scrubber
    elements.timeScrubber?.addEventListener('input', (e) => {
        EditorState.playbackPosition = parseFloat(e.target.value);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
        seekAudio(EditorState.playbackPosition);
        updateTimeScrubber();
        updatePlayhead();
    });

    // Playhead dragging
    setupPlayheadDrag();

    // Zoom controls
    elements.zoomIn?.addEventListener('click', () => {
        EditorState.zoomLevel = Math.min(4, EditorState.zoomLevel * 1.5);
        updateZoom();
    });

    elements.zoomOut?.addEventListener('click', () => {
        EditorState.zoomLevel = Math.max(0.25, EditorState.zoomLevel / 1.5);
        updateZoom();
    });

    // Select folder (File System Access API)
    elements.selectFolderBtn?.addEventListener('click', selectMediaFolder);

    // Randomize scene media (dice button)
    elements.randomizeMediaBtn?.addEventListener('click', randomizeSceneMedia);

    // Sync playhead with manual scroll
    if (elements.timelineTracks) {
        elements.timelineTracks.addEventListener('scroll', () => {
            updatePlayhead();
            updateHeaderMarker();
        });
    }

    // Timeline header marker click to seek
    setupHeaderMarkerScrub();

    // Preview JSON button
    elements.previewJsonBtn?.addEventListener('click', previewJson);

    // Export MP4
    elements.exportBtn?.addEventListener('click', exportMp4);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Prevent global browser zoom
    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, { passive: false });

    // Timeline Zoom on Scroll (Ctrl + Wheel)
    if (elements.timelineTracks) {
        elements.timelineTracks.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();

                // Determine zoom direction
                if (e.deltaY < 0) {
                    // Zoom In
                    EditorState.zoomLevel = Math.min(4, EditorState.zoomLevel * 1.1);
                } else {
                    // Zoom Out
                    EditorState.zoomLevel = Math.max(0.25, EditorState.zoomLevel / 1.1);
                }
                updateZoom();
            }
        }, { passive: false });
    }

    // Timeline vertical resize
    setupTimelineResize();

    // Setup export modal
    setupExportModal();

    // Setup export progress modal (cancel/close and download buttons)
    setupExportProgressModal();
    setupExportProfileSelector();

    // Background music
    document.getElementById('add-bgmusic')?.addEventListener('click', showMusicPicker);

    // Prevent accidental window close - warn user about unsaved changes
    setupBeforeUnloadWarning();

    // Caption controls
    setupCaptionControls();

    // Effects & Transitions tabs
    setupEffectsTab();
    setupTransitionsTab();

    // Track toggling
    document.querySelectorAll('.track-toggle').forEach(icon => {
        icon.addEventListener('click', (e) => {
            const trackEl = e.target.closest('.track');
            if (!trackEl) return;

            const trackType = trackEl.dataset.track;

            // Toggle state
            if (EditorState.disabledTracks.has(trackType)) {
                EditorState.disabledTracks.delete(trackType);
                trackEl.classList.remove('disabled');
                showToast(`${trackType.charAt(0).toUpperCase() + trackType.slice(1)} track enabled`, 'info');
            } else {
                EditorState.disabledTracks.add(trackType);
                trackEl.classList.add('disabled');
                showToast(`${trackType.charAt(0).toUpperCase() + trackType.slice(1)} track disabled`, 'info');
            }

            // Update preview and playback if necessary
            updatePreviewFromDisabledTracks();
        });
    });
}

/**
 * Update the preview state based on which tracks are disabled.
 */
function updatePreviewFromDisabledTracks() {
    // 1. Video track disabled - Hide/Show scenes in preview
    if (EditorState.preview) {
        if (EditorState.disabledTracks.has('video')) {
            EditorState.preview.setScenes([]);
        } else {
            EditorState.preview.setScenes(EditorState.scenes);
        }
    }

    // 2. Audio track disabled - Mute/Unmute main audio
    if (EditorState.audioElement) {
        if (EditorState.disabledTracks.has('audio') || EditorState.isMuted) {
            EditorState.audioElement.muted = true;
        } else {
            EditorState.audioElement.muted = false;
        }
    }

    // 3. Background Music disabled - Mute/Unmute bg music
    if (EditorState.bgMusicElement) {
        if (EditorState.disabledTracks.has('bgmusic') || EditorState.isMuted) {
            EditorState.bgMusicElement.muted = true;
        } else {
            EditorState.bgMusicElement.muted = false;
        }
    }

    // 4. Caption track disabled - Hide/Show captions in preview
    if (EditorState.preview) {
        if (EditorState.disabledTracks.has('caption') || !EditorState.captionsEnabled) {
            EditorState.preview.setCaptions(null, null);
        } else if (EditorState.captionData) {
            EditorState.preview.setCaptions(EditorState.captionData.captions, EditorState.captionData.style);
        }
    }

    // Sync disabled tracks to preview so text scenes are hidden
    if (EditorState.preview) {
        EditorState.preview.disabledTracks = new Set(EditorState.disabledTracks);
        EditorState.preview.render();
    }
}

/**
 * Setup timeline vertical resize functionality
 */
function setupTimelineResize() {
    const handle = elements.timelineResizeHandle;
    const layout = elements.editorLayout;

    if (!handle || !layout) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 180;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = elements.timelinePanel?.offsetHeight || 180;
        handle.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaY = startY - e.clientY;
        const newHeight = Math.max(150, Math.min(500, startHeight + deltaY));

        layout.style.setProperty('--timeline-height', `${newHeight}px`);
        updateClipSizes(newHeight);
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Save timeline height to localStorage
            const currentHeight = elements.timelinePanel?.offsetHeight || 180;
            EditorState.timelineHeight = currentHeight;
            if (EditorState.storageEnabled) localStorage.setItem(STORAGE_KEYS.TIMELINE_HEIGHT, currentHeight.toString());
        }
    });
}

/**
 * Update clip and thumbnail sizes based on timeline height
 */
function updateClipSizes(timelineHeight) {
    const videoTrack = elements.videoTrack;
    if (!videoTrack) return;

    // Scale clip height based on timeline height (subtract toolbar ~44px, ruler ~24px, padding)
    const availableHeight = timelineHeight - 100;
    const clipHeight = Math.max(40, Math.min(120, availableHeight * 0.6));
    const thumbWidth = Math.max(36, clipHeight * 0.9);

    videoTrack.style.setProperty('--clip-height', `${clipHeight}px`);
    videoTrack.style.setProperty('--thumb-width', `${thumbWidth}px`);
}

/**
 * Setup header marker scrub functionality
 * The header marker represents the VISIBLE portion of the timeline (what you can see)
 */
function setupHeaderMarkerScrub() {
    const marker = elements.timelineHeaderMarker;
    const trail = elements.headerMarkerTrail;
    if (!marker) return;

    let isScrubbing = false;
    let scrubStartX = 0;

    const updateTrail = (currentX, markerWidth) => {
        if (!trail) return;

        const left = Math.min(scrubStartX, currentX);
        const width = Math.abs(currentX - scrubStartX);

        trail.style.left = `${left}px`;
        trail.style.width = `${width}px`;
    };

    const handleScrub = (e) => {
        if (!elements.timelineTracks) return;

        const rect = marker.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const markerWidth = rect.width;

        // Update trail
        updateTrail(x, markerWidth);

        // Get the visible timeline dimensions
        const scrollLeft = elements.timelineTracks.scrollLeft;
        const visibleWidth = elements.timelineTracks.clientWidth - TRACK_BASE_OFFSET;

        // Map click position on marker to pixel position on visible timeline
        const visiblePixelPos = (x / markerWidth) * visibleWidth;
        const actualPixelPos = scrollLeft + visiblePixelPos;
        const time = Math.max(0, Math.min(getTotalDuration(), pixelsToTime(actualPixelPos)));

        // Seek to position
        EditorState.playbackPosition = time;
        if (EditorState.preview) {
            EditorState.preview.seek(time);
        }
        seekAudio(time);
        updateTimeScrubber();
        updatePlayhead();
    };

    marker.addEventListener('mousedown', (e) => {
        isScrubbing = true;
        marker.classList.add('scrubbing');

        // Record start position for trail
        const rect = marker.getBoundingClientRect();
        scrubStartX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));

        // Reset trail
        if (trail) {
            trail.style.left = `${scrubStartX}px`;
            trail.style.width = '0px';
        }

        handleScrub(e);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (isScrubbing) {
            handleScrub(e);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isScrubbing) {
            isScrubbing = false;
            marker.classList.remove('scrubbing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Fade out trail (handled by CSS transition)
            if (trail) {
                setTimeout(() => {
                    trail.style.width = '0px';
                }, 300);
            }
        }
    });
}

/**
 * Update header marker indicator position
 * The indicator shows where the playhead is within the VISIBLE portion of the timeline
 */
function updateHeaderMarker() {
    const indicator = elements.headerMarkerIndicator;
    const marker = elements.timelineHeaderMarker;
    if (!indicator || !marker || !elements.timelineTracks) return;

    const markerWidth = marker.offsetWidth;

    // Get the visible timeline dimensions
    const scrollLeft = elements.timelineTracks.scrollLeft;
    const visibleWidth = elements.timelineTracks.clientWidth - TRACK_BASE_OFFSET;

    // Calculate playhead position in pixels
    const playheadPixelPos = timeToPixels(EditorState.playbackPosition);

    // Map playhead position to marker position based on visible area
    const relativePos = playheadPixelPos - scrollLeft;
    const left = (relativePos / visibleWidth) * markerWidth;

    indicator.style.left = `${Math.max(0, Math.min(markerWidth - 3, left))}px`;
}

/**
 * Toggle playback
 */
function togglePlayback() {
    if (EditorState.preview) {
        EditorState.isPlaying = EditorState.preview.toggle();
    } else {
        EditorState.isPlaying = !EditorState.isPlaying;
        if (EditorState.isPlaying) {
            startPlayback();
        }
    }

    // Sync audio playback
    syncAudioPlayback();

    updatePlayButton();
}

/**
 * Jump to start of timeline
 */
function skipToStart() {
    EditorState.playbackPosition = 0;
    if (EditorState.preview) EditorState.preview.seek(0);
    if (EditorState.audioElement) EditorState.audioElement.currentTime = 0;
    if (EditorState.bgMusicElement) EditorState.bgMusicElement.currentTime = 0;
    updatePlayhead();
    updateTimeDisplay();
}

/**
 * Jump to end of timeline
 */
function skipToEnd() {
    const totalDuration = getTotalDuration();
    if (totalDuration <= 0) return;

    // Pause first if playing
    if (EditorState.isPlaying) togglePlayback();

    EditorState.playbackPosition = Math.max(0, totalDuration - 0.01);
    if (EditorState.preview) EditorState.preview.seek(EditorState.playbackPosition);
    if (EditorState.audioElement) EditorState.audioElement.currentTime = Math.min(EditorState.playbackPosition, EditorState.audioElement.duration || 999);
    updatePlayhead();
    updateTimeDisplay();
}

/**
 * Toggle fullscreen preview mode
 */
function toggleFullscreen() {
    const panel = elements.previewPanel;
    if (!panel) return;

    const isFullscreen = panel.classList.toggle('fullscreen-mode');

    if (elements.fullscreenBtn) {
        if (isFullscreen) {
            elements.fullscreenBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
                </svg>`;
            elements.fullscreenBtn.classList.add('active');
        } else {
            elements.fullscreenBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                </svg>`;
            elements.fullscreenBtn.classList.remove('active');
        }
    }

    // Re-render preview at new size
    if (EditorState.preview) {
        requestAnimationFrame(() => EditorState.preview.render());
    }
}

/**
 * Toggle loop mode
 */
function toggleLoop() {
    EditorState.isLooping = !EditorState.isLooping;

    // Save to localStorage
    if (EditorState.storageEnabled) localStorage.setItem(STORAGE_KEYS.LOOP_STATE, EditorState.isLooping.toString());

    if (elements.loopBtn) {
        if (EditorState.isLooping) {
            elements.loopBtn.classList.add('active');
            showToast('Loop enabled', 'info');
        } else {
            elements.loopBtn.classList.remove('active');
            showToast('Loop disabled', 'info');
        }
    }
}

/**
 * Toggle audio mute
 */
function toggleMute() {
    EditorState.isMuted = !EditorState.isMuted;

    // Apply mute to audio elements
    if (EditorState.audioElement) {
        EditorState.audioElement.muted = EditorState.isMuted;
    }
    if (EditorState.bgMusicElement) {
        EditorState.bgMusicElement.muted = EditorState.isMuted;
    }

    // Update button icon
    updateVolumeIcon();

    showToast(EditorState.isMuted ? 'Audio muted' : 'Audio unmuted', 'info');
}

/**
 * Update volume button icon based on mute state
 */
function updateVolumeIcon() {
    if (!elements.volumeBtn) return;

    if (EditorState.isMuted) {
        elements.volumeBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
            </svg>`;
        elements.volumeBtn.classList.add('muted');
    } else {
        elements.volumeBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>`;
        elements.volumeBtn.classList.remove('muted');
    }
}

/**
 * Sync audio with current playback state
 */
function syncAudioPlayback() {
    if (!EditorState.audioElement || !EditorState.audio?.loaded) return;

    if (EditorState.isPlaying) {
        // Always sync time when starting playback
        EditorState.audioElement.currentTime = EditorState.playbackPosition;
        EditorState.audioElement.play().catch(e => console.warn('Audio play failed:', e));

        // Sync bgMusic
        if (EditorState.bgMusicElement && EditorState.bgMusic) {
            EditorState.bgMusicElement.currentTime = EditorState.playbackPosition % (EditorState.bgMusic.duration || 999);
            EditorState.bgMusicElement.play().catch(() => { });
        }

        // Use audio as master clock for perfect sync, fallback to system time if audio ends but timeline is longer
        if (EditorState.preview) {
            const startSysTime = performance.now();
            const startPlayPos = EditorState.playbackPosition;
            EditorState.preview.setTimeSource(() => {
                const audioEnd = EditorState.audioElement ? (EditorState.audioElement.duration || 0) : 0;
                const audioTrimEnd = EditorState.audio?.loaded ? (EditorState.audio.trimmedDuration || audioEnd) : audioEnd;

                const timeFromStart = startPlayPos + (performance.now() - startSysTime) / 1000;

                if (EditorState.audioElement && EditorState.audioElement.currentTime < audioTrimEnd && !EditorState.audioElement.paused) {
                    return EditorState.audioElement.currentTime;
                } else {
                    return timeFromStart;
                }
            });
        }
    } else {
        EditorState.audioElement.pause();
        if (EditorState.bgMusicElement) EditorState.bgMusicElement.pause();

        // Clear external time source when paused
        if (EditorState.preview) {
            EditorState.preview.setTimeSource(null);
        }
    }
}

/**
 * Seek audio to specific time
 */
function seekAudio(time) {
    if (EditorState.audioElement && EditorState.audio?.loaded) {
        EditorState.audioElement.currentTime = Math.min(time, EditorState.audioElement.duration || 999);
    }
    if (EditorState.bgMusicElement && EditorState.bgMusic) {
        EditorState.bgMusicElement.currentTime = time % (EditorState.bgMusic.duration || 999);
    }
}

/**
 * Update play button icon
 */
function updatePlayButton() {
    if (!elements.playBtn) return;

    if (EditorState.isPlaying) {
        elements.playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
            </svg>
        `;
    } else {
        elements.playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4"/>
            </svg>
        `;
    }
}

/**
 * Start playback loop (fallback when no preview - uses helper functions)
 */
function startPlayback() {
    if (!EditorState.isPlaying) return;

    const startTime = performance.now();
    const startPosition = EditorState.playbackPosition;

    function tick() {
        if (!EditorState.isPlaying) return;

        const elapsed = (performance.now() - startTime) / 1000;
        EditorState.playbackPosition = startPosition + elapsed;

        const totalDuration = getTotalDuration();
        if (EditorState.playbackPosition >= totalDuration) {
            EditorState.playbackPosition = 0;
            EditorState.isPlaying = false;

            // Return to start
            if (elements.timelineTracks) {
                elements.timelineTracks.scrollLeft = 0;
            }

            togglePlayback();
            return;
        }

        // Scroll timeline using helper
        scrollTimelineToTime(EditorState.playbackPosition);

        updateTimeScrubber();
        updatePlayhead();
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

/**
 * Update playhead position - uses helper functions for precise calculation
 */
function updatePlayhead() {
    const playhead = document.getElementById('timeline-playhead');
    if (playhead) {
        const scrollLeft = elements.timelineTracks ? elements.timelineTracks.scrollLeft : 0;
        const pixelPos = timeToPixels(EditorState.playbackPosition);
        const left = TRACK_BASE_OFFSET + pixelPos - scrollLeft;
        playhead.style.left = `${left}px`;
    }

    // Also update header marker indicator
    updateHeaderMarker();
}

/**
 * Update zoom level - uses helper functions for precise calculation
 */
function updateZoom() {
    // Save to localStorage
    if (EditorState.storageEnabled) localStorage.setItem(STORAGE_KEYS.ZOOM_LEVEL, EditorState.zoomLevel.toString());

    if (elements.zoomLevel) {
        elements.zoomLevel.textContent = `${Math.round(EditorState.zoomLevel * 100)}%`;
    }
    renderTimeline();
    renderTimeRuler();
    renderAudioTrack();

    // Keep playhead visible after zoom by scrolling to current position
    if (elements.timelineTracks) {
        const containerWidth = elements.timelineTracks.clientWidth;
        const pixelPos = timeToPixels(EditorState.playbackPosition);

        // Center the playhead in the view after zoom
        const targetScrollLeft = pixelPos - (containerWidth / 2) + TRACK_BASE_OFFSET;
        elements.timelineTracks.scrollLeft = Math.max(0, targetScrollLeft);
    }

    updatePlayhead();

    // Sync preview with current position
    if (EditorState.preview) {
        EditorState.preview.setScenes(EditorState.scenes);
        EditorState.preview.seek(EditorState.playbackPosition);
    }
}

/**
 * Select media folder using File System Access API
 */
async function selectMediaFolder() {
    if (!('showDirectoryPicker' in window)) {
        showToast('Folder selection not supported in this browser', 'error');
        return;
    }

    try {
        const dirHandle = await window.showDirectoryPicker();
        EditorState.mediaFolder = dirHandle;

        // Scan for media files
        await scanMediaFiles(dirHandle);

        showToast(`Loaded ${EditorState.mediaFiles.size} media files`, 'success');
        elements.mediaStatus.textContent = `${EditorState.mediaFiles.size} files loaded`;

        // Match files to scenes
        matchMediaToScenes();
        renderTimeline();
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error selecting folder:', error);
            showToast('Failed to access folder', 'error');
        }
    }
}

/**
 * Scan directory for media files
 */
async function scanMediaFiles(dirHandle, path = '') {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            const name = entry.name.toLowerCase();
            if (name.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/)) {
                EditorState.mediaFiles.set(entry.name, { handle: entry, path: path });
            }
        } else if (entry.kind === 'directory') {
            await scanMediaFiles(entry, `${path}${entry.name}/`);
        }
    }
}

/**
 * Match media files to scenes
 */
async function matchMediaToScenes() {
    for (const scene of EditorState.scenes) {
        if (!scene.image) continue;

        // Try exact match first
        let fileEntry = EditorState.mediaFiles.get(scene.image);

        // Try without extension
        if (!fileEntry) {
            const baseName = scene.image.replace(/\.[^/.]+$/, '');
            for (const [name, entry] of EditorState.mediaFiles) {
                if (name.toLowerCase().startsWith(baseName.toLowerCase())) {
                    fileEntry = entry;
                    break;
                }
            }
        }

        if (fileEntry) {
            try {
                const file = await fileEntry.handle.getFile();
                scene.mediaUrl = URL.createObjectURL(file);
                scene.mediaLoaded = true;
            } catch (error) {
                console.warn(`Failed to load ${scene.image}:`, error);
            }
        }
    }

    // Hide placeholder if we have media
    if (EditorState.scenes.some(s => s.mediaLoaded)) {
        elements.previewPlaceholder?.classList.add('hidden');
    }

    // Update preview with loaded media
    if (EditorState.preview) {
        EditorState.preview.setScenes(EditorState.scenes);
        EditorState.preview.render();
    }
}

/**
 * Randomize scene media — fetches all asset files per scene from the API,
 * then picks a random file from each scene's own subfolder.
 */
async function randomizeSceneMedia() {
    const projectId = EditorState.project?.id;
    if (!projectId) {
        showToast('No project loaded', 'warning');
        return;
    }

    // Always fetch latest to ensure we see newly added files
    try {
        const resp = await fetch(`/api/assets/project/${encodeURIComponent(projectId)}`);
        if (!resp.ok) throw new Error(resp.status);
        EditorState._assetFilesCache = await resp.json();
    } catch (e) {
        showToast('Failed to load asset files', 'error');
        console.error('Asset fetch error:', e);
        return;
    }

    const assetScenes = EditorState._assetFilesCache.scenes || {};
    let assignedCount = 0;
    const mediaTypeLimit = document.getElementById('randomize-media-type')?.value || 'mixed';

    for (let i = 0; i < EditorState.scenes.length; i++) {
        const scene = EditorState.scenes[i];
        if (scene.type === 'text' || scene.type === 'cta') continue;

        // Find this scene's asset folder using its true index
        const sceneNumber = String(i);
        const sceneAsset = assetScenes[sceneNumber] || assetScenes[String(scene.id)];
        const files = sceneAsset?.files_on_disk;
        if (!files || !files.length) continue;

        // Filter to only image/video files
        const mediaFiles = files.filter(f => {
            const ext = (f.filename || '').split('.').pop().toLowerCase();
            const isImg = IMAGE_EXTENSIONS.includes(ext);
            const isVid = VIDEO_EXTENSIONS.includes(ext);

            if (mediaTypeLimit === 'images' && !isImg) return false;
            if (mediaTypeLimit === 'videos' && !isVid) return false;

            return isImg || isVid;
        });
        if (!mediaFiles.length) continue;

        // Pick a random media file from this scene's asset folder
        const pick = mediaFiles[Math.floor(Math.random() * mediaFiles.length)];

        // Only update if it's different to be efficient
        if (scene.image !== pick.filename || scene.mediaUrl !== pick.url) {
            scene.mediaUrl = pick.url;
            scene.image = pick.filename;
            scene.mediaLoaded = true;

            const isVideo = isVideoFile(pick.filename);
            scene.isVideo = isVideo;

            if (isVideo) {
                // Extract video metadata + thumbnail
                const meta = await getVideoMeta(pick.url);
                if (meta) {
                    scene.videoDuration = meta.duration;
                    scene.videoThumb = meta.thumbDataUrl;
                } else {
                    scene.videoDuration = null;
                    scene.videoThumb = null;
                }
            } else {
                // Clear video flags for image files
                scene.isVideo = false;
                scene.videoDuration = null;
                scene.videoThumb = null;
            }

            // Update DOM thumbnail with correct type info
            updateSceneClipThumb(scene.id, pick.url, isVideo, scene.videoThumb);

            // Clear only this specific scene from preview cache
            if (EditorState.preview) {
                EditorState.preview.imageCache.delete(scene.id);
            }

            assignedCount++;
        }
    }

    if (assignedCount === 0) {
        showToast('No new media assigned', 'info');
        return;
    }

    // Recalculate total duration
    recalculateDuration();

    // Re-sync preview so the new media is preloaded and rendered
    if (EditorState.preview) {
        EditorState.preview.setScenes(EditorState.scenes);
    }

    // Refresh timeline and media grid to show updated thumbnails and video badges
    renderTimeline();
    renderMediaGrid();

    // Record edit action
    recordEdit('Randomize scene media', 'all', 'media', null, null);
    saveProjectEdits();

    // Show summary with image/video counts
    const videoCount = EditorState.scenes.filter(s => s.isVideo).length;
    const imageCount = EditorState.scenes.filter(s => s.mediaUrl && !s.isVideo && s.type !== 'text' && s.type !== 'cta').length;
    const parts = [];
    if (imageCount) parts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);
    if (videoCount) parts.push(`${videoCount} video${videoCount > 1 ? 's' : ''}`);
    showToast(`Randomized ${assignedCount} scenes (${parts.join(' + ')})`, 'success');
}

/**
 * Get prepared export data with audio config
 */
function getExportData() {
    console.log('[Editor] getExportData() called');
    console.log('[Editor] Project:', EditorState.project?.id, EditorState.project?.name);
    console.log('[Editor] Scenes:', EditorState.scenes?.length);
    console.log('[Editor] Selected profile:', EditorState.selectedExportProfile);

    // Prepare audio config if audio is loaded
    const audioConfig = EditorState.audio?.loaded ? {
        file: EditorState.audio.file,
        path: EditorState.audio.path,
        duration: EditorState.audio.duration,
        trimmedDuration: EditorState.audio.trimmedDuration,
        volume: 1.0,
        start_offset: 0
    } : null;

    console.log('[Editor] Audio config:', audioConfig ? { file: audioConfig.file, path: audioConfig.path, dur: audioConfig.duration } : 'none');
    console.log('[Editor] Captions enabled:', EditorState.captionsEnabled, '| entries:', EditorState.captionData?.captions?.length || 0);
    console.log('[Editor] BgMusic:', EditorState.bgMusic ? { file: EditorState.bgMusic.file, vol: EditorState.bgMusic.volume } : 'none');

    // Prepare export data with selected profile and bgMusic
    const profile = EXPORT_PROFILES[EditorState.selectedExportProfile] || EXPORT_PROFILES.yt_shorts;
    console.log('[Editor] Using profile:', profile.id, profile.width + 'x' + profile.height);

    // Deep clone scenes to prevent modifying the state
    let exportScenes = JSON.parse(JSON.stringify(EditorState.scenes));

    // Remove text from scenes if text track is disabled
    if (EditorState.disabledTracks.has('text')) {
        exportScenes = exportScenes.map(s => {
            delete s.text_content;
            return s;
        });
    }

    // Clear scenes if video track is disabled
    if (EditorState.disabledTracks.has('video')) {
        exportScenes = [];
    }

    const data = prepareExportData(
        EditorState.project,
        exportScenes,
        '',
        audioConfig,
        EditorState.captionsEnabled && !EditorState.disabledTracks.has('caption') ? EditorState.captionData : null,
        profile,
        EditorState.disabledTracks.has('bgmusic') ? null : EditorState.bgMusic
    );

    console.log('[Editor] Export data prepared:', data.scenes?.length, 'scenes,', data.timeline?.total_duration + 's total');
    return data;
}

/**
 * Preview JSON - Show JSON modal with validation
 */
function previewJson() {
    const exportData = getExportData();

    // Validate export data
    const validation = validateExportData(exportData);

    // Show validation warnings/errors
    if (!validation.valid) {
        showToast(`Export errors: ${validation.errors.join(', ')}`, 'error');
    }

    if (validation.warnings.length > 0) {
        console.warn('Export warnings:', validation.warnings);
        showToast(`Warning: ${validation.warnings[0]}`, 'warning');
    }

    // Show modal with JSON
    const modal = document.getElementById('export-modal');
    const jsonPre = document.getElementById('export-json');

    if (modal && jsonPre) {
        jsonPre.textContent = JSON.stringify(exportData, null, 2);
        modal.classList.add('active');
    }
}

/**
 * Export MP4 - Show profile selector, then process
 */
async function exportMp4() {
    // Show profile selector step
    const modal = document.getElementById('export-progress-modal');
    const stepProfile = document.getElementById('export-step-profile');
    const stepProgress = document.getElementById('export-step-progress');
    if (modal && stepProfile && stepProgress) {
        stepProfile.style.display = '';
        stepProgress.style.display = 'none';
        modal.classList.add('active');
    }
    return; // Wait for user to click "Export" button
}

/**
 * Actually start the export after profile is selected
 */
let currentJobId = null;

async function startExportWithProfile() {
    console.log('[Editor] startExportWithProfile() — preparing export data');
    const exportData = getExportData();

    // Validate export data
    const validation = validateExportData(exportData);

    if (!validation.valid) {
        console.error('[Editor] Export validation failed:', validation.errors);
        showToast(`Export errors: ${validation.errors.join(', ')}`, 'error');
        return;
    }

    if (validation.warnings.length > 0) {
        console.warn('[Editor] Export warnings:', validation.warnings);
    }

    console.log('[Editor] Validation passed. Switching to progress UI...');

    // Switch to progress step
    const stepProfile = document.getElementById('export-step-profile');
    const stepProgress = document.getElementById('export-step-progress');
    if (stepProfile) stepProfile.style.display = 'none';
    if (stepProgress) stepProgress.style.display = '';

    // Show progress modal
    showExportProgress();

    // Track current job for download
    currentJobId = null;

    console.log('[Editor] Calling exportAPI.startExport()...');

    // Start export
    const jobId = await exportAPI.startExport(
        exportData,
        // Progress callback
        (progress, message) => {
            console.log(`[Editor] Export progress: ${progress}% — ${message}`);
            updateExportProgress(progress, message);
        },
        // Complete callback
        (success, result) => {
            if (success) {
                console.log('[Editor] Export completed! Job:', result.jobId, 'Download:', result.downloadUrl);
                currentJobId = result.jobId;
                showExportComplete(result.downloadUrl);
            } else {
                console.error('[Editor] Export failed:', result.error);
                showExportError(result.error);
            }
        }
    );

    if (!jobId) {
        console.warn('[Editor] Export failed to start (no jobId returned)');
        return;
    }

    console.log('[Editor] Export job started:', jobId);
}

/**
 * Show export progress modal
 */
function showExportProgress() {
    if (elements.exportProgressModal) {
        elements.exportProgressModal.classList.add('active');
        elements.exportProgressModal.classList.remove('export-complete', 'export-error');
    }
    if (elements.exportProgressTitle) {
        elements.exportProgressTitle.textContent = 'Exporting Video...';
    }
    if (elements.exportProgressBar) {
        elements.exportProgressBar.style.width = '0%';
    }
    if (elements.exportProgressPercent) {
        elements.exportProgressPercent.textContent = '0%';
    }
    if (elements.exportProgressMessage) {
        elements.exportProgressMessage.textContent = 'Starting export...';
    }
    if (elements.cancelExportBtn) {
        elements.cancelExportBtn.classList.remove('hidden');
    }
    if (elements.previewExportBtn) {
        elements.previewExportBtn.classList.add('hidden');
    }
    if (elements.downloadExportBtn) {
        elements.downloadExportBtn.classList.add('hidden');
    }
}

/**
 * Update export progress
 */
function updateExportProgress(progress, message) {
    if (elements.exportProgressBar) {
        elements.exportProgressBar.style.width = `${progress}%`;
    }
    if (elements.exportProgressPercent) {
        elements.exportProgressPercent.textContent = `${Math.round(progress)}%`;
    }
    if (elements.exportProgressMessage) {
        elements.exportProgressMessage.textContent = message;
    }
}

/**
 * Show export complete state
 */
function showExportComplete(downloadUrl) {
    if (elements.exportProgressModal) {
        elements.exportProgressModal.classList.add('export-complete');
    }
    if (elements.exportProgressTitle) {
        elements.exportProgressTitle.textContent = 'Export Complete!';
    }
    if (elements.exportProgressBar) {
        elements.exportProgressBar.style.width = '100%';
    }
    if (elements.exportProgressPercent) {
        elements.exportProgressPercent.textContent = '100%';
    }
    if (elements.exportProgressMessage) {
        elements.exportProgressMessage.textContent = 'Your video is ready for download';
    }
    if (elements.cancelExportBtn) {
        elements.cancelExportBtn.textContent = 'Close';
        elements.cancelExportBtn.classList.remove('hidden');
    }
    if (elements.previewExportBtn) {
        elements.previewExportBtn.classList.remove('hidden');
    }
    if (elements.downloadExportBtn) {
        elements.downloadExportBtn.classList.remove('hidden');
    }
    showToast('Export completed!', 'success');
}

/**
 * Show export error state
 */
function showExportError(error) {
    if (elements.exportProgressModal) {
        elements.exportProgressModal.classList.add('export-error');
    }
    if (elements.exportProgressTitle) {
        elements.exportProgressTitle.textContent = 'Export Failed';
    }
    if (elements.exportProgressMessage) {
        elements.exportProgressMessage.textContent = error || 'An error occurred during export';
    }
    if (elements.cancelExportBtn) {
        elements.cancelExportBtn.textContent = 'Close';
        elements.cancelExportBtn.classList.remove('hidden');
    }
    if (elements.previewExportBtn) {
        elements.previewExportBtn.classList.add('hidden');
    }
    if (elements.downloadExportBtn) {
        elements.downloadExportBtn.classList.add('hidden');
    }
    showToast(`Export failed: ${error}`, 'error');
}

/**
 * Hide export progress modal
 */
function hideExportProgress() {
    if (elements.exportProgressModal) {
        elements.exportProgressModal.classList.remove('active', 'export-complete', 'export-error');
    }
    // Reset cancel button text
    if (elements.cancelExportBtn) {
        elements.cancelExportBtn.textContent = 'Cancel';
    }
}

/**
 * Setup export progress modal event listeners
 */
function setupExportProgressModal() {
    // Cancel/Close button - handles both cancelling and closing after error
    elements.cancelExportBtn?.addEventListener('click', async () => {
        const isCloseButton = elements.cancelExportBtn.textContent === 'Close';
        if (isCloseButton) {
            // Just close the modal
            hideExportProgress();
        } else {
            // Cancel the export
            await exportAPI.cancelExport();
            hideExportProgress();
            showToast('Export cancelled', 'info');
        }
    });

    // Download button
    elements.downloadExportBtn?.addEventListener('click', () => {
        if (currentJobId) {
            exportAPI.downloadExport(currentJobId);
        }
    });

    // Preview button
    elements.previewExportBtn?.addEventListener('click', () => {
        if (currentJobId) {
            const url = `${exportAPI.baseUrl}/api/export/${currentJobId}/preview`;
            window.open(url, '_blank');
        }
    });
}

/**
 * Setup export profile selector
 */
function setupExportProfileSelector() {
    const grid = document.getElementById('export-profile-grid');
    if (!grid) return;

    // Profile card click
    grid.querySelectorAll('.export-profile-card').forEach(card => {
        card.addEventListener('click', () => {
            grid.querySelectorAll('.export-profile-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            EditorState.selectedExportProfile = card.dataset.profile;
        });
    });

    // Start export button
    document.getElementById('start-export-btn')?.addEventListener('click', () => {
        startExportWithProfile();
    });

    // Close button
    document.getElementById('close-export-profile')?.addEventListener('click', () => {
        hideExportProgress();
    });
}

// ---- Background Music ----

function showMusicPicker() {
    const dialog = document.getElementById('music-picker-dialog');
    if (!dialog) return;
    dialog.classList.remove('hidden');
    dialog.style.display = 'flex';

    // Fetch music library
    fetch('/api/music/library')
        .then(r => r.ok ? r.json() : [])
        .then(files => renderMusicList(files))
        .catch(() => renderMusicList([]));
}

// Expose for inline onclick
window.editorCloseMusicPicker = function () {
    const dialog = document.getElementById('music-picker-dialog');
    if (dialog) { dialog.classList.add('hidden'); dialog.style.display = ''; }
};

window.editorUploadMusic = async function (input) {
    if (!input.files?.length) return;
    const file = input.files[0];
    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await fetch('/api/music/upload', { method: 'POST', body: fd });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        showToast('Music uploaded', 'success');
        // Refresh list
        const files = await fetch('/api/music/library').then(r => r.json()).catch(() => []);
        renderMusicList(files);
    } catch (e) {
        showToast('Upload failed: ' + e.message, 'error');
    }
    input.value = '';
};

function renderMusicList(files) {
    const list = document.getElementById('music-picker-list');
    if (!list) return;
    if (!files.length) {
        list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--text-muted);font-size:12px"><p>No music files yet</p><p style="font-size:11px;opacity:0.6;margin-top:8px">Place .mp3/.wav/.ogg files in output/music/</p></div>';
        return;
    }
    list.innerHTML = files.map(f => `
        <div class="music-picker-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background 0.12s" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''" onclick="selectBgMusic('${f.filename}', '${f.path}', ${f.duration || 0})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-secondary)" stroke-width="1.5"><circle cx="5.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/><path d="M8 17.5V5l12-2v12.5"/></svg>
            <div style="flex:1;min-width:0">
                <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.filename}</div>
                <div style="font-size:10px;color:var(--text-muted)">${f.duration ? formatTimecode(f.duration) : ''} · ${f.size_mb || '?'}MB</div>
            </div>
        </div>
    `).join('');
}

window.selectBgMusic = function (filename, path, duration) {
    EditorState.bgMusic = {
        file: filename,
        path: path,
        duration: duration,
        volume: 0.15,
        duckingEnabled: true,
        duckingLevel: 0.08,
        fadeIn: 2.0,
        fadeOut: 3.0,
        loop: true
    };

    // Create audio element
    if (EditorState.bgMusicElement) {
        EditorState.bgMusicElement.pause();
        EditorState.bgMusicElement = null;
    }
    const audio = new Audio(path);
    audio.volume = EditorState.bgMusic.volume;
    audio.loop = true;
    EditorState.bgMusicElement = audio;

    renderBgMusicTrack();
    window.editorCloseMusicPicker();
    showToast('Background music added', 'success');
};

function renderBgMusicTrack() {
    const track = document.getElementById('bgmusic-track');
    if (!track) return;
    const m = EditorState.bgMusic;
    if (!m) {
        track.innerHTML = '<span class="bgmusic-placeholder">Background music</span>';
        return;
    }
    const totalDur = EditorState.project?.totalDuration || 60;
    const pps = EditorState.pixelsPerSecond * EditorState.zoomLevel;
    const width = totalDur * pps;
    track.innerHTML = `
        <div class="bgmusic-clip" style="width:${width}px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;opacity:0.5"><circle cx="5.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/><path d="M8 17.5V5l12-2v12.5"/></svg>
            <span class="bgmusic-clip-label">${m.file}</span>
            <button class="bgmusic-remove" onclick="removeBgMusic()" title="Remove">&times;</button>
        </div>
    `;
}

window.removeBgMusic = function () {
    if (EditorState.bgMusicElement) {
        EditorState.bgMusicElement.pause();
        EditorState.bgMusicElement = null;
    }
    EditorState.bgMusic = null;
    renderBgMusicTrack();
    showToast('Background music removed', 'info');
};

/**
 * Check if there are unsaved changes (edits since last save/load)
 */
function hasUnsavedChanges() {
    // Check if we have a project loaded
    if (!EditorState.project?.id) return false;

    // Check if there are any edits in history
    if (EditorState.editHistory.length > 0) return true;

    // Check if scenes have been modified from original
    if (EditorState.scenes.length !== EditorState.originalScenes.length) return true;

    // Compare current scenes with original
    for (let i = 0; i < EditorState.scenes.length; i++) {
        const current = EditorState.scenes[i];
        const original = EditorState.originalScenes[i];
        if (!original) return true;

        // Check key editable properties
        if (current.duration !== original.duration ||
            current.visual_fx !== original.visual_fx ||
            current.text_content !== original.text_content ||
            current.text_color !== original.text_color ||
            current.text_size !== original.text_size ||
            current.font_family !== original.font_family ||
            current.text_x !== original.text_x ||
            current.text_y !== original.text_y) {
            return true;
        }
    }

    return false;
}

/**
 * Setup beforeunload warning to prevent accidental window close
 */
function setupBeforeUnloadWarning() {
    window.addEventListener('beforeunload', (e) => {
        // Only warn if there's a project with potential changes
        if (EditorState.project?.id && hasUnsavedChanges()) {
            // Standard way to trigger browser's "Leave site?" dialog
            e.preventDefault();
            // Some browsers require returnValue to be set
            e.returnValue = '';
            return '';
        }
    });
}

/**
 * Setup export modal event listeners
 */
function setupExportModal() {
    const modal = document.getElementById('export-modal');
    const closeBtn = document.getElementById('close-export-modal');
    const copyBtn = document.getElementById('copy-export-json');
    const downloadBtn = document.getElementById('download-export-json');
    const jsonPre = document.getElementById('export-json');

    // Close modal
    closeBtn?.addEventListener('click', () => {
        modal?.classList.remove('active');
    });

    // Close on backdrop click
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && modal?.classList.contains('active')) {
            modal.classList.remove('active');
        }
    });

    // Copy JSON
    copyBtn?.addEventListener('click', async () => {
        const json = jsonPre?.textContent || '';
        try {
            await navigator.clipboard.writeText(json);
            showToast('JSON copied to clipboard', 'success');
        } catch (err) {
            showToast('Failed to copy', 'error');
        }
    });

    // Download JSON
    downloadBtn?.addEventListener('click', () => {
        const json = jsonPre?.textContent || '';
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${EditorState.project?.id || 'export'}_timeline.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('JSON downloaded', 'success');
    });

    // Export progress modal - close on backdrop click (only when complete/error)
    elements.exportProgressModal?.addEventListener('click', (e) => {
        if (e.target === elements.exportProgressModal &&
            (elements.exportProgressModal.classList.contains('export-complete') ||
                elements.exportProgressModal.classList.contains('export-error'))) {
            hideExportProgress();
        }
    });

    // Close progress modal on Escape (only when complete/error)
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && elements.exportProgressModal?.classList.contains('active')) {
            if (elements.exportProgressModal.classList.contains('export-complete') ||
                elements.exportProgressModal.classList.contains('export-error')) {
                hideExportProgress();
            }
        }
    });
}

// ---- Effects Tab ----

function setupEffectsTab() {
    const grid = document.getElementById('fx-grid');
    if (!grid) return;

    // Click on effect cards
    grid.querySelectorAll('.fx-card[data-fx]').forEach(card => {
        card.addEventListener('click', () => {
            const scene = EditorState.selectedScene;
            if (!scene || scene.type === 'text' || scene.type === 'cta') return;

            const oldValue = scene.visual_fx;
            const newValue = card.dataset.fx;
            scene.visual_fx = newValue;
            recordEdit(`Change effect (Scene ${scene.id})`, scene.id, 'visual_fx', oldValue, newValue);
            updateEffectsTab();
            renderSceneProperties();
        });
    });

    // Auto-assign all
    document.getElementById('fx-auto-assign')?.addEventListener('click', () => {
        if (!EditorState.scenes.length) return;

        const roleEffects = {
            hook: ['zoom_in'], buildup: ['pan_right', 'pan_left', 'zoom_in'],
            peak: ['shake', 'zoom_in'], transition: ['fade', 'zoom_out'],
            final: ['zoom_out'], final_statement: ['zoom_out'], cta: ['static'],
        };
        let lastEffect = '';

        EditorState.scenes.forEach(scene => {
            const old = scene.visual_fx;
            if (scene.type === 'text' || scene.type === 'cta') {
                scene.visual_fx = 'static';
            } else {
                const role = scene.narrative_role || scene.scene_type || scene.type || 'buildup';
                const candidates = roleEffects[role] || ['zoom_in', 'pan_right', 'zoom_out'];
                let fx = candidates[0];
                for (const c of candidates) { if (c !== lastEffect) { fx = c; break; } }
                lastEffect = fx;
                scene.visual_fx = fx;
            }
            if (old !== scene.visual_fx) {
                recordEdit(`Auto effect (Scene ${scene.id})`, scene.id, 'visual_fx', old, scene.visual_fx);
            }
        });

        updateEffectsTab();
        renderSceneProperties();
        showToast('Effects auto-assigned', 'success');
    });
}

function updateEffectsTab() {
    const noScene = document.getElementById('fx-no-scene');
    const grid = document.getElementById('fx-grid');
    if (!noScene || !grid) return;

    const scene = EditorState.selectedScene;
    const hasScene = scene && scene.type !== 'text' && scene.type !== 'cta';

    noScene.style.display = hasScene ? 'none' : 'flex';
    grid.style.display = hasScene ? 'flex' : 'none';

    if (!hasScene) return;

    const activeFx = scene.visual_fx || 'static';
    grid.querySelectorAll('.fx-card[data-fx]').forEach(card => {
        card.classList.toggle('active', card.dataset.fx === activeFx);
    });
}

// ---- Transitions Tab ----

function setupTransitionsTab() {
    const grid = document.getElementById('tr-grid');
    if (!grid) return;

    const durationRow = document.getElementById('tr-duration-row');
    const durationSlider = document.getElementById('tr-duration-slider');
    const durationValue = document.getElementById('tr-duration-value');

    // Click on transition cards
    grid.querySelectorAll('.fx-card[data-tr]').forEach(card => {
        card.addEventListener('click', () => {
            const scene = EditorState.selectedScene;
            if (!scene) return;

            const type = card.dataset.tr;
            const oldTr = scene.transition ? JSON.stringify(scene.transition) : 'none';
            let duration = 0;

            if (type === 'crossfade') duration = 0.3;
            else if (type === 'fade_black') duration = 0.4;

            scene.transition = { type, duration };
            recordEdit(`Change transition (Scene ${scene.id})`, scene.id, 'transition', oldTr, JSON.stringify(scene.transition));
            updateTransitionsTab();
        });
    });

    // Duration slider
    durationSlider?.addEventListener('input', (e) => {
        const scene = EditorState.selectedScene;
        if (!scene || !scene.transition) return;

        const val = parseFloat(e.target.value);
        scene.transition.duration = val;
        if (durationValue) durationValue.textContent = val.toFixed(1) + 's';
    });

    // Auto-assign all
    document.getElementById('tr-auto-assign')?.addEventListener('click', () => {
        if (!EditorState.scenes.length) return;

        EditorState.scenes.forEach((scene, i) => {
            const old = scene.transition ? JSON.stringify(scene.transition) : 'none';
            if (i >= EditorState.scenes.length - 1) {
                scene.transition = { type: 'none', duration: 0 };
            } else {
                const role = scene.narrative_role || scene.scene_type || scene.type || 'buildup';
                switch (role) {
                    case 'hook': case 'peak':
                        scene.transition = { type: 'cut', duration: 0 }; break;
                    case 'text': case 'cta':
                        scene.transition = { type: 'fade_black', duration: 0.4 }; break;
                    case 'transition': case 'final': case 'final_statement':
                        scene.transition = { type: 'crossfade', duration: 0.5 }; break;
                    default:
                        scene.transition = { type: 'crossfade', duration: 0.3 }; break;
                }
            }
            if (old !== JSON.stringify(scene.transition)) {
                recordEdit(`Auto transition (Scene ${scene.id})`, scene.id, 'transition', old, JSON.stringify(scene.transition));
            }
        });

        updateTransitionsTab();
        showToast('Transitions auto-assigned', 'success');
    });
}

function updateTransitionsTab() {
    const noScene = document.getElementById('tr-no-scene');
    const grid = document.getElementById('tr-grid');
    if (!noScene || !grid) return;

    const scene = EditorState.selectedScene;

    noScene.style.display = scene ? 'none' : 'flex';
    grid.style.display = scene ? 'flex' : 'none';

    if (!scene) return;

    const tr = scene.transition || { type: 'none', duration: 0 };
    grid.querySelectorAll('.fx-card[data-tr]').forEach(card => {
        card.classList.toggle('active', card.dataset.tr === tr.type);
    });

    // Show/hide duration slider
    const durationRow = document.getElementById('tr-duration-row');
    const durationSlider = document.getElementById('tr-duration-slider');
    const durationValue = document.getElementById('tr-duration-value');

    const hasDuration = tr.type === 'crossfade' || tr.type === 'fade_black';
    if (durationRow) durationRow.style.display = hasDuration ? 'flex' : 'none';
    if (hasDuration && durationSlider) {
        durationSlider.value = tr.duration || 0.3;
        if (durationValue) durationValue.textContent = (tr.duration || 0.3).toFixed(1) + 's';
    }
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboard(e) {
    // Space - Play/Pause
    if (e.code === 'Space' && !e.target.matches('input, textarea, [contenteditable="true"]')) {
        e.preventDefault();
        togglePlayback();
    }

    // Left/Right - Seek
    if (e.code === 'ArrowLeft') {
        EditorState.playbackPosition = Math.max(0, EditorState.playbackPosition - 1);
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
        seekAudio(EditorState.playbackPosition);
        updateTimeScrubber();
        updatePlayhead();
    }
    if (e.code === 'ArrowRight') {
        EditorState.playbackPosition = Math.min(
            EditorState.project.totalDuration,
            EditorState.playbackPosition + 1
        );
        if (EditorState.preview) {
            EditorState.preview.seek(EditorState.playbackPosition);
        }
        seekAudio(EditorState.playbackPosition);
        updateTimeScrubber();
        updatePlayhead();
    }

    // Escape - Deselect
    if (e.code === 'Escape') {
        EditorState.selectedScene = null;
        elements.videoTrack.querySelectorAll('.scene-clip.selected').forEach(el => {
            el.classList.remove('selected');
        });
        renderSceneProperties();
        updateEffectsTab();
        updateTransitionsTab();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
