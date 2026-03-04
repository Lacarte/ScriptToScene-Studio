/* ================================================================
   ScriptToScene Studio — Editor Module (Timeline Editor iframe)
   ================================================================ */

function initEditorIframe() {
  const iframe = $('#editor-iframe');
  const targetSrc = '/timeline-editor/editor.html';
  if (STATE.editorLoaded && iframe.src.includes(targetSrc)) return;
  STATE.editorLoaded = false;
  iframe.style.display = 'none';
  $('#editor-loading').style.display = '';
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
