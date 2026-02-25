"""ScriptToScene Studio — Main Entry Point"""

import argparse
import os
import socket
import subprocess
import sys
import threading
import webbrowser

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from loguru import logger

from config import LOG_DIR, STATIC_DIR, ALIGN_DIR, N8N_WEBHOOK_URL, N8N_ASSET_WEBHOOK_URL

# ---------------------------------------------------------------------------
# Loguru configuration
# ---------------------------------------------------------------------------
logger.remove()

LEVEL_ICONS = {"DEBUG": "\u2502", "INFO": "\u2502", "SUCCESS": "+", "WARNING": "!", "ERROR": "\u2716", "CRITICAL": "\u2716"}


def _console_format(record):
    icon = LEVEL_ICONS.get(record["level"].name, "\u2502")
    colors = {"DEBUG": "dim", "INFO": "white", "SUCCESS": "green", "WARNING": "yellow", "ERROR": "red", "CRITICAL": "red,bold"}
    c = colors.get(record["level"].name, "white")
    ts = record["time"].strftime("%H:%M:%S")
    return f"<dim>{ts}</dim> <{c}>{icon}</{c}> {{message}}\n"


logger.add(sys.stderr, format=_console_format, level="DEBUG", colorize=True)
logger.add(os.path.join(LOG_DIR, "studio_{time:YYYY-MM-DD}.log"),
           level="DEBUG", rotation="1 day", retention="7 days", compression="zip",
           format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level:<7} | {name}:{function}:{line} - {message}")

# ---------------------------------------------------------------------------
# Flask app + Blueprints
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder=None)
CORS(app)

from studio.timing import timing_bp
from studio.scenes import scenes_bp
from studio.assets import assets_bp
from studio.editor import editor_bp

app.register_blueprint(timing_bp)
app.register_blueprint(scenes_bp)
app.register_blueprint(assets_bp)
app.register_blueprint(editor_bp)


# ---------------------------------------------------------------------------
# Core routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory(os.path.join(STATIC_DIR, "css"), filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(STATIC_DIR, "js"), filename)


@app.route("/api/health")
def health():
    from studio.timing.routes import _check_alignment_available, _find_ffmpeg
    return jsonify({
        "status": "ok",
        "alignment": _check_alignment_available(),
        "ffmpeg": _find_ffmpeg() is not None,
    })


@app.route("/api/open-folder", methods=["POST"])
def open_folder():
    data = request.get_json(silent=True) or {}
    folder = os.path.basename(data.get("folder", ""))
    target = os.path.join(ALIGN_DIR, folder)
    if not os.path.isdir(target):
        return jsonify({"error": "Folder not found"}), 404
    if sys.platform == "win32":
        os.startfile(target)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", target])
    else:
        subprocess.Popen(["xdg-open", target])
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Port detection & startup
# ---------------------------------------------------------------------------

def find_available_port(start=5050):
    for p in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("", p))
                return p
            except OSError:
                continue
    return start


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ScriptToScene Studio")
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()
    port = args.port if args.port else find_available_port(5050)

    from studio.timing.routes import _check_alignment_available

    url = f"http://localhost:{port}"

    print()
    print(f"  \033[1mScriptToScene Studio\033[0m")
    print(f"  \033[92m>\033[0m {url}")
    print(f"  \033[90m-\033[0m Alignment: {'available' if _check_alignment_available() else 'unavailable'}")
    print(f"  \033[90m-\033[0m Scene webhook: {N8N_WEBHOOK_URL}")
    print(f"  \033[90m-\033[0m Asset webhook: {N8N_ASSET_WEBHOOK_URL}")
    print()

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
