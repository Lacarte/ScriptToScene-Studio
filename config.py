"""ScriptToScene Studio — Centralized Configuration

Single source of truth for all directory paths, environment variables,
and shared constants. Import from here instead of computing paths manually.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Root directory (where app.py lives)
# ---------------------------------------------------------------------------
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Directory paths
# ---------------------------------------------------------------------------
STATIC_DIR = os.path.join(ROOT_DIR, "static")
LOG_DIR = os.path.join(ROOT_DIR, "logs")
OUTPUT_DIR = os.path.join(ROOT_DIR, "output")
ALIGN_DIR = os.path.join(OUTPUT_DIR, "alignments")
ALIGN_TRASH_DIR = os.path.join(ALIGN_DIR, "TRASH")
SCENES_DIR = os.path.join(OUTPUT_DIR, "scenes")
ASSETS_DIR = os.path.join(OUTPUT_DIR, "assets")
SEGMENTER_DIR = os.path.join(OUTPUT_DIR, "segmenter")
TIMELINE_EDITOR_DIR = os.path.join(ROOT_DIR, "timeline-editor", "frontend")
BIN_DIR = os.path.join(ROOT_DIR, "bin")

# ---------------------------------------------------------------------------
# Ensure output directories exist
# ---------------------------------------------------------------------------
for _d in (LOG_DIR, ALIGN_DIR, ALIGN_TRASH_DIR, SCENES_DIR, ASSETS_DIR, SEGMENTER_DIR):
    os.makedirs(_d, exist_ok=True)

# ---------------------------------------------------------------------------
# External service URLs (env-overridable)
# ---------------------------------------------------------------------------
N8N_WEBHOOK_URL = os.environ.get(
    "N8N_WEBHOOK_URL", "http://localhost:5678/webhook/scene-generator"
)
N8N_ASSET_WEBHOOK_URL = os.environ.get(
    "N8N_ASSET_WEBHOOK_URL", "http://localhost:5678/webhook/image-generator"
)
