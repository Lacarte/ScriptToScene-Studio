"""Segmenter Module — Scene Segmentation Routes"""

import json
import os
from datetime import datetime

from flask import Blueprint, jsonify, request
from loguru import logger

from config import SEGMENTER_DIR

segmenter_bp = Blueprint("segmenter", __name__)


@segmenter_bp.route("/api/segmenter/run", methods=["POST"])
def segment_alignment():
    """Run the segmenter on alignment data.

    Accepts JSON body:
      - alignment: array of {word, begin, end}
      - transcript, source_folder, style, aspect_ratio: optional metadata
      - config: optional {target_min, target_max, hard_max, hard_min, gap_filler}
      - save: boolean (default true) — persist result to disk
    """
    from studio.timing.segmenter import run_segmenter, save_output

    data = request.get_json(silent=True) or {}
    alignment = data.get("alignment")
    if not alignment:
        return jsonify({"error": "No alignment data provided"}), 400

    metadata = {
        "source_folder": data.get("source_folder", ""),
        "style": data.get("style", ""),
        "aspect_ratio": data.get("aspect_ratio", ""),
        "transcript": data.get("transcript", ""),
    }
    config = data.get("config")

    result = run_segmenter(alignment, config, metadata)

    # Save to disk
    should_save = data.get("save", True)
    if should_save:
        project = metadata.get("source_folder") or "untitled"
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        folder = f"{project}_{ts}"
        out_path = os.path.join(SEGMENTER_DIR, folder, "segmented.json")
        save_output(result, out_path)
        result["output_folder"] = folder
        result["output_path"] = out_path
        logger.success("Segmented {} | {} segments -> {}", project, result["stats"]["segment_count"], folder)

    return jsonify(result)


@segmenter_bp.route("/api/segmenter/history")
def segment_history():
    """List saved segmenter results."""
    items = []
    if not os.path.exists(SEGMENTER_DIR):
        return jsonify(items)
    for entry in os.listdir(SEGMENTER_DIR):
        entry_path = os.path.join(SEGMENTER_DIR, entry)
        if not os.path.isdir(entry_path):
            continue
        json_path = os.path.join(entry_path, "segmented.json")
        if not os.path.isfile(json_path):
            continue
        try:
            with open(json_path, "r") as f:
                data = json.load(f)
            meta = data.get("metadata", {})
            stats = data.get("stats", {})
            items.append({
                "folder": entry,
                "source_folder": meta.get("source_folder", ""),
                "total_duration": meta.get("total_duration", 0),
                "segmented_at": meta.get("segmented_at", ""),
                "segment_count": stats.get("segment_count", 0),
                "filler_count": stats.get("filler_count", 0),
                "avg_duration": stats.get("avg_duration", 0),
            })
        except (json.JSONDecodeError, OSError):
            pass
    items.sort(key=lambda x: x.get("segmented_at", ""), reverse=True)
    return jsonify(items)


@segmenter_bp.route("/api/segmenter/<folder>")
def get_segmenter_result(folder):
    """Get full segmenter result for a saved run."""
    folder = os.path.basename(folder)
    json_path = os.path.join(SEGMENTER_DIR, folder, "segmented.json")
    if not os.path.isfile(json_path):
        return jsonify({"error": "Not found"}), 404
    with open(json_path, "r") as f:
        return jsonify(json.load(f))
