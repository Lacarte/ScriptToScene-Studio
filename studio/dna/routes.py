"""DNA Module — Viral Video DNA Analysis & Blueprint Generation Routes."""

import json
import os
import threading
import time
import queue
from datetime import datetime

from flask import Blueprint, Response, jsonify, request
from loguru import logger

from config import DNA_DIR, NICHE_INPUT_DIR, SCENES_DIR, SEGMENTER_DIR

dna_bp = Blueprint("dna", __name__)

# In-memory job tracking
_jobs: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# SSE progress helper
# ---------------------------------------------------------------------------

def _sse_stream(job_id: str):
    """Generator that yields SSE events from a job's progress queue."""
    job = _jobs.get(job_id)
    if not job:
        yield f"data: {json.dumps({'event': 'error', 'message': 'Job not found'})}\n\n"
        return

    q: queue.Queue = job["queue"]
    while True:
        try:
            event = q.get(timeout=120)
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("event") in ("done", "error"):
                break
        except queue.Empty:
            yield f"data: {json.dumps({'event': 'keepalive'})}\n\n"


# ---------------------------------------------------------------------------
# Analysis worker
# ---------------------------------------------------------------------------

def _run_analysis(job_id: str, niche_name: str, folder_path: str):
    """Background worker: extract features → build profile → build blueprint."""
    job = _jobs[job_id]
    q: queue.Queue = job["queue"]

    def emit(step: str, status: str = "running", **extra):
        q.put({"event": "step", "step": step, "status": status, **extra})

    try:
        from viral_dna.schemas import RawFeatures
        from viral_dna.io_utils import save_json

        output_dir = os.path.join(DNA_DIR, niche_name)
        os.makedirs(output_dir, exist_ok=True)

        # Step 1: Text features
        emit("text", "running", message="Extracting text features...")
        from viral_dna.extractors import text as text_ext
        text_features = text_ext.extract(folder_path)
        emit("text", "done")

        # Step 2: Audio features
        emit("audio", "running", message="Extracting audio features...")
        from viral_dna.extractors import audio as audio_ext
        audio_features = audio_ext.extract(folder_path)
        emit("audio", "done")

        # Step 3: Video features
        emit("video", "running", message="Extracting video features...")
        from viral_dna.extractors import video as video_ext
        video_features = video_ext.extract(folder_path)
        emit("video", "done")

        # Step 4: Caption features
        emit("caption", "running", message="Extracting caption features...")
        from viral_dna.extractors import caption as caption_ext
        caption_features = caption_ext.extract(folder_path)
        emit("caption", "done")

        # Save raw features
        raw = RawFeatures(
            video=video_features,
            audio=audio_features,
            text=text_features,
            caption=caption_features,
        )
        save_json(raw.model_dump(), os.path.join(output_dir, "raw_features.json"))

        # Step 5: Build DNA profile
        emit("profile", "running", message="Building DNA profile...")
        from viral_dna.builders.profile import build_profile
        profile = build_profile(raw)
        save_json(profile.model_dump(), os.path.join(output_dir, "dna_profile.json"))
        emit("profile", "done")

        # Step 6: Build niche DNA
        emit("niche", "running", message="Building niche DNA...")
        from viral_dna.builders.niche import build_niche
        niche_dna = build_niche(niche_name, [(niche_name, profile)])
        save_json(niche_dna.model_dump(), os.path.join(output_dir, "niche_dna.json"))
        emit("niche", "done")

        # Step 7: Build blueprint
        emit("blueprint", "running", message="Generating blueprint...")
        from viral_dna.builders.blueprint import build_blueprint
        blueprint = build_blueprint(niche_dna)
        save_json(blueprint.model_dump(), os.path.join(output_dir, "blueprint.json"))
        emit("blueprint", "done")

        job["status"] = "done"
        job["completed_at"] = datetime.now().isoformat()
        q.put({
            "event": "done",
            "niche": niche_name,
            "output_dir": output_dir,
            "blueprint_path": os.path.join(output_dir, "blueprint.json"),
        })

    except Exception as e:
        logger.exception("DNA analysis failed for {}", niche_name)
        job["status"] = "error"
        q.put({"event": "error", "message": str(e)})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@dna_bp.route("/api/dna/niches")
def list_niches():
    """List available niche input folders."""
    from viral_dna.io_utils import list_niche_folders
    niches = list_niche_folders(NICHE_INPUT_DIR)

    # Enrich with analysis status
    for niche in niches:
        output_dir = os.path.join(DNA_DIR, niche["name"])
        niche["analyzed"] = os.path.isfile(os.path.join(output_dir, "blueprint.json"))
        if niche["analyzed"]:
            niche["blueprint_path"] = os.path.join(output_dir, "blueprint.json")
    return jsonify(niches)


@dna_bp.route("/api/dna/analyze", methods=["POST"])
def analyze():
    """Start DNA analysis for a niche folder. Returns job_id for SSE progress."""
    data = request.get_json(silent=True) or {}
    niche_name = data.get("niche", "")
    if not niche_name:
        return jsonify({"error": "No niche name provided"}), 400

    folder_path = os.path.join(NICHE_INPUT_DIR, niche_name)
    if not os.path.isdir(folder_path):
        return jsonify({"error": f"Niche folder not found: {niche_name}"}), 404

    job_id = f"dna_{datetime.now().strftime('%H%M%S')}_{niche_name}"
    _jobs[job_id] = {
        "job_id": job_id,
        "niche": niche_name,
        "status": "running",
        "started_at": datetime.now().isoformat(),
        "queue": queue.Queue(),
    }

    threading.Thread(
        target=_run_analysis,
        args=(job_id, niche_name, folder_path),
        daemon=True,
    ).start()

    return jsonify({"job_id": job_id, "niche": niche_name})


@dna_bp.route("/api/dna/progress/<job_id>")
def progress(job_id):
    """SSE stream of analysis progress."""
    return Response(
        _sse_stream(job_id),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@dna_bp.route("/api/dna/niche/<niche_name>")
def get_niche(niche_name):
    """Get all DNA data for a niche (raw features, profile, blueprint)."""
    output_dir = os.path.join(DNA_DIR, niche_name)
    if not os.path.isdir(output_dir):
        return jsonify({"error": "Niche not analyzed yet"}), 404

    result = {"niche": niche_name}

    for filename in ("raw_features.json", "dna_profile.json", "niche_dna.json", "blueprint.json"):
        fpath = os.path.join(output_dir, filename)
        key = filename.replace(".json", "")
        if os.path.isfile(fpath):
            with open(fpath, "r") as f:
                result[key] = json.load(f)

    # Include blueprint path for pipeline integration
    bp_path = os.path.join(output_dir, "blueprint.json")
    if os.path.isfile(bp_path):
        result["blueprint_path"] = bp_path

    return jsonify(result)


@dna_bp.route("/api/dna/blueprints")
def list_blueprints():
    """List all available blueprints."""
    blueprints = []
    if not os.path.isdir(DNA_DIR):
        return jsonify(blueprints)

    for entry in sorted(os.scandir(DNA_DIR), key=lambda e: e.stat().st_mtime, reverse=True):
        if not entry.is_dir():
            continue
        bp_path = os.path.join(entry.path, "blueprint.json")
        if os.path.isfile(bp_path):
            try:
                with open(bp_path, "r") as f:
                    bp = json.load(f)
                blueprints.append({
                    "niche": entry.name,
                    "path": bp_path,
                    "reference_video": bp.get("reference_video", ""),
                    "target_duration": bp.get("segmentation", {}).get("timing", {}).get("target_duration", 0),
                    "motion_level": bp.get("visual", {}).get("motion_level", ""),
                    "caption_preset": bp.get("caption", {}).get("style_preset", ""),
                    "has_character": bool(bp.get("consistency", {}).get("character", "")),
                    "timestamp": datetime.fromtimestamp(os.path.getmtime(bp_path)).isoformat(),
                })
            except (json.JSONDecodeError, OSError):
                pass

    return jsonify(blueprints)


@dna_bp.route("/api/dna/blueprint/consistency", methods=["PUT"])
def update_consistency():
    """Update the visual consistency fields in a blueprint."""
    data = request.get_json(silent=True) or {}
    niche = data.get("niche", "")
    if not niche:
        return jsonify({"error": "No niche specified"}), 400

    bp_path = os.path.join(DNA_DIR, niche, "blueprint.json")
    if not os.path.isfile(bp_path):
        return jsonify({"error": "Blueprint not found"}), 404

    with open(bp_path, "r") as f:
        bp = json.load(f)

    consistency = bp.get("consistency", {})
    if "character" in data:
        consistency["character"] = data["character"]
    if "setting" in data:
        consistency["setting"] = data["setting"]
    if "mood" in data:
        consistency["mood"] = data["mood"]
    bp["consistency"] = consistency

    with open(bp_path, "w") as f:
        json.dump(bp, f, indent=2)

    logger.info("Updated consistency for niche '{}': char={}, setting={}, mood={}",
                niche, bool(consistency.get("character")),
                bool(consistency.get("setting")), bool(consistency.get("mood")))
    return jsonify({"status": "ok", "consistency": consistency})


@dna_bp.route("/api/dna/score", methods=["POST"])
def score():
    """Score a generated project against DNA blueprint."""
    data = request.get_json(silent=True) or {}
    niche = data.get("niche", "")
    project_id = data.get("project_id", "")

    if not niche:
        return jsonify({"error": "No niche specified"}), 400

    bp_path = os.path.join(DNA_DIR, niche, "blueprint.json")
    if not os.path.isfile(bp_path):
        return jsonify({"error": "Blueprint not found"}), 404

    from viral_dna.schemas import Blueprint as BPModel
    with open(bp_path, "r") as f:
        blueprint = BPModel(**json.load(f))

    # Load project data
    segments = None
    scenes = None
    caption_data = None

    if project_id:
        seg_path = os.path.join(SEGMENTER_DIR, project_id, f"{project_id}_segmented.json")
        if os.path.isfile(seg_path):
            with open(seg_path, "r") as f:
                seg_data = json.load(f)
                segments = seg_data.get("segments", [])

        scene_path = os.path.join(SCENES_DIR, project_id, "scenes.json")
        if os.path.isfile(scene_path):
            with open(scene_path, "r") as f:
                scene_data = json.load(f)
                scenes = scene_data.get("scenes", [])

    from viral_dna.scoring.scorer import score_project
    result = score_project(blueprint, segments=segments, scenes=scenes, caption_data=caption_data)
    result["niche"] = niche
    result["project_id"] = project_id

    return jsonify(result)
