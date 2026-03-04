"""Music Module — Browse and manage background music tracks."""
import os

from flask import Blueprint, jsonify, request, send_from_directory
from loguru import logger
from werkzeug.utils import secure_filename

from config import MUSIC_DIR

music_bp = Blueprint("music", __name__)

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}


def _get_duration(filepath):
    """Try to get audio duration using ffprobe (optional)."""
    import shutil
    import subprocess

    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json",
             "-show_format", filepath],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            return round(float(data.get("format", {}).get("duration", 0)), 2)
    except Exception:
        pass
    return None


@music_bp.route("/api/music/library")
def list_music():
    """List all music files in the library."""
    files = []
    if not os.path.isdir(MUSIC_DIR):
        return jsonify(files)

    for fname in sorted(os.listdir(MUSIC_DIR)):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            continue
        fpath = os.path.join(MUSIC_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 1)
        duration = _get_duration(fpath)
        files.append({
            "filename": fname,
            "path": f"/output/music/{fname}",
            "size_mb": size_mb,
            "duration": duration,
        })
    return jsonify(files)


@music_bp.route("/api/music/upload", methods=["POST"])
def upload_music():
    """Upload a music file to the library."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "No filename"}), 400

    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported format: {ext}"}), 400

    fname = secure_filename(f.filename)
    dest = os.path.join(MUSIC_DIR, fname)
    f.save(dest)
    logger.info(f"Music uploaded: {fname}")

    size_mb = round(os.path.getsize(dest) / (1024 * 1024), 1)
    duration = _get_duration(dest)
    return jsonify({
        "filename": fname,
        "path": f"/output/music/{fname}",
        "size_mb": size_mb,
        "duration": duration,
    })


@music_bp.route("/output/music/<path:filename>")
def serve_music(filename):
    """Serve music files for playback."""
    return send_from_directory(MUSIC_DIR, filename)
