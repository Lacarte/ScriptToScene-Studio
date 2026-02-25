"""Assets Module — Image Generation & Management Routes"""

import os
import threading
from datetime import datetime

import requests as http_requests
from flask import Blueprint, jsonify, request, send_from_directory
from loguru import logger

from config import ASSETS_DIR, N8N_ASSET_WEBHOOK_URL
from .organizer import organize_asset

assets_bp = Blueprint("assets", __name__)

# In-memory asset job tracking
asset_jobs = {}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@assets_bp.route("/api/assets/generate", methods=["POST"])
def generate_asset():
    """Queue an image generation request via n8n webhook."""
    data = request.get_json(silent=True)
    if not data or not data.get("prompt"):
        return jsonify({"error": "No prompt provided"}), 400

    scene_id = data.get("scene_id", 0)
    project_id = data.get("project_id", "default")
    job_id = f"asset_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{scene_id}"

    asset_jobs[job_id] = {
        "status": "generating",
        "scene_id": scene_id,
        "provider": data.get("provider", "midjourney"),
        "prompt": data["prompt"],
        "image_url": None,
        "project_id": project_id,
    }

    def _generate_async():
        try:
            resp = http_requests.post(N8N_ASSET_WEBHOOK_URL, json={
                "job_id": job_id,
                "prompt": data["prompt"],
                "provider": data.get("provider", "midjourney"),
                "scene_id": scene_id,
                "project_id": project_id,
            }, timeout=300)

            if resp.status_code == 200:
                result = resp.json()
                image_url = result.get("image_url", "")

                if image_url:
                    local_url = organize_asset(
                        image_url=image_url,
                        project_id=project_id,
                        scene_id=scene_id,
                        assets_dir=ASSETS_DIR,
                    )
                    asset_jobs[job_id]["image_url"] = local_url
                    asset_jobs[job_id]["status"] = "ready"
                    logger.success("Asset ready: scene {} -> {}", scene_id, local_url)
                else:
                    asset_jobs[job_id]["status"] = "error"
                    logger.error("Asset webhook returned no image_url for scene {}", scene_id)
            else:
                asset_jobs[job_id]["status"] = "error"
                logger.error("Asset webhook returned {} for scene {}", resp.status_code, scene_id)
        except Exception as e:
            logger.error("Asset generation failed for scene {}: {}", scene_id, e)
            asset_jobs[job_id]["status"] = "error"

    threading.Thread(target=_generate_async, daemon=True).start()
    return jsonify({"job_id": job_id, "status": "generating"})


@assets_bp.route("/api/assets/status/<job_id>")
def asset_status(job_id):
    """Check status of an image generation job."""
    job = asset_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "job_id": job_id,
        "status": job["status"],
        "scene_id": job["scene_id"],
        "image_url": job["image_url"],
    })


@assets_bp.route("/output/assets/<path:filename>")
def serve_asset(filename):
    """Serve generated asset images."""
    return send_from_directory(ASSETS_DIR, filename)
