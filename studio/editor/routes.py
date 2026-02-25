"""Editor Module — Timeline Editor Static File Serving"""

from flask import Blueprint, send_from_directory

from config import TIMELINE_EDITOR_DIR

editor_bp = Blueprint("editor", __name__)


@editor_bp.route("/timeline-editor/<path:filename>")
def serve_timeline_editor(filename):
    """Serve timeline editor static files."""
    return send_from_directory(TIMELINE_EDITOR_DIR, filename)
