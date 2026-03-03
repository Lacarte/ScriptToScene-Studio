/**
 * Studio API — Fetches scene/segmenter/assets/alignment data from the main studio backend.
 * Since the timeline editor is served on the same origin, all /api/* endpoints are accessible.
 */

class StudioAPIManager {

    // ---- Scenes ----

    async fetchSceneHistory() {
        const resp = await fetch('/api/scenes/history');
        if (!resp.ok) throw new Error(`Failed to fetch scene history: ${resp.status}`);
        return resp.json();
    }

    async fetchSceneProject(projectId) {
        const resp = await fetch(`/api/scenes/${encodeURIComponent(projectId)}`);
        if (!resp.ok) throw new Error(`Failed to fetch scene project: ${resp.status}`);
        return resp.json();
    }

    // ---- Segmenter ----

    async fetchSegmenterHistory() {
        const resp = await fetch('/api/segmenter/history');
        if (!resp.ok) throw new Error(`Failed to fetch segmenter history: ${resp.status}`);
        return resp.json();
    }

    async fetchSegmenterResult(folder) {
        const resp = await fetch(`/api/segmenter/${encodeURIComponent(folder)}`);
        if (!resp.ok) throw new Error(`Failed to fetch segmenter result: ${resp.status}`);
        return resp.json();
    }

    // ---- Assets ----

    async fetchAssetsHistory() {
        const resp = await fetch('/api/assets/history');
        if (!resp.ok) throw new Error(`Failed to fetch assets history: ${resp.status}`);
        return resp.json();
    }

    async fetchAssetsProject(projectId) {
        const resp = await fetch(`/api/assets/project/${encodeURIComponent(projectId)}`);
        if (!resp.ok) throw new Error(`Failed to fetch asset project: ${resp.status}`);
        return resp.json();
    }

    // ---- Alignment ----

    async fetchAlignmentHistory() {
        const resp = await fetch('/api/timing/history');
        if (!resp.ok) throw new Error(`Failed to fetch alignment history: ${resp.status}`);
        return resp.json();
    }

    /**
     * Transform studio scene format → timeline editor format.
     * Always uses sequential numbering (i + 1) for scene_id.
     */
    transformScenes(studioData) {
        if (!studioData || !studioData.scenes) return [];

        return studioData.scenes.map((scene, i) => ({
            project_id: studioData.project_id || '',
            scene_id: i + 1,
            scene_type: scene.scene_type || this._mapType(scene.type || scene.type_of_scene),
            description: scene.description || scene.image_prompt || '',
            timestamp: scene.timestamp || '0:00',
            duration: scene.duration || 3,
            prompt: scene.prompt || scene.image_prompt || '',
            visual_fx: scene.visual_fx || 'static',
            style: scene.style || studioData.style || '',
            text_content: scene.text_content || '',
            text_bg: scene.text_bg || '',
            status: scene.status || 'pending',
            image_url: scene.image_url || '',
            created_at: scene.created_at || studioData.timestamp || new Date().toISOString(),
            error: scene.error || false,
        }));
    }

    /**
     * Build timeline scenes from assets project + scene data + segmenter timing.
     * Each scene gets its asset image and segmenter-derived duration/timing.
     */
    buildTimelineFromAssets(sceneData, assetsData, segmenterData) {
        if (!sceneData || !sceneData.scenes) return [];

        const scenes = sceneData.scenes;
        const allSegments = segmenterData?.segments || [];
        const assetScenes = assetsData?.scenes || {};
        const assetStatuses = assetsData?.scene_statuses || {};

        // Speech segments only (no fillers) — scenes map 1:1 to these.
        const speechSegments = allSegments.filter(s => !s.is_filler);
        const segmentByIndex = new Map(speechSegments.map(s => [s.index, s]));

        // Compute "full" durations: speech + surrounding silence gaps.
        // Each scene spans from its speech start to the next scene's speech start.
        // The first scene also absorbs any leading silence (before first speech),
        // so total scene time = audioEnd (last segment end).
        const sortedSpeech = [...speechSegments].sort((a, b) => a.start - b.start);
        const audioEnd = allSegments.length > 0
            ? Math.max(...allSegments.map(s => s.end))
            : 0;
        const fullDurationMap = new Map();
        sortedSpeech.forEach((seg, idx) => {
            const nextStart = idx < sortedSpeech.length - 1
                ? sortedSpeech[idx + 1].start
                : audioEnd;
            fullDurationMap.set(seg.index, parseFloat((nextStart - seg.start).toFixed(3)));
        });

        // Add leading silence to the first scene so scenes sum to audioEnd
        if (sortedSpeech.length > 0 && sortedSpeech[0].start > 0) {
            const firstIdx = sortedSpeech[0].index;
            const existing = fullDurationMap.get(firstIdx) || 0;
            fullDurationMap.set(firstIdx, parseFloat((existing + sortedSpeech[0].start).toFixed(3)));
        }

        return scenes.map((scene, i) => {
            const sceneIndex = scene.index ?? i;

            // Get asset image for this scene
            const assetInfo = assetScenes[String(sceneIndex)] || {};
            const statusInfo = assetStatuses[String(sceneIndex)] || {};
            const localFiles = assetInfo.files_on_disk
                ? assetInfo.files_on_disk.map(f => f.url)
                : statusInfo.local_files || [];
            const imageUrl = localFiles.length > 0 ? localFiles[0] : '';

            // Get segmenter timing for this scene.
            // Match by segment index first, fallback to position in speech-only list.
            const segment = segmentByIndex.get(sceneIndex) || speechSegments[i] || null;
            let duration = scene.duration || 3;
            if (segment) {
                const fullDur = fullDurationMap.get(segment.index);
                if (fullDur && fullDur > 0) duration = fullDur;
            }

            return {
                project_id: sceneData.project_id || '',
                scene_id: i + 1,
                scene_type: scene.scene_type || this._mapType(scene.type || scene.type_of_scene),
                description: scene.description || scene.image_prompt || '',
                timestamp: '0:00',
                duration: duration,
                prompt: scene.prompt || scene.image_prompt || '',
                visual_fx: scene.visual_fx || 'static',
                style: scene.style || sceneData.style || '',
                text_content: scene.text_content || '',
                text_bg: scene.text_bg || '',
                status: localFiles.length > 0 ? 'done' : 'pending',
                image_url: imageUrl,
                created_at: scene.created_at || sceneData.timestamp || new Date().toISOString(),
                error: false,
                // Extra fields for timeline display
                asset_files: localFiles,
                segment_start: segment?.start ?? null,
                segment_end: segment?.end ?? null,
                segment_words: segment?.words ?? '',
            };
        });
    }

    _mapType(type) {
        const map = {
            'video': 'buildup',
            'image': 'buildup',
            'text_overlay': 'text',
        };
        return map[type] || type || 'buildup';
    }

    /**
     * Try to find a matching segmenter result for a given scene project.
     * Matches by project_id or source_folder.
     */
    async findSegmenterForProject(studioData) {
        try {
            const history = await this.fetchSegmenterHistory();
            if (!history.length) return null;

            const projectId = studioData.project_id || '';
            const sourceFolder = studioData.source_folder || '';

            // Try exact match on project_id
            let match = history.find(h => h.project_id && h.project_id === projectId);

            // Try match on source_folder
            if (!match && sourceFolder) {
                match = history.find(h => h.source_folder && h.source_folder === sourceFolder);
            }

            // Fallback: return the most recent segmenter result
            if (!match && history.length) {
                match = history[0];
            }

            if (match) {
                return this.fetchSegmenterResult(match.folder);
            }
        } catch (e) {
            console.warn('Could not load segmenter data:', e);
        }
        return null;
    }

    /**
     * Try to find a matching alignment result for a given project.
     * Matches by project_id, falls back to most recent.
     */
    async findAlignmentForProject(projectId) {
        try {
            const history = await this.fetchAlignmentHistory();
            if (!history || !history.length) return null;

            // Try exact match on project_id
            let match = history.find(h => h.project_id && h.project_id === projectId);

            // Fallback: return the most recent alignment
            if (!match && history.length) {
                match = history[0];
            }

            return match || null;
        } catch (e) {
            console.warn('Could not load alignment data:', e);
        }
        return null;
    }
}

export const StudioAPI = new StudioAPIManager();
