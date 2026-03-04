/* ================================================================
   ScriptToScene Studio — Editor Module (Timeline Editor iframe)
   ================================================================ */

function initEditorIframe() {
  const iframe = $('#editor-iframe');
  const targetSrc = '/timeline-editor/editor.html';
  if (STATE.editorLoaded && iframe.src.includes(targetSrc)) return;
  STATE.editorLoaded = false;
  iframe.style.display = 'none';
  $('#editor-loading').style.display = 'flex';
  // Cache-bust to force reload+onload when src is already set
  iframe.src = targetSrc + '?t=' + Date.now();
  iframe.onload = () => {
    STATE.editorLoaded = true;
    $('#editor-loading').style.display = 'none';
    iframe.style.display = 'block';

    // Send scenes data if available
    const scenesData = localStorage.getItem('sts-editor-scenes');
    if (scenesData) {
      try {
        iframe.contentWindow.postMessage({
          type: 'load-scenes',
          data: JSON.parse(scenesData),
        }, '*');
      } catch (e) { console.error('Editor postMessage:', e); }
    }

    // Send captions data if available, or auto-generate from alignment
    const captionsData = localStorage.getItem('sts-editor-captions');
    if (captionsData) {
      try {
        iframe.contentWindow.postMessage({
          type: 'load-captions',
          data: JSON.parse(captionsData),
        }, '*');
      } catch (e) { console.error('Editor captions postMessage:', e); }
    } else {
      // No captions stored — try to auto-generate from alignment data
      _editorAutoGenerateCaptions(iframe);
    }
  };
  iframe.onerror = () => {
    $('#editor-loading').innerHTML = `
      <div style="text-align:center">
        <svg width="40" height="40" fill="none" stroke="var(--coral)" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 12px;opacity:0.7">
          <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
        </svg>
        <p style="color:var(--coral)">Failed to load Timeline Editor</p>
        <p style="font-size:11px;margin-top:4px;color:var(--text-muted)">Ensure the editor files are served at /timeline-editor/</p>
      </div>`;
  };
}

/**
 * Auto-generate captions from alignment data and send to the editor iframe.
 * Tries STATE.alignResult first, then falls back to fetching the most recent alignment from history.
 */
async function _editorAutoGenerateCaptions(iframe) {
  try {
    let alignment = null;
    let sourceFolder = '';

    // 1) Try current alignment result
    if (STATE.alignResult && STATE.alignResult.alignment && STATE.alignResult.alignment.length) {
      alignment = STATE.alignResult.alignment;
      sourceFolder = STATE.alignResult.folder || '';
    }

    // 2) Try captionAlignment (set by captions module)
    if (!alignment && STATE.captionAlignment) {
      alignment = STATE.captionAlignment.word_alignment || STATE.captionAlignment.alignment;
      sourceFolder = STATE.captionAlignment.folder || '';
    }

    // 3) Fallback: fetch the most recent alignment from history
    if (!alignment) {
      try {
        const history = await api('/api/timing/history');
        if (history && history.length) {
          const latest = history[0]; // most recent
          alignment = latest.word_alignment;
          sourceFolder = latest.folder || '';
        }
      } catch { /* ignore */ }
    }

    if (!alignment || !alignment.length) return;

    // Call the captions generate API
    const res = await api('/api/captions/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alignment,
        words_per_group: 3,
        preset: 'bold_popup',
        source_folder: sourceFolder,
      }),
    });

    if (res && res.captions && res.captions.length) {
      // Store for persistence
      localStorage.setItem('sts-editor-captions', JSON.stringify(res));

      // Send to iframe
      iframe.contentWindow.postMessage({
        type: 'load-captions',
        data: res,
      }, '*');

      console.log(`Auto-generated ${res.captions.length} captions from alignment`);
    }
  } catch (e) {
    console.error('Auto-generate captions failed:', e);
  }
}

// Listen for messages from the editor iframe
window.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'editor-export') {
    toast('Export received from editor', 'info');
  }
  if (e.data.type === 'switch-page' && e.data.page) {
    switchPage(e.data.page);
  }
});
