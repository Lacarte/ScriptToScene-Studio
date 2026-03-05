"""Scenes Module — AI Scene Script Generation Routes"""

import json
import os
from datetime import datetime

import requests as http_requests
from flask import Blueprint, jsonify, request
from loguru import logger

from config import SCENES_DIR, N8N_WEBHOOK_URL, generate_project_id
from studio.scenes.templates import SCENE_STYLE_TEMPLATES, TEMPLATES_BY_ID

scenes_bp = Blueprint("scenes", __name__)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@scenes_bp.route("/api/scenes/templates")
def get_templates():
    """Return all available scene style templates."""
    return jsonify(SCENE_STYLE_TEMPLATES)


@scenes_bp.route("/api/scenes/webhook-url")
def get_webhook_url():
    """Return the current scene webhook URL."""
    return jsonify({"url": N8N_WEBHOOK_URL})


@scenes_bp.route("/api/scenes/generate", methods=["POST"])
def generate_scenes():
    """Forward segmented data to n8n webhook for AI scene generation.

    Accepts JSON body:
      - script: full transcript text
      - style: visual style preset
      - segments: array of {index, words} (non-filler segments only)
      - source_folder, aspect_ratio: optional metadata
      - webhook_url: optional override for the webhook URL
    """
    data = request.get_json(silent=True)
    if not data or not data.get("segments"):
        return jsonify({"error": "No segments data provided"}), 400

    # Build the webhook payload (only what n8n needs)
    style_id = data.get("style", "cinematic")
    template = TEMPLATES_BY_ID.get(style_id, {})
    webhook_payload = {
        "script": data.get("script", ""),
        "style": style_id,
        "style_prompt": data.get("style_prompt") or template.get("style_prompt", ""),
        "segments": data.get("segments", []),
    }

    webhook_url = data.get("webhook_url") or N8N_WEBHOOK_URL

    try:
        resp = http_requests.post(webhook_url, json=webhook_payload, timeout=120)

        if resp.status_code != 200:
            # Extract useful error details from n8n response
            body_text = resp.text[:500]
            logger.error("Scene webhook returned {} — {}", resp.status_code, body_text)
            error_msg = f"Webhook returned {resp.status_code}"
            try:
                err_data = resp.json()
                msg = err_data.get("message", "")
                hint = err_data.get("hint", "")
                if msg:
                    error_msg = msg
                if hint:
                    error_msg += f". {hint}"
            except Exception:
                if body_text:
                    error_msg += f": {body_text[:200]}"
            return jsonify({"error": error_msg}), 502

        # Handle empty or non-JSON responses (common with n8n test webhooks)
        body = resp.text.strip()
        if not body:
            logger.warning("Webhook returned empty body")
            return jsonify({
                "error": "Webhook returned an empty response. If using n8n, make sure "
                         "the workflow is activated and uses the production URL (/webhook/) "
                         "instead of the test URL (/webhook-test/)."
            }), 502

        try:
            result = json.loads(body)
        except json.JSONDecodeError:
            logger.error("Webhook returned non-JSON response")
            return jsonify({
                "error": f"Webhook returned non-JSON response: {body[:200]}"
            }), 502

        # n8n returns an array — unwrap the first element
        if isinstance(result, list):
            if not result:
                return jsonify({"error": "Webhook returned an empty array"}), 502
            result = result[0]

        if not isinstance(result, dict):
            return jsonify({"error": "Webhook returned unexpected format (expected JSON object)"}), 502

        # Save to disk — use incoming project_id from pipeline, fallback to webhook result, fallback to generated
        project_id = data.get("project_id") or result.get("pp_randomId") or result.get("project_id") or generate_project_id("pm")
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
        logger.error("Scene webhook request error: {!r}", e)
        return jsonify({"error": f"Webhook connection error: {e}"}), 502
    except Exception as e:
        logger.exception("Unexpected error in scene generation")
        return jsonify({"error": f"Server error: {e}"}), 500


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
    try:
        with open(json_path) as f:
            return jsonify(json.load(f))
    except (json.JSONDecodeError, OSError) as e:
        return jsonify({"error": f"Failed to read scene data: {e}"}), 500
