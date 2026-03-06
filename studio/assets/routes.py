"""Assets Module — Grabber-based Image Generation & Management Routes"""

import json
import os
import threading
from datetime import datetime
from pathlib import Path

import requests as http_requests
from flask import Blueprint, jsonify, request, send_from_directory
from loguru import logger

from config import ASSETS_DIR
from .organizer import organize_grabber_assets, save_base64_assets

assets_bp = Blueprint("assets", __name__)

# In-memory grabber job tracking
grabber_jobs = {}


def _save_job(job):
    """Persist grabber job state to disk."""
    try:
        job_dir = os.path.join(ASSETS_DIR, job["project_id"])
        os.makedirs(job_dir, exist_ok=True)
        with open(os.path.join(job_dir, "grabber_job.json"), "w") as f:
            json.dump(job, f, indent=2)
    except Exception as e:
        logger.error("Failed to persist job {}: {}", job.get("grabber_id", "?"), e)


def _load_jobs_from_disk():
    """Load existing grabber jobs from disk on startup."""
    if not os.path.isdir(ASSETS_DIR):
        return
    for entry in os.scandir(ASSETS_DIR):
        if not entry.is_dir():
            continue
        job_path = os.path.join(entry.path, "grabber_job.json")
        if not os.path.isfile(job_path):
            continue
        try:
            with open(job_path, "r") as f:
                job = json.load(f)
            pid = job.get("project_id", entry.name)
            # Reconcile with metadata.json for accurate local_files
            meta_path = os.path.join(entry.path, "metadata.json")
            if os.path.isfile(meta_path):
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                for scene_key, scene_meta in meta.get("scenes", {}).items():
                    if scene_key in job.get("scene_statuses", {}):
                        ss = job["scene_statuses"][scene_key]
                        ss["urls"] = scene_meta.get("source_urls", ss.get("urls", []))
                        lf = scene_meta.get("local_files", [])
                        ss["local_files"] = lf
                        # Fix status based on actual files on disk
                        if lf:
                            ss["status"] = "ready"
                        elif ss["urls"] and ss["status"] not in ("error",):
                            ss["status"] = "ready" if _scene_files_exist(entry.path, scene_key) else "pending"
            # Fix overall status
            statuses = [s["status"] for s in job.get("scene_statuses", {}).values()]
            if statuses:
                if all(s in ("ready", "error") for s in statuses):
                    job["status"] = "done"
                elif any(s == "downloading" for s in statuses):
                    job["status"] = "downloading"
            grabber_jobs[pid] = job
        except (json.JSONDecodeError, OSError, KeyError) as e:
            logger.warning("Skipped loading job from {}: {}", entry.name, e)


def _scene_files_exist(project_path, scene_num):
    """Check if a scene subfolder has any downloaded files."""
    scene_dir = os.path.join(project_path, str(scene_num))
    if not os.path.isdir(scene_dir):
        return False
    return any(f.is_file() for f in Path(scene_dir).iterdir())


# Load existing jobs on module import
_load_jobs_from_disk()


# ---------------------------------------------------------------------------
# Grabber Routes
# ---------------------------------------------------------------------------

@assets_bp.route("/api/assets/grabber/start", methods=["POST"])
def grabber_start():
    """Initialize a grabber job — prepares prompts for Automa to consume."""
    data = request.get_json(silent=True)
    if not data or not data.get("scenes"):
        return jsonify({"error": "No scenes provided"}), 400

    project_id = data.get("project_id", "default")
    provider = data.get("provider", "midjourney")
    arguments = data.get("arguments", "-v 7 -ar 9:16")
    scenes = data.get("scenes", [])
    consistency = data.get("consistency")  # {character, setting, mood} from blueprint

    grabber_id = f"grab_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{project_id}"

    # Build consistency prefix for visual consistency across all scenes
    consistency_prefix = ""
    if consistency:
        parts = []
        if consistency.get("character"):
            parts.append(consistency["character"])
        if consistency.get("setting"):
            parts.append(consistency["setting"])
        if consistency.get("mood"):
            parts.append(consistency["mood"])
        if parts:
            consistency_prefix = ", ".join(parts) + ". "
            logger.info("Applying consistency prefix to {} scene prompts", len(scenes))

    # Build Automa-compatible payload (prepend consistency prefix to each prompt)
    automa_payload = {
        "projectId": project_id,
        "arguments": arguments if provider == "midjourney" else "",
        "scenes": [
            {"prompt": consistency_prefix + s["prompt"], "scene": s["scene"]}
            for s in scenes if s.get("prompt")
        ],
    }

    # Per-scene status tracking
    scene_statuses = {}
    for s in automa_payload["scenes"]:
        scene_statuses[str(s["scene"])] = {
            "status": "pending",
            "urls": [],
            "local_files": [],
        }

    job = {
        "grabber_id": grabber_id,
        "project_id": project_id,
        "provider": provider,
        "arguments": arguments,
        "payload": automa_payload,
        "scene_statuses": scene_statuses,
        "status": "waiting",  # waiting | grabbing | downloading | done | error
        "created_at": datetime.now().isoformat(),
    }

    grabber_jobs[project_id] = job
    _save_job(job)

    logger.info("Grabber job created: {} ({} scenes)", grabber_id, len(automa_payload["scenes"]))
    return jsonify({
        "grabber_id": grabber_id,
        "project_id": project_id,
        "scene_count": len(automa_payload["scenes"]),
    })


@assets_bp.route("/api/assets/grabber/pending")
def grabber_pending():
    """Return the most recent pending grabber payload for Automa to consume."""
    latest = None
    for job in grabber_jobs.values():
        if job["status"] in ("waiting", "grabbing"):
            if not latest or job["created_at"] > latest["created_at"]:
                latest = job

    if not latest:
        return jsonify({"error": "No pending grabber jobs"}), 404

    latest["status"] = "grabbing"
    _save_job(latest)
    return jsonify(latest["payload"])


@assets_bp.route("/api/assets/grabber/results", methods=["POST"])
def grabber_results():
    """Receive scraped image URLs from Automa and download them."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # data format: [{ projectId, scenes: [{ scene, url: [...] }] }]
    results = data if isinstance(data, list) else [data]

    for project in results:
        project_id = project.get("projectId", "")
        job = grabber_jobs.get(project_id)
        if not job:
            logger.warning("Grabber results for unknown project: {}", project_id)
            continue

        job["status"] = "downloading"
        scenes = project.get("scenes", [])
        logger.info("Received results for {}: {} scenes", project_id, len(scenes))

        # Download images in a background thread
        def _download_all(pid, job_ref, scene_list):
            for scene_entry in scene_list:
                scene_num = str(scene_entry.get("scene", ""))
                urls = scene_entry.get("url", [])
                if not urls:
                    logger.warning("Scene {} has no URLs, skipping", scene_num)
                    continue

                if scene_num in job_ref["scene_statuses"]:
                    job_ref["scene_statuses"][scene_num]["status"] = "downloading"
                    job_ref["scene_statuses"][scene_num]["urls"] = urls

                _save_job(job_ref)
                logger.info("Downloading scene {} ({} URLs)...", scene_num, len(urls))

                try:
                    local_files = organize_grabber_assets(
                        project_id=pid,
                        scene_num=scene_num,
                        urls=urls,
                        assets_dir=ASSETS_DIR,
                    )
                    if scene_num in job_ref["scene_statuses"]:
                        job_ref["scene_statuses"][scene_num]["status"] = "ready"
                        job_ref["scene_statuses"][scene_num]["local_files"] = local_files
                    logger.success("Scene {} ready: {} files downloaded", scene_num, len(local_files))
                except Exception as e:
                    logger.error("Download failed for scene {}: {}", scene_num, e)
                    if scene_num in job_ref["scene_statuses"]:
                        job_ref["scene_statuses"][scene_num]["status"] = "error"

                _save_job(job_ref)

            # Check if all scenes are done
            all_done = all(
                s["status"] in ("ready", "error")
                for s in job_ref["scene_statuses"].values()
            )
            if all_done:
                job_ref["status"] = "done"
                _save_job(job_ref)
                logger.success("Grabber job complete for {}", pid)

        threading.Thread(
            target=_download_all,
            args=(project_id, job, scenes),
            daemon=True,
        ).start()

    return jsonify({"status": "downloading", "projects": len(results)})


@assets_bp.route("/api/assets/grabber/upload", methods=["POST"])
def grabber_upload():
    """Receive base64 image data from Automa (for CDN URLs that require auth).

    Expected format:
    {
      "projectId": "pm_XXX",
      "scenes": [
        {
          "scene": 0,
          "images": [
            {"data": "base64...", "source_url": "https://cdn...", "ext": ".png"},
            ...
          ]
        }
      ]
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    project_id = data.get("projectId", "")
    scenes = data.get("scenes", [])
    if not project_id or not scenes:
        return jsonify({"error": "Missing projectId or scenes"}), 400

    job = grabber_jobs.get(project_id)
    if job:
        job["status"] = "downloading"

    logger.info("Upload received for {}: {} scenes", project_id, len(scenes))

    def _save_all(pid, job_ref, scene_list):
        for scene_entry in scene_list:
            scene_num = str(scene_entry.get("scene", ""))
            images = scene_entry.get("images", [])
            if not images:
                continue

            if job_ref and scene_num in job_ref["scene_statuses"]:
                job_ref["scene_statuses"][scene_num]["status"] = "downloading"
                _save_job(job_ref)

            logger.info("Saving scene {} ({} images)...", scene_num, len(images))
            try:
                local_files = save_base64_assets(
                    project_id=pid,
                    scene_num=scene_num,
                    images=images,
                    assets_dir=ASSETS_DIR,
                )
                if job_ref and scene_num in job_ref["scene_statuses"]:
                    job_ref["scene_statuses"][scene_num]["status"] = "ready"
                    job_ref["scene_statuses"][scene_num]["local_files"] = local_files
                    job_ref["scene_statuses"][scene_num]["urls"] = [
                        img.get("source_url", "") for img in images
                    ]
                logger.success("Scene {} saved: {} files", scene_num, len(local_files))
            except Exception as e:
                logger.error("Save failed for scene {}: {}", scene_num, e)
                if job_ref and scene_num in job_ref["scene_statuses"]:
                    job_ref["scene_statuses"][scene_num]["status"] = "error"

            if job_ref:
                _save_job(job_ref)

        if job_ref:
            all_done = all(
                s["status"] in ("ready", "error")
                for s in job_ref["scene_statuses"].values()
            )
            if all_done:
                job_ref["status"] = "done"
                _save_job(job_ref)
                logger.success("Upload job complete for {}", pid)

    threading.Thread(
        target=_save_all,
        args=(project_id, job, scenes),
        daemon=True,
    ).start()

    return jsonify({"status": "saving", "scenes": len(scenes)})


@assets_bp.route("/api/assets/grabber/status/<project_id>")
def grabber_status(project_id):
    """Poll grabber job status — frontend calls this every 5s."""
    job = grabber_jobs.get(project_id)
    if not job:
        return jsonify({"error": "No grabber job found"}), 404

    return jsonify({
        "grabber_id": job["grabber_id"],
        "project_id": project_id,
        "status": job["status"],
        "scene_statuses": job["scene_statuses"],
    })


# ---------------------------------------------------------------------------
# Re-download — retry downloading assets for scenes that failed or are pending
# ---------------------------------------------------------------------------

@assets_bp.route("/api/assets/redownload/<project_id>", methods=["POST"])
def redownload_assets(project_id):
    """Re-attempt downloads for scenes with URLs but no local files."""
    job = grabber_jobs.get(project_id)
    if not job:
        return jsonify({"error": "No grabber job found"}), 404

    # Also check metadata for URLs
    meta_path = os.path.join(ASSETS_DIR, project_id, "metadata.json")
    meta = {}
    if os.path.isfile(meta_path):
        with open(meta_path, "r") as f:
            meta = json.load(f)

    scenes_to_retry = []
    for scene_num, ss in job["scene_statuses"].items():
        has_local = ss.get("local_files") and len(ss["local_files"]) > 0
        # Check actual files on disk
        scene_dir = os.path.join(ASSETS_DIR, project_id, str(scene_num))
        has_files = os.path.isdir(scene_dir) and any(
            f.is_file() for f in Path(scene_dir).iterdir()
        )
        if has_local and has_files:
            continue  # already downloaded

        # Get URLs from job or metadata
        urls = ss.get("urls", [])
        if not urls:
            scene_meta = meta.get("scenes", {}).get(str(scene_num), {})
            urls = scene_meta.get("source_urls", [])
        if urls:
            scenes_to_retry.append({"scene": scene_num, "url": urls})

    if not scenes_to_retry:
        return jsonify({"status": "nothing_to_retry", "message": "All scenes already downloaded"})

    job["status"] = "downloading"
    _save_job(job)

    def _retry_downloads(pid, job_ref, scene_list):
        for entry in scene_list:
            sn = str(entry["scene"])
            urls = entry["url"]
            if sn in job_ref["scene_statuses"]:
                job_ref["scene_statuses"][sn]["status"] = "downloading"
            _save_job(job_ref)
            logger.info("Re-downloading scene {} ({} URLs)", sn, len(urls))

            try:
                local_files = organize_grabber_assets(
                    project_id=pid, scene_num=sn,
                    urls=urls, assets_dir=ASSETS_DIR,
                )
                if sn in job_ref["scene_statuses"]:
                    job_ref["scene_statuses"][sn]["status"] = "ready"
                    job_ref["scene_statuses"][sn]["local_files"] = local_files
                logger.success("Re-download scene {} done: {} files", sn, len(local_files))
            except Exception as e:
                logger.error("Re-download failed for scene {}: {}", sn, e)
                if sn in job_ref["scene_statuses"]:
                    job_ref["scene_statuses"][sn]["status"] = "error"
            _save_job(job_ref)

        all_done = all(
            s["status"] in ("ready", "error")
            for s in job_ref["scene_statuses"].values()
        )
        if all_done:
            job_ref["status"] = "done"
            _save_job(job_ref)

    threading.Thread(
        target=_retry_downloads,
        args=(project_id, job, scenes_to_retry),
        daemon=True,
    ).start()

    return jsonify({
        "status": "retrying",
        "scenes_retrying": len(scenes_to_retry),
    })


# ---------------------------------------------------------------------------
# History — list all asset projects
# ---------------------------------------------------------------------------

@assets_bp.route("/api/assets/history")
def assets_history():
    """List all asset projects with metadata summary."""
    projects = []
    if not os.path.isdir(ASSETS_DIR):
        return jsonify(projects)

    for entry in sorted(os.scandir(ASSETS_DIR), key=lambda e: e.stat().st_mtime, reverse=True):
        if not entry.is_dir():
            continue

        project_id = entry.name
        project_info = {
            "project_id": project_id,
            "timestamp": datetime.fromtimestamp(entry.stat().st_mtime).isoformat(),
        }

        # Read grabber job for status info
        job_path = os.path.join(entry.path, "grabber_job.json")
        if os.path.isfile(job_path):
            try:
                with open(job_path, "r") as f:
                    job = json.load(f)
                project_info["grabber_id"] = job.get("grabber_id", "")
                project_info["provider"] = job.get("provider", "")
                project_info["status"] = job.get("status", "unknown")
                project_info["created_at"] = job.get("created_at", "")
                project_info["scene_count"] = len(job.get("scene_statuses", {}))
                # Count ready/pending/error
                statuses = [s["status"] for s in job.get("scene_statuses", {}).values()]
                project_info["ready_count"] = statuses.count("ready")
                project_info["error_count"] = statuses.count("error")
                project_info["pending_count"] = statuses.count("pending")
            except (json.JSONDecodeError, OSError):
                pass

        # Read metadata for file counts
        meta_path = os.path.join(entry.path, "metadata.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                total_files = sum(
                    len(s.get("local_files", []))
                    for s in meta.get("scenes", {}).values()
                )
                project_info["total_files"] = total_files
            except (json.JSONDecodeError, OSError):
                pass

        # Count actual files on disk
        total_disk_files = 0
        for sub in Path(entry.path).iterdir():
            if sub.is_dir() and sub.name not in (".", ".."):
                total_disk_files += sum(1 for f in sub.iterdir() if f.is_file())
        project_info["disk_files"] = total_disk_files

        # Get a preview image (first file from first scene)
        project_info["preview"] = None
        for scene_num in sorted(os.listdir(entry.path)):
            scene_path = os.path.join(entry.path, scene_num)
            if not os.path.isdir(scene_path) or scene_num in (".", ".."):
                continue
            for fname in sorted(os.listdir(scene_path)):
                fpath = os.path.join(scene_path, fname)
                if os.path.isfile(fpath) and fname.lower().endswith(
                    (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov")
                ):
                    project_info["preview"] = f"/output/assets/{project_id}/{scene_num}/{fname}"
                    break
            if project_info["preview"]:
                break

        projects.append(project_info)

    return jsonify(projects)


@assets_bp.route("/api/assets/project/<project_id>")
def get_asset_project(project_id):
    """Get full asset project details — all scenes with local files."""
    project_dir = os.path.join(ASSETS_DIR, project_id)
    if not os.path.isdir(project_dir):
        return jsonify({"error": "Project not found"}), 404

    result = {
        "project_id": project_id,
        "scenes": {},
    }

    # Load metadata
    meta_path = os.path.join(project_dir, "metadata.json")
    if os.path.isfile(meta_path):
        with open(meta_path, "r") as f:
            meta = json.load(f)
        result["scenes"] = meta.get("scenes", {})

    # Load job info
    job_path = os.path.join(project_dir, "grabber_job.json")
    if os.path.isfile(job_path):
        with open(job_path, "r") as f:
            job = json.load(f)
        result["grabber_id"] = job.get("grabber_id", "")
        result["provider"] = job.get("provider", "")
        result["status"] = job.get("status", "unknown")
        result["created_at"] = job.get("created_at", "")
        result["scene_statuses"] = job.get("scene_statuses", {})
        result["prompts"] = {
            str(s["scene"]): s["prompt"]
            for s in job.get("payload", {}).get("scenes", [])
        }

    # Scan actual files on disk per scene
    for scene_num_dir in sorted(os.listdir(project_dir)):
        scene_path = os.path.join(project_dir, scene_num_dir)
        if not os.path.isdir(scene_path):
            continue
        try:
            int(scene_num_dir)  # only numeric subdirs are scenes
        except ValueError:
            continue

        files_on_disk = []
        for fname in sorted(os.listdir(scene_path)):
            fpath = os.path.join(scene_path, fname)
            if os.path.isfile(fpath):
                files_on_disk.append({
                    "url": f"/output/assets/{project_id}/{scene_num_dir}/{fname}",
                    "filename": fname,
                    "size": os.path.getsize(fpath),
                })

        if scene_num_dir not in result["scenes"]:
            result["scenes"][scene_num_dir] = {}
        result["scenes"][scene_num_dir]["files_on_disk"] = files_on_disk

    return jsonify(result)


# ---------------------------------------------------------------------------
# Asset serving
# ---------------------------------------------------------------------------

@assets_bp.route("/output/assets/<path:filename>")
def serve_asset(filename):
    """Serve generated asset images."""
    return send_from_directory(ASSETS_DIR, filename)
