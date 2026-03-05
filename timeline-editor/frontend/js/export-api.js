/**
 * Export API Module
 * Handles communication with the Python backend for video export
 */

import { backendLog } from './utils.js';

const DEFAULT_API_URL = window.location.origin;

// ---- Export Profile Presets ----
export const EXPORT_PROFILES = {
    yt_shorts: {
        id: 'yt_shorts', name: 'YouTube Shorts',
        icon: 'yt_shorts',
        width: 1080, height: 1920, fps: 30, crf: 23,
        codec: 'libx264', pixel_format: 'yuv420p', preset: 'medium',
        desc: '9:16 · 1080×1920'
    },
    tiktok: {
        id: 'tiktok', name: 'TikTok',
        icon: 'tiktok',
        width: 1080, height: 1920, fps: 30, crf: 22,
        codec: 'libx264', pixel_format: 'yuv420p', preset: 'medium',
        desc: '9:16 · 1080×1920'
    },
    reels: {
        id: 'reels', name: 'Reels',
        icon: 'reels',
        width: 1080, height: 1920, fps: 30, crf: 23,
        codec: 'libx264', pixel_format: 'yuv420p', preset: 'medium',
        desc: '9:16 · 1080×1920'
    },
    yt_landscape: {
        id: 'yt_landscape', name: 'YouTube',
        icon: 'youtube',
        width: 1920, height: 1080, fps: 30, crf: 22,
        codec: 'libx264', pixel_format: 'yuv420p', preset: 'medium',
        desc: '16:9 · 1920×1080'
    },
    square: {
        id: 'square', name: 'Square',
        icon: 'square',
        width: 1080, height: 1080, fps: 30, crf: 23,
        codec: 'libx264', pixel_format: 'yuv420p', preset: 'medium',
        desc: '1:1 · 1080×1080'
    }
};

export class ExportAPI {
    constructor(baseUrl = DEFAULT_API_URL) {
        this.baseUrl = baseUrl;
        this.currentJobId = null;
        this.pollInterval = null;
        console.log('[ExportAPI] Initialized with baseUrl:', this.baseUrl);
    }

    /**
     * Check if the backend server is available and FFmpeg is installed
     */
    async checkHealth() {
        const url = `${this.baseUrl}/api/health`;
        console.log('[ExportAPI] Health check:', url);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                console.error('[ExportAPI] Health check failed: HTTP', response.status);
                return { available: false, ffmpeg: false, error: `Server returned ${response.status}` };
            }

            const data = await response.json();
            console.log('[ExportAPI] Health check response:', data);
            backendLog.info('Health check OK', `ffmpeg=${data.ffmpeg} alignment=${data.alignment}`);
            return {
                available: true,
                ffmpeg: data.ffmpeg === true,
                error: null
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('[ExportAPI] Health check timed out');
                return { available: false, ffmpeg: false, error: 'Server timeout' };
            }
            console.error('[ExportAPI] Health check error:', error);
            return { available: false, ffmpeg: false, error: error.message };
        }
    }

    /**
     * Start a video export job
     */
    async startExport(exportData, onProgress, onComplete) {
        console.log('[ExportAPI] Starting export...');
        console.log('[ExportAPI] Project:', exportData.project_id);
        console.log('[ExportAPI] Scenes:', exportData.scenes?.length);
        console.log('[ExportAPI] Output:', exportData.output);
        console.log('[ExportAPI] Audio:', exportData.audio ? { path: exportData.audio.path, vol: exportData.audio.volume } : 'none');
        console.log('[ExportAPI] BgMusic:', exportData.bgMusic ? { path: exportData.bgMusic.path, vol: exportData.bgMusic.volume } : 'none');
        console.log('[ExportAPI] Captions:', exportData.captions?.entries?.length || 0, 'entries');
        console.log('[ExportAPI] Full export data:', JSON.stringify(exportData, null, 2).substring(0, 2000));

        try {
            // Check server health first
            const health = await this.checkHealth();
            console.log('[ExportAPI] Health result:', health);

            if (!health.available) {
                console.error('[ExportAPI] Server not available:', health.error);
                onComplete(false, {
                    error: `Backend server not available. ${health.error || 'Please run run.bat to start the server.'}`
                });
                return null;
            }

            if (!health.ffmpeg) {
                console.error('[ExportAPI] FFmpeg not found on server');
                onComplete(false, {
                    error: 'FFmpeg not found. Please install FFmpeg to bin/ folder.'
                });
                return null;
            }

            onProgress(0, 'Starting export...');

            const url = `${this.baseUrl}/api/export`;
            console.log('[ExportAPI] POST', url, '(payload size:', JSON.stringify(exportData).length, 'bytes)');

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(exportData)
            });

            console.log('[ExportAPI] Response status:', response.status, response.statusText);

            if (!response.ok) {
                let errorMsg = 'Export failed to start';
                try {
                    const error = await response.json();
                    errorMsg = error.error || errorMsg;
                    console.error('[ExportAPI] Server error response:', error);
                } catch (parseErr) {
                    const text = await response.text();
                    console.error('[ExportAPI] Non-JSON error response:', text.substring(0, 500));
                    errorMsg = `Server returned ${response.status}: ${text.substring(0, 100)}`;
                }
                onComplete(false, { error: errorMsg });
                return null;
            }

            const result = await response.json();
            this.currentJobId = result.job_id;
            console.log('[ExportAPI] Export job created:', result);
            backendLog.info('Export job created', `job=${result.job_id} scenes=${exportData.scenes?.length}`);

            // Start polling for status
            this.startPolling(onProgress, onComplete);

            return result.job_id;
        } catch (error) {
            console.error('[ExportAPI] Export start exception:', error);
            backendLog.error('Export start exception', error.message);
            onComplete(false, { error: error.message });
            return null;
        }
    }

    /**
     * Start polling for export status
     */
    startPolling(onProgress, onComplete) {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }

        console.log('[ExportAPI] Starting status polling for job:', this.currentJobId);

        let consecutiveFailures = 0;
        const maxFailures = 5;
        let pollCount = 0;

        const poll = async () => {
            pollCount++;
            const status = await this.getStatus();

            if (!status) {
                consecutiveFailures++;
                console.warn(`[ExportAPI] Poll #${pollCount}: status check failed (${consecutiveFailures}/${maxFailures})`);

                if (consecutiveFailures >= maxFailures) {
                    console.error('[ExportAPI] Too many failures, stopping poll');
                    this.stopPolling();
                    onComplete(false, { error: 'Lost connection to server. Please check if the backend is running.' });
                }
                return;
            }

            consecutiveFailures = 0;
            console.log(`[ExportAPI] Poll #${pollCount}: ${status.status} ${status.progress}% - ${status.message}`);

            onProgress(status.progress, status.message);

            if (status.status === 'completed') {
                console.log('[ExportAPI] Export completed!');
                backendLog.info('Export completed', `job=${this.currentJobId}`);
                this.stopPolling();
                onComplete(true, {
                    jobId: this.currentJobId,
                    downloadUrl: `${this.baseUrl}/api/export/${this.currentJobId}/download`
                });
            } else if (status.status === 'failed') {
                console.error('[ExportAPI] Export failed:', status.error || status.message);
                backendLog.error('Export failed', status.error || status.message);
                this.stopPolling();
                onComplete(false, { error: status.error || status.message });
            }
        };

        poll();
        this.pollInterval = setInterval(poll, 2000);
    }

    /**
     * Stop polling for status
     */
    stopPolling() {
        if (this.pollInterval) {
            console.log('[ExportAPI] Stopping status polling');
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
     * Get status of current export job
     */
    async getStatus() {
        if (!this.currentJobId) return null;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(
                `${this.baseUrl}/api/export/${this.currentJobId}/status`,
                { signal: controller.signal }
            );

            clearTimeout(timeoutId);

            if (!response.ok) {
                console.warn('[ExportAPI] Status response:', response.status);
                return null;
            }
            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('[ExportAPI] Status check timed out');
            } else {
                console.error('[ExportAPI] Status check error:', error);
            }
            return null;
        }
    }

    /**
     * Cancel current export job
     */
    async cancelExport() {
        this.stopPolling();

        if (!this.currentJobId) return;

        console.log('[ExportAPI] Cancelling export:', this.currentJobId);
        try {
            const resp = await fetch(`${this.baseUrl}/api/export/${this.currentJobId}`, {
                method: 'DELETE'
            });
            console.log('[ExportAPI] Cancel response:', resp.status);
        } catch (error) {
            console.error('[ExportAPI] Cancel failed:', error);
        }

        this.currentJobId = null;
    }

    /**
     * Download completed export
     */
    downloadExport(jobId) {
        const url = `${this.baseUrl}/api/export/${jobId || this.currentJobId}/download`;
        console.log('[ExportAPI] Downloading:', url);
        window.open(url, '_blank');
    }
}

/**
 * Prepare comprehensive export data for Python backend
 */
export function prepareExportData(project, scenes, mediaFolder, audioConfig = null, captionData = null, profile = null, bgMusicConfig = null) {
    console.log('[prepareExportData] Building export payload...');
    console.log('[prepareExportData] Project:', project?.id, project?.name);
    console.log('[prepareExportData] Scenes:', scenes?.length);
    console.log('[prepareExportData] Profile:', profile?.id || 'default (yt_shorts)');
    console.log('[prepareExportData] Audio:', audioConfig ? audioConfig.file : 'none');
    console.log('[prepareExportData] Captions:', captionData ? (captionData.captions?.length || 0) + ' entries' : 'none');
    console.log('[prepareExportData] BgMusic:', bgMusicConfig ? bgMusicConfig.file : 'none');

    // Calculate total scenes duration
    const scenesDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

    // Determine total video duration (max of scenes, audio, bgMusic, and captions)
    const audioDuration = audioConfig?.trimmedDuration || audioConfig?.duration || 0;
    const bgMusicDuration = bgMusicConfig?.duration || 0;

    let captionsDuration = 0;
    if (captionData?.captions?.length > 0) {
        const lastCaption = captionData.captions[captionData.captions.length - 1];
        captionsDuration = lastCaption.end || 0;
    }

    const totalDuration = Math.max(scenesDuration, audioDuration, bgMusicDuration, captionsDuration);

    console.log('[prepareExportData] Duration: scenes=', scenesDuration, 'audio=', audioDuration, 'bgMusic=', bgMusicDuration, 'captions=', captionsDuration, 'total=', totalDuration);

    // Use profile settings or defaults
    const p = profile || EXPORT_PROFILES.yt_shorts;

    const data = {
        // Project identification
        project_id: project.id,
        project_name: project.name,

        // Media paths - backend will resolve files from here
        media_base_path: `working-assets/${project.id}`,

        // Output video settings
        output: {
            resolution: {
                width: p.width,
                height: p.height
            },
            fps: p.fps,
            codec: p.codec,
            pixel_format: p.pixel_format,
            preset: p.preset,
            crf: p.crf,
            format: 'mp4',
            profile_id: p.id
        },

        // Audio configuration
        audio: audioConfig ? {
            file: audioConfig.file,
            path: audioConfig.path && audioConfig.path.startsWith('/output/') ? '..' + audioConfig.path : audioConfig.path,
            original_duration: audioConfig.duration,
            trimmed_duration: audioConfig.trimmedDuration || audioConfig.duration,
            volume: audioConfig.volume || 1.0,
            start_offset: audioConfig.start_offset || 0,
            fade_out: 0.5
        } : null,

        // Timeline metadata
        timeline: {
            total_duration: totalDuration,
            scenes_duration: scenesDuration,
            scene_count: scenes.length,
            created_at: new Date().toISOString()
        },

        // Scene-by-scene export data
        scenes: scenes.map((scene, index) => {
            let startTime = 0;
            for (let i = 0; i < index; i++) {
                startTime += scenes[i].duration;
            }

            const mediaType = getMediaType(scene);
            const isTextScene = mediaType === 'text';

            const sceneData = {
                id: scene.id,
                index: index,
                type: scene.type,

                start_time: startTime,
                duration: scene.duration,
                end_time: startTime + scene.duration,

                media: {
                    type: mediaType,
                    file: isTextScene ? null : (scene.image || `${index + 1}.${scene.isVideo ? 'mp4' : 'jpg'}`),
                    path: isTextScene ? null : (scene.mediaUrl && scene.mediaUrl.startsWith('/output/') ? '..' + scene.mediaUrl : `working-assets/${project.id}/${scene.image || `${index + 1}.${scene.isVideo ? 'mp4' : 'jpg'}`}`)
                },

                text: isTextScene ? {
                    content: scene.text_content || scene.script || '',
                    font_family: scene.font_family || 'Inter',
                    font_size: scene.text_size || 48,
                    font_style: scene.font_style || 'bold',
                    color: scene.text_color || 'white',
                    color_hex: (scene.text_color || 'white') === 'white' ? '#ffffff' : '#000000',
                    position: {
                        x: scene.text_x ?? null,
                        y: scene.text_y ?? null
                    },
                    text_align: scene.text_align || 'center',
                    vertical_align: scene.vertical_align || 'center',
                    background: {
                        image: null,
                        image_path: null,
                        fallback_color: (scene.text_color || 'white') === 'white' ? '#000000' : '#ffffff'
                    },
                    fade_in: 0.25,
                    fade_out: 0.25
                } : null,

                effect: getEffectConfig(scene.visual_fx || 'static'),

                transition: scene.transition || {
                    type: index < scenes.length - 1 ? 'crossfade' : 'none',
                    duration: index < scenes.length - 1 ? 0.3 : 0
                }
            };

            console.log(`[prepareExportData] Scene ${index + 1}: type=${mediaType} dur=${scene.duration}s fx=${scene.visual_fx || 'static'} media=${sceneData.media.path || 'text'}`);

            return sceneData;
        }),

        // Captions overlay data
        captions: captionData ? {
            style: captionData.style || {},
            entries: (captionData.captions || []).map(c => ({
                text: c.text,
                start: c.start,
                end: c.end,
                words: c.words || []
            }))
        } : null,

        // Background music layer
        bgMusic: bgMusicConfig ? {
            file: bgMusicConfig.file,
            path: bgMusicConfig.path,
            volume: bgMusicConfig.volume ?? 0.15,
            ducking_enabled: bgMusicConfig.duckingEnabled ?? true,
            ducking_level: bgMusicConfig.duckingLevel ?? 0.08,
            fade_in: bgMusicConfig.fadeIn ?? 2.0,
            fade_out: bgMusicConfig.fadeOut ?? 3.0,
            loop: bgMusicConfig.loop ?? true
        } : null
    };

    console.log('[prepareExportData] Export data ready. Total payload keys:', Object.keys(data));
    return data;
}

/**
 * Get detailed effect configuration for FFmpeg
 */
function getEffectConfig(effectType) {
    const effects = {
        'static': {
            type: 'static',
            description: 'No animation'
        },
        'zoom_in': {
            type: 'zoom_in',
            description: 'Ken Burns zoom in effect',
            start_scale: 1.0,
            end_scale: 1.2,
            anchor: 'center',
            easing: 'ease_in_out'
        },
        'zoom_out': {
            type: 'zoom_out',
            description: 'Ken Burns zoom out effect',
            start_scale: 1.2,
            end_scale: 1.0,
            anchor: 'center',
            easing: 'ease_in_out'
        },
        'pan_left': {
            type: 'pan_left',
            description: 'Horizontal pan from right to left',
            pan_amount: 0.2,
            easing: 'linear'
        },
        'pan_right': {
            type: 'pan_right',
            description: 'Horizontal pan from left to right',
            pan_amount: 0.2,
            easing: 'linear'
        },
        'pan_up': {
            type: 'pan_up',
            description: 'Vertical pan from bottom to top',
            pan_amount: 0.2,
            easing: 'linear'
        },
        'pan_down': {
            type: 'pan_down',
            description: 'Vertical pan from top to bottom',
            pan_amount: 0.2,
            easing: 'linear'
        },
        'fade': {
            type: 'fade',
            description: 'Fade in from black',
            fade_duration: 0.5
        },
        'shake': {
            type: 'shake',
            description: 'Camera shake effect',
            intensity: 5,
            frequency: 20
        }
    };

    return effects[effectType] || effects['static'];
}

/**
 * Get media type for a scene
 */
function getMediaType(scene) {
    if (scene.type === 'text' || scene.type === 'cta') {
        return 'text';
    }

    if (scene.image) {
        const ext = scene.image.split('.').pop().toLowerCase();
        if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
            return 'video';
        }
    }

    return 'image';
}

/**
 * Validate export data before sending to backend
 */
export function validateExportData(exportData) {
    const errors = [];
    const warnings = [];

    console.log('[validateExportData] Validating export data...');

    if (!exportData.project_id) {
        errors.push('Missing project ID');
    }

    if (!exportData.scenes || exportData.scenes.length === 0) {
        errors.push('No scenes to export');
    }

    exportData.scenes?.forEach((scene, index) => {
        if (scene.duration <= 0) {
            errors.push(`Scene ${index + 1}: Invalid duration (${scene.duration}s)`);
        }

        if (scene.media.type === 'image' && !scene.media.file) {
            warnings.push(`Scene ${index + 1}: No media file specified`);
        }

        if (scene.media.type === 'text' && !scene.text?.content) {
            if (scene.type === 'text') {
                warnings.push(`Scene ${index + 1}: Text scene has no script content (will show background only)`);
            }
        }
    });

    if (exportData.audio && !exportData.audio.path) {
        warnings.push('Audio specified but no file path');
    }

    if (exportData.timeline.total_duration <= 0) {
        errors.push('Total duration must be greater than 0');
    }

    const result = { valid: errors.length === 0, errors, warnings };
    console.log('[validateExportData] Result:', result.valid ? 'VALID' : 'INVALID',
        '| errors:', errors.length, '| warnings:', warnings.length);
    if (errors.length) console.error('[validateExportData] Errors:', errors);
    if (warnings.length) console.warn('[validateExportData] Warnings:', warnings);

    return result;
}
