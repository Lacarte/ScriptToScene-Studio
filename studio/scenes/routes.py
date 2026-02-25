"""Scenes Module — AI Scene Script Generation Routes"""

import json
import os
from datetime import datetime

import requests as http_requests
from flask import Blueprint, jsonify, request
from loguru import logger

from config import SCENES_DIR, N8N_WEBHOOK_URL

scenes_bp = Blueprint("scenes", __name__)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@scenes_bp.route("/api/scenes/generate", methods=["POST"])
def generate_scenes():
    """Forward alignment data to n8n webhook for AI scene generation."""
    data = request.get_json(silent=True)
    if not data or not data.get("alignment"):
        return jsonify({"error": "No alignment data provided"}), 400

    try:
        resp = http_requests.post(N8N_WEBHOOK_URL, json=data, timeout=120)
        if resp.status_code != 200:
            logger.error("Scene webhook returned {}: {}", resp.status_code, resp.text[:200])
            return jsonify({"error": f"Webhook returned {resp.status_code}"}), 502

        result = resp.json()

        # Save to disk
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        project_id = f"scene_gen_{timestamp}"
        result["project_id"] = project_id
        result["timestamp"] = datetime.now().isoformat()
        result["source_folder"] = data.get("source_folder", "")

        job_dir = os.path.join(SCENES_DIR, project_id)
        os.makedirs(job_dir, exist_ok=True)
        with open(os.path.join(job_dir, "scenes.json"), "w") as f:
            json.dump(result, f, indent=2)

        logger.success("Generated {} scenes -> {}", len(result.get("scenes", [])), project_id)
        return jsonify(result)

    except http_requests.Timeout:
        return jsonify({"error": "Webhook timed out (120s)"}), 504
    except http_requests.RequestException as e:
        logger.error("Scene webhook error: {}", e)
        return jsonify({"error": f"Webhook error: {str(e)}"}), 502


@scenes_bp.route("/api/scenes/history")
def list_scenes():
    """List all generated scene projects."""
    items = []
    if not os.path.exists(SCENES_DIR):
        return jsonify(items)
    for entry in os.listdir(SCENES_DIR):
        json_path = os.path.join(SCENES_DIR, entry, "scenes.json")
        if os.path.isfile(json_path):
            try:
                with open(json_path) as f:
                    data = json.load(f)
                items.append({
                    "project_id": data.get("project_id", entry),
                    "scene_count": len(data.get("scenes", [])),
                    "timestamp": data.get("timestamp", ""),
                    "source_folder": data.get("source_folder", ""),
                })
            except (json.JSONDecodeError, OSError):
                pass
    items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return jsonify(items)


@scenes_bp.route("/api/scenes/<project_id>")
def get_scenes(project_id):
    """Get full scene data for a project."""
    project_id = os.path.basename(project_id)
    json_path = os.path.join(SCENES_DIR, project_id, "scenes.json")
    if not os.path.isfile(json_path):
        return jsonify({"error": "Not found"}), 404
    with open(json_path) as f:
        return jsonify(json.load(f))
