"""Editor Module — Timeline Editor Static File Serving + Export API"""

import json
import os
import sys
import uuid
import threading
import traceback

from flask import Blueprint, send_from_directory, request, jsonify, send_file
from loguru import logger

from config import TIMELINE_EDITOR_DIR, OUTPUT_DIR, BIN_DIR, FONTS_DIR
from studio.fonts import FONT_REGISTRY, get_font_path, get_font_url

editor_bp = Blueprint("editor", __name__)

# ---------------------------------------------------------------------------
# Export job storage & output directory
# ---------------------------------------------------------------------------
_export_jobs = {}
EXPORT_DIR = os.path.join(OUTPUT_DIR, "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)
logger.info("Export output directory: {}", EXPORT_DIR)


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

@editor_bp.route("/timeline-editor/<path:filename>")
def serve_timeline_editor(filename):
    """Serve timeline editor static files."""
    return send_from_directory(TIMELINE_EDITOR_DIR, filename)


@editor_bp.route("/fonts/<path:filepath>")
def serve_font_file(filepath):
    """Serve font files from the fonts/ directory for @font-face loading."""
    return send_from_directory(FONTS_DIR, filepath)


# ---------------------------------------------------------------------------
# Font API
# ---------------------------------------------------------------------------

SYSTEM_FONTS = [
    'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana',
    'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Courier New',
]


@editor_bp.route("/api/fonts", methods=["GET"])
def list_fonts():
    """Return combined list of custom + system fonts."""
    fonts = []

    # Custom fonts from registry
    for family, entry in sorted(FONT_REGISTRY.items()):
        variants = {}
        for variant, abs_path in entry['variants'].items():
            variants[variant] = get_font_url(abs_path)
        fonts.append({
            'family': family,
            'source': 'custom',
            'variants': variants,
        })

    # System fonts (no variant URLs — browser resolves them)
    for family in SYSTEM_FONTS:
        fonts.append({
            'family': family,
            'source': 'system',
            'variants': {},
        })

    logger.debug("Font API: {} custom + {} system fonts", len(FONT_REGISTRY), len(SYSTEM_FONTS))
    return jsonify(fonts)


# ---------------------------------------------------------------------------
# Frontend log relay — POST /api/log
# ---------------------------------------------------------------------------

@editor_bp.route("/api/log", methods=["POST"])
def frontend_log():
    """Receive log messages from the frontend and emit via loguru."""
    data = request.get_json(silent=True) or {}
    level = (data.get("level") or "info").upper()
    msg = data.get("message", "")
    ctx = data.get("context", "")
    source = data.get("source", "frontend")

    tag = f"[{source}]"
    full = f"{tag} {msg}" + (f" | {ctx}" if ctx else "")

    if level == "ERROR":
        logger.error(full)
    elif level == "WARNING" or level == "WARN":
        logger.warning(full)
    elif level == "DEBUG":
        logger.debug(full)
    else:
        logger.info(full)

    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Export API
# ---------------------------------------------------------------------------

@editor_bp.route("/api/export", methods=["POST"])
def start_export():
    """Start a video export job."""
    try:
        data = request.json
        if not data:
            logger.warning("Export request with no JSON body")
            return jsonify({"error": "No JSON data provided"}), 400

        required = ["project_id", "scenes"]
        for field in required:
            if field not in data:
                logger.warning("Export missing required field: {}", field)
                return jsonify({"error": f"Missing required field: {field}"}), 400

        job_id = str(uuid.uuid4())
        project_id = data["project_id"]
        scene_count = len(data.get("scenes", []))
        output_filename = f"{project_id}_{job_id[:8]}.mp4"
        output_path = os.path.join(EXPORT_DIR, output_filename)

        logger.info("Export started — job={} project={} scenes={} output={}",
                     job_id[:8], project_id, scene_count, output_filename)

        # Log export settings
        output_cfg = data.get("output", {})
        res = output_cfg.get("resolution", {})
        logger.debug("Export settings: {}x{} {}fps crf={} codec={}",
                      res.get("width", "?"), res.get("height", "?"),
                      output_cfg.get("fps", "?"), output_cfg.get("crf", "?"),
                      output_cfg.get("codec", "?"))

        audio_cfg = data.get("audio")
        if audio_cfg and audio_cfg.get("path"):
            logger.debug("Audio: path={} vol={}",
                          audio_cfg.get("path"), audio_cfg.get("volume", 1.0))
        else:
            logger.debug("Audio: none")

        bg_music = data.get("bgMusic")
        if bg_music:
            logger.debug("BgMusic: path={} vol={} loop={} ducking={}",
                          bg_music.get("path"), bg_music.get("volume"),
                          bg_music.get("loop"), bg_music.get("ducking_enabled"))

        captions = data.get("captions", {})
        cap_entries = captions.get("entries", [])
        if cap_entries:
            logger.debug("Captions: {} entries", len(cap_entries))

        # Log scene summary
        for i, sc in enumerate(data.get("scenes", [])):
            media = sc.get("media", {})
            effect = sc.get("effect", {})
            logger.debug("  Scene {}: type={} dur={}s effect={} path={}",
                          i + 1, media.get("type", "?"), sc.get("duration", "?"),
                          effect.get("type", "static"),
                          (media.get("path") or "n/a")[:60])

        _export_jobs[job_id] = {
            "status": "queued",
            "progress": 0,
            "message": "Job queued",
            "output_path": output_path,
            "output_filename": output_filename,
            "error": None,
        }

        thread = threading.Thread(
            target=_process_video,
            args=(job_id, data, output_path),
            daemon=True,
        )
        thread.start()

        return jsonify({"job_id": job_id, "status": "queued", "message": "Export job started"})

    except Exception as e:
        logger.exception("Export start error")
        return jsonify({"error": str(e)}), 500


def _process_video(job_id, export_data, output_path):
    """Process video in background thread."""
    short_id = job_id[:8]
    try:
        # Import here to avoid circular imports at module load
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "timeline-editor", "backend"))
        from video_processor import VideoProcessor

        logger.info("[{}] Processing started", short_id)
        _export_jobs[job_id]["status"] = "processing"
        _export_jobs[job_id]["message"] = "Starting video processing"

        def update_progress(progress, message):
            _export_jobs[job_id]["progress"] = progress
            _export_jobs[job_id]["message"] = message
            logger.debug("[{}] Progress: {}% — {}", short_id, progress, message)

        processor = VideoProcessor(
            export_data=export_data,
            progress_callback=update_progress,
        )
        processor.process(output_path)

        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        logger.success("[{}] Export completed — {} ({:.1f} MB)",
                       short_id, output_path, file_size / (1024 * 1024))

        _export_jobs[job_id]["status"] = "completed"
        _export_jobs[job_id]["progress"] = 100
        _export_jobs[job_id]["message"] = "Export completed successfully"

    except Exception as e:
        logger.error("[{}] Export FAILED: {}", short_id, e)
        logger.debug("[{}] Traceback:\n{}", short_id, traceback.format_exc())
        _export_jobs[job_id]["status"] = "failed"
        _export_jobs[job_id]["error"] = str(e)
        _export_jobs[job_id]["message"] = f"Export failed: {str(e)}"


@editor_bp.route("/api/export/<job_id>/status", methods=["GET"])
def get_export_status(job_id):
    """Get status of an export job."""
    if job_id not in _export_jobs:
        return jsonify({"error": "Job not found"}), 404

    job = _export_jobs[job_id]
    return jsonify({
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "error": job["error"],
    })


@editor_bp.route("/api/export/<job_id>/download", methods=["GET"])
def download_export(job_id):
    """Download completed export."""
    if job_id not in _export_jobs:
        logger.warning("Download request for unknown job: {}", job_id[:8])
        return jsonify({"error": "Job not found"}), 404

    job = _export_jobs[job_id]
    if job["status"] != "completed":
        logger.warning("Download attempt on non-completed job: {} (status={})", job_id[:8], job["status"])
        return jsonify({"error": "Export not completed yet"}), 400
    if not os.path.exists(job["output_path"]):
        logger.error("Download file missing: {}", job["output_path"])
        return jsonify({"error": "Output file not found"}), 404

    logger.info("Serving download: {}", job["output_filename"])
    return send_file(
        job["output_path"],
        mimetype="video/mp4",
        as_attachment=True,
        download_name=job["output_filename"],
    )


@editor_bp.route("/api/export/<job_id>/preview", methods=["GET"])
def preview_export(job_id):
    """Preview completed export in browser."""
    if job_id not in _export_jobs:
        logger.warning("Preview request for unknown job: {}", job_id[:8])
        return jsonify({"error": "Job not found"}), 404

    job = _export_jobs[job_id]
    if job["status"] != "completed":
        logger.warning("Preview attempt on non-completed job: {} (status={})", job_id[:8], job["status"])
        return jsonify({"error": "Export not completed yet"}), 400
    if not os.path.exists(job["output_path"]):
        logger.error("Preview file missing: {}", job["output_path"])
        return jsonify({"error": "Output file not found"}), 404

    logger.info("Serving preview: {}", job["output_filename"])
    return send_file(
        job["output_path"],
        mimetype="video/mp4",
        as_attachment=False,
    )


@editor_bp.route("/api/export/<job_id>", methods=["DELETE"])
def cancel_export(job_id):
    """Cancel/cleanup an export job."""
    if job_id not in _export_jobs:
        return jsonify({"error": "Job not found"}), 404

    job = _export_jobs[job_id]
    logger.info("Cancelling export job: {} (status={})", job_id[:8], job["status"])
    if os.path.exists(job["output_path"]):
        try:
            os.remove(job["output_path"])
            logger.debug("Removed export file: {}", job["output_path"])
        except OSError as e:
            logger.warning("Could not remove export file: {}", e)

    del _export_jobs[job_id]
    return jsonify({"message": "Job cancelled and cleaned up"})
