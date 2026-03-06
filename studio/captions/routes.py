"""Captions Module — Generate and manage word-level captions from alignment data."""

import json
import os
import re
from datetime import datetime

from flask import Blueprint, jsonify, request
from loguru import logger

from config import CAPTIONS_DIR, generate_project_id

captions_bp = Blueprint("captions", __name__)

# ---------------------------------------------------------------------------
# Caption style presets
# ---------------------------------------------------------------------------
CAPTION_PRESETS = {
    "bold_popup": {
        "id": "bold_popup",
        "name": "Bold Pop-up",
        "description": "YouTube Shorts style — big, bold, uppercase",
        "font_family": "Montserrat",
        "font_size": 64,
        "font_weight": "800",
        "color": "#FFFFFF",
        "stroke_color": "#000000",
        "stroke_width": 4,
        "background": "none",
        "position_y": 75,
        "animation": "pop",
        "text_transform": "uppercase",
    },
    "subtitle_bar": {
        "id": "subtitle_bar",
        "name": "Subtitle Bar",
        "description": "Clean subtitle with dark background bar",
        "font_family": "Inter",
        "font_size": 42,
        "font_weight": "600",
        "color": "#FFFFFF",
        "stroke_color": "none",
        "stroke_width": 0,
        "background": "rgba(0,0,0,0.7)",
        "position_y": 85,
        "animation": "fade",
        "text_transform": "none",
    },
    "karaoke": {
        "id": "karaoke",
        "name": "Karaoke Highlight",
        "description": "Words light up as they're spoken",
        "font_family": "Bebas Neue",
        "font_size": 72,
        "font_weight": "400",
        "color": "#FFFFFF",
        "highlight_color": "#4ECDC4",
        "stroke_color": "#000000",
        "stroke_width": 3,
        "background": "none",
        "position_y": 70,
        "animation": "highlight",
        "text_transform": "uppercase",
    },
    "minimal": {
        "id": "minimal",
        "name": "Minimal",
        "description": "Small, clean, unobtrusive captions",
        "font_family": "DM Sans",
        "font_size": 36,
        "font_weight": "500",
        "color": "#FFFFFF",
        "stroke_color": "none",
        "stroke_width": 0,
        "background": "none",
        "position_y": 80,
        "animation": "fade",
        "text_transform": "none",
    },
    "single_line": {
        "id": "single_line",
        "name": "Single Line",
        "description": "Negative blend text — viral short-form style",
        "font_family": "Bebas Neue",
        "font_size": 80,
        "font_weight": "900",
        "color": "#FFFFFF",
        "stroke_color": "none",
        "stroke_width": 0,
        "background": "none",
        "position_y": 81,
        "animation": "hard_cut",
        "text_transform": "uppercase",
        "letter_spacing": -0.03,
        "blend_mode": "difference",
        "shadow_color": "rgba(0,0,0,1.00)",
        "shadow_blur": 6,
        "shadow_offset_x": 3,
        "shadow_offset_y": 3,
        "diff_strength": 0.59,
        "overlay_strength": 0.37,
        "overlay_color": "#ffffff",
    },
}


# ---------------------------------------------------------------------------
# Grouping algorithm
# ---------------------------------------------------------------------------
def _group_words_into_captions(alignment, words_per_group=3):
    """Group alignment words into caption chunks of 2-4 words.

    Prefers breaking at punctuation (.,!?;:—) and silence gaps > 0.15s.
    """
    if not alignment:
        return []

    captions = []
    current_words = []
    cap_id = 0

    for i, w in enumerate(alignment):
        current_words.append(w)

        at_limit = len(current_words) >= words_per_group
        at_hard_max = len(current_words) >= 5
        is_last = i == len(alignment) - 1

        # Check for natural break after this word
        has_punct = bool(re.search(r'[.!?,;:\u2014\u2013]$', w["word"]))
        has_gap = False
        if not is_last:
            gap = alignment[i + 1]["begin"] - w["end"]
            has_gap = gap > 0.15

        should_break = is_last or at_hard_max or (at_limit and (has_punct or has_gap))
        # Also break at min 2 words if strong punctuation
        if not should_break and len(current_words) >= 2 and has_punct:
            should_break = True

        if should_break:
            captions.append({
                "id": cap_id,
                "text": " ".join(cw["word"] for cw in current_words),
                "start": round(current_words[0]["begin"], 3),
                "end": round(current_words[-1]["end"], 3),
                "words": [
                    {"word": cw["word"], "begin": round(cw["begin"], 3), "end": round(cw["end"], 3)}
                    for cw in current_words
                ],
            })
            cap_id += 1
            current_words = []

    return captions


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@captions_bp.route("/api/captions/presets")
def get_presets():
    """Return all available caption style presets."""
    return jsonify(list(CAPTION_PRESETS.values()))


@captions_bp.route("/api/captions/generate", methods=["POST"])
def generate_captions():
    """Auto-generate caption groups from alignment data.

    JSON body:
      - alignment: [{word, begin, end}, ...] (required)
      - words_per_group: int (default 3)
      - preset: style preset id (default bold_popup)
      - project_id: optional existing project id
      - source_folder: optional source alignment folder
    """
    data = request.get_json(silent=True) or {}
    alignment = data.get("alignment")
    if not alignment or not isinstance(alignment, list):
        return jsonify({"error": "No alignment data provided"}), 400

    # Blueprint overrides take priority when provided
    blueprint_caption = data.get("blueprint_caption") or {}
    words_per_group = max(2, min(5, int(
        blueprint_caption.get("max_words_per_line")
        or data.get("words_per_group", 3)
    )))
    preset_id = blueprint_caption.get("style_preset") or data.get("preset", "bold_popup")
    style = dict(CAPTION_PRESETS.get(preset_id, CAPTION_PRESETS["bold_popup"]))
    style["preset"] = preset_id

    captions = _group_words_into_captions(alignment, words_per_group)

    if not captions:
        return jsonify({"error": "No captions generated"}), 500

    project_id = data.get("project_id") or generate_project_id("cap")

    result = {
        "project_id": project_id,
        "source_folder": data.get("source_folder", ""),
        "style": style,
        "captions": captions,
        "word_count": sum(len(c["words"]) for c in captions),
        "caption_count": len(captions),
        "timestamp": datetime.now().isoformat(),
    }

    # Auto-save
    job_dir = os.path.join(CAPTIONS_DIR, project_id)
    os.makedirs(job_dir, exist_ok=True)
    with open(os.path.join(job_dir, "captions.json"), "w") as f:
        json.dump(result, f, indent=2)

    logger.success("Generated {} captions from {} words -> {}",
                   len(captions), len(alignment), project_id)
    return jsonify(result)


@captions_bp.route("/api/captions/save", methods=["POST"])
def save_captions():
    """Save edited captions to disk.

    JSON body: full caption project data (with project_id, captions, style).
    """
    data = request.get_json(silent=True) or {}
    project_id = data.get("project_id")
    if not project_id or not data.get("captions"):
        return jsonify({"error": "Missing project_id or captions"}), 400

    data["timestamp"] = datetime.now().isoformat()
    job_dir = os.path.join(CAPTIONS_DIR, project_id)
    os.makedirs(job_dir, exist_ok=True)
    with open(os.path.join(job_dir, "captions.json"), "w") as f:
        json.dump(data, f, indent=2)

    logger.success("Saved {} captions -> {}", len(data["captions"]), project_id)
    return jsonify({"status": "saved", "project_id": project_id})


@captions_bp.route("/api/captions/history")
def list_captions():
    """List all saved caption projects."""
    items = []
    if not os.path.exists(CAPTIONS_DIR):
        return jsonify(items)
    for entry in os.listdir(CAPTIONS_DIR):
        json_path = os.path.join(CAPTIONS_DIR, entry, "captions.json")
        if os.path.isfile(json_path):
            try:
                with open(json_path) as f:
                    data = json.load(f)
                items.append({
                    "project_id": data.get("project_id", entry),
                    "caption_count": data.get("caption_count", len(data.get("captions", []))),
                    "word_count": data.get("word_count", 0),
                    "preset": data.get("style", {}).get("preset", ""),
                    "source_folder": data.get("source_folder", ""),
                    "timestamp": data.get("timestamp", ""),
                })
            except (json.JSONDecodeError, OSError):
                pass
    items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return jsonify(items)


@captions_bp.route("/api/captions/<project_id>")
def get_captions(project_id):
    """Get full caption data for a project."""
    project_id = os.path.basename(project_id)
    json_path = os.path.join(CAPTIONS_DIR, project_id, "captions.json")
    if not os.path.isfile(json_path):
        return jsonify({"error": "Not found"}), 404
    try:
        with open(json_path) as f:
            return jsonify(json.load(f))
    except (json.JSONDecodeError, OSError) as e:
        return jsonify({"error": f"Failed to read caption data: {e}"}), 500
