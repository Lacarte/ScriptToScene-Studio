"""Pipeline Module — Orchestrates the full TTS → Timing → Segment → Scenes pipeline.

Provides:
  POST /api/pipeline/run          — start a pipeline job (returns job_id + project_id)
  GET  /api/pipeline/progress/<id> — SSE stream of step-by-step progress
  GET  /api/pipeline/jobs          — list recent pipeline jobs
"""

import json
import os
import re
import shutil
import time
import threading
import uuid
from datetime import datetime
from queue import Queue

import numpy as np
import soundfile as sf
import requests as http_requests
from flask import Blueprint, Response, jsonify, request
from loguru import logger

from config import (
    TTS_DIR, ALIGN_DIR, SEGMENTER_DIR, SCENES_DIR,
    N8N_WEBHOOK_URL, generate_project_id,
)

pipeline_bp = Blueprint("pipeline", __name__)

# ---------------------------------------------------------------------------
# Active jobs
# ---------------------------------------------------------------------------
_jobs = {}
_jobs_lock = threading.Lock()


def _emit(job_id, event):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job:
        job["queue"].put(event)


def _cleanup_old_jobs(max_age_s=600):
    now = time.time()
    with _jobs_lock:
        expired = [jid for jid, j in _jobs.items()
                   if now - j.get("created", 0) > max_age_s]
        for jid in expired:
            del _jobs[jid]


# ===================================================================
# Routes
# ===================================================================

@pipeline_bp.route("/api/pipeline/run", methods=["POST"])
def run_pipeline():
    """Start the full pipeline.

    JSON body:
      - text (required): story text
      - voice: TTS voice (default af_heart)
      - speed: TTS speed 0.5–2.0 (default 1.0)
      - style: scene style (default cinematic)
      - segment_config: segmenter overrides
      - webhook_url: override n8n URL
    """
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400

    _cleanup_old_jobs()
    project_id = generate_project_id()
    job_id = uuid.uuid4().hex[:12]

    config = {
        "text": text,
        "voice": data.get("voice", "af_heart"),
        "speed": max(0.5, min(2.0, float(data.get("speed", 1.0)))),
        "style": data.get("style", "cinematic"),
        "segment_config": data.get("segment_config"),
        "webhook_url": data.get("webhook_url"),
        "project_id": project_id,
    }

    with _jobs_lock:
        _jobs[job_id] = {
            "queue": Queue(),
            "status": "running",
            "project_id": project_id,
            "config": config,
            "results": {},
            "created": time.time(),
        }

    t = threading.Thread(target=_run_pipeline, args=(job_id,), daemon=True)
    t.start()

    return jsonify({"job_id": job_id, "project_id": project_id}), 202


@pipeline_bp.route("/api/pipeline/progress/<job_id>")
def pipeline_progress(job_id):
    """SSE stream of pipeline progress events."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job ID"}), 404

    def stream():
        q = job["queue"]
        while True:
            try:
                event = q.get(timeout=300)
            except Exception:
                with _jobs_lock:
                    status = job.get("status")
                if status in ("done", "error"):
                    yield f"data: {json.dumps({'step': status, 'status': status})}\n\n"
                    break
                continue
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("step") in ("done", "error"):
                break

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                 "X-Accel-Buffering": "no"},
    )


@pipeline_bp.route("/api/pipeline/jobs")
def list_jobs():
    """List recent pipeline jobs."""
    with _jobs_lock:
        return jsonify([
            {
                "job_id": jid,
                "project_id": j.get("project_id"),
                "status": j.get("status"),
                "created": j.get("created"),
            }
            for jid, j in _jobs.items()
        ])


# ===================================================================
# Pipeline runner (background thread)
# ===================================================================

def _run_pipeline(job_id):
    with _jobs_lock:
        job = _jobs[job_id]
        config = job["config"]
    project_id = config["project_id"]
    results = job["results"]

    try:
        # ── Step 1: TTS ─────────────────────────────────────────────
        _emit(job_id, {"step": "tts", "status": "running",
                       "message": "Generating audio..."})
        tts_result = _step_tts(config, project_id)
        results["tts"] = tts_result
        _emit(job_id, {
            "step": "tts", "status": "done",
            "message": f"{tts_result['duration_seconds']:.1f}s audio, "
                       f"{tts_result['words']} words",
            "data": {k: v for k, v in tts_result.items() if k != "wav_path"},
        })

        # ── Step 2: Force Alignment ─────────────────────────────────
        _emit(job_id, {"step": "timing", "status": "running",
                       "message": "Aligning words..."})
        timing_result = _step_timing(tts_result, config, project_id)
        results["timing"] = timing_result
        _emit(job_id, {
            "step": "timing", "status": "done",
            "message": f"{timing_result['word_count']} words aligned "
                       f"in {timing_result['inference_time']:.2f}s",
        })

        # ── Step 3: Segmentation ────────────────────────────────────
        _emit(job_id, {"step": "segment", "status": "running",
                       "message": "Splitting into scenes..."})
        segment_result = _step_segment(timing_result, config, project_id)
        results["segment"] = segment_result
        stats = segment_result.get("stats", {})
        _emit(job_id, {
            "step": "segment", "status": "done",
            "message": f"{stats.get('segment_count', 0)} scenes, "
                       f"avg {stats.get('avg_duration', 0):.1f}s",
        })

        # ── Step 4: Scene Generation (webhook) ──────────────────────
        _emit(job_id, {"step": "scenes", "status": "running",
                       "message": "Generating scene scripts..."})
        scenes_result = _step_scenes(segment_result, config, project_id)
        results["scenes"] = scenes_result
        scene_count = len(scenes_result.get("scenes", []))
        _emit(job_id, {
            "step": "scenes", "status": "done",
            "message": f"{scene_count} scenes generated",
            "data": scenes_result,
        })

        # ── Done ────────────────────────────────────────────────────
        _emit(job_id, {
            "step": "done", "status": "done",
            "message": "Pipeline complete",
            "project_id": project_id,
            "summary": {
                "tts": {k: v for k, v in results["tts"].items()
                        if k != "wav_path"},
                "timing": {
                    "word_count": results["timing"]["word_count"],
                    "inference_time": results["timing"]["inference_time"],
                    "folder": results["timing"]["folder"],
                },
                "segment": {
                    "stats": results["segment"].get("stats"),
                },
                "scenes": results["scenes"],
            },
        })

        with _jobs_lock:
            job["status"] = "done"

    except Exception as e:
        logger.exception("Pipeline failed")
        _emit(job_id, {"step": "error", "status": "error", "message": str(e)})
        with _jobs_lock:
            job["status"] = "error"


# ===================================================================
# Step implementations
# ===================================================================

def _step_tts(config, project_id):
    """Generate TTS audio and return metadata dict (includes wav_path)."""
    from studio.tts.routes import (
        load_model, _voice_to_lang, _phonemize_with_misaki,
        generation_inference_lock, generate_filename, _tts_job_dir,
    )
    from studio.tts.normalize import clean_for_tts, tts_breathing_blocks
    from studio.tts.audio import pad_audio, concatenate_chunks, run_loudnorm

    text = config["text"]
    voice = config["voice"]
    speed = config["speed"]

    kokoro = load_model()
    lang = _voice_to_lang(voice)

    tts_prompt = clean_for_tts(text)
    blocks = tts_breathing_blocks(tts_prompt)

    audio_chunks = []
    total_inference = 0.0

    for block in blocks:
        phonemes, is_ph = _phonemize_with_misaki(block, lang)
        start = time.perf_counter()
        with generation_inference_lock:
            chunk_audio, _sr = kokoro.create(
                text=phonemes, voice=voice, speed=speed,
                lang=lang, is_phonemes=is_ph,
            )
        total_inference += time.perf_counter() - start
        audio_chunks.append(chunk_audio)

    if len(audio_chunks) > 1:
        audio = concatenate_chunks(audio_chunks, sample_rate=24000,
                                   gap_ms=80, crossfade_ms=20)
    else:
        audio = audio_chunks[0]
    audio = pad_audio(audio, sample_rate=24000)

    basename = generate_filename(text)
    job_dir = _tts_job_dir(basename)
    os.makedirs(job_dir, exist_ok=True)
    wav_path = os.path.join(job_dir, basename + ".wav")
    sf.write(wav_path, audio, 24000)

    run_loudnorm(wav_path)

    info = sf.info(wav_path)
    duration = info.duration
    rtf = total_inference / duration if duration > 0 else 0
    clean_prompt = re.sub(r'[\[\]]', '', text).strip()

    metadata = {
        "filename": basename + ".wav",
        "folder": basename,
        "prompt": clean_prompt,
        "model": "kokoro-v1.0",
        "model_id": "kokoro",
        "voice": voice,
        "project_id": project_id,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "inference_time": round(total_inference, 3),
        "rtf": round(rtf, 4),
        "duration_seconds": round(duration, 2),
        "sample_rate": 24000,
        "speed": speed,
        "words": len(clean_prompt.split()),
        "approx_tokens": int(len(clean_prompt.split()) * 1.3),
        "wav_path": wav_path,
    }

    json_path = os.path.join(job_dir, basename + ".json")
    with open(json_path, "w") as f:
        json.dump({k: v for k, v in metadata.items() if k != "wav_path"},
                  f, indent=2)

    logger.success("Pipeline TTS: {:.1f}s audio in {:.2f}s",
                   duration, total_inference)
    return metadata


def _step_timing(tts_result, config, project_id):
    """Run force alignment on TTS output."""
    from studio.timing.routes import _run_alignment

    wav_path = tts_result["wav_path"]
    clean_text = re.sub(r'[\[\]*_#`~]', '', config["text"]).strip()
    clean_text = re.sub(r'\s+', ' ', clean_text)

    start = time.perf_counter()
    alignment = _run_alignment(wav_path, clean_text)
    elapsed = time.perf_counter() - start

    if not alignment:
        raise RuntimeError("Alignment produced no results")

    # Save to alignment directory
    folder_name = tts_result["folder"]
    align_dir = os.path.join(ALIGN_DIR, folder_name)
    os.makedirs(align_dir, exist_ok=True)

    dest_audio = os.path.join(align_dir, tts_result["filename"])
    if not os.path.exists(dest_audio):
        shutil.copy2(wav_path, dest_audio)

    result_data = {
        "project_id": project_id,
        "source_file": tts_result["filename"],
        "folder": folder_name,
        "transcript": clean_text,
        "alignment": alignment,
        "word_count": len(alignment),
        "inference_time": round(elapsed, 3),
        "timestamp": datetime.now().isoformat(),
    }

    with open(os.path.join(align_dir, "alignment.json"), "w") as f:
        json.dump(result_data, f, indent=2)

    logger.success("Pipeline Timing: {} words in {:.2f}s",
                   len(alignment), elapsed)
    return result_data


def _step_segment(timing_result, config, project_id):
    """Run segmentation on alignment data."""
    from studio.timing.segmenter import run_segmenter, save_output

    metadata = {
        "project_id": project_id,
        "source_folder": timing_result.get("folder", ""),
        "style": config.get("style", ""),
        "transcript": timing_result.get("transcript", ""),
    }

    result = run_segmenter(
        timing_result["alignment"],
        config.get("segment_config"),
        metadata,
    )

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = f"{timing_result.get('folder', 'pipeline')}_{ts}"
    out_path = os.path.join(SEGMENTER_DIR, folder, "segmented.json")
    save_output(result, out_path)
    result["output_folder"] = folder
    result["output_path"] = out_path

    logger.success("Pipeline Segment: {} scenes",
                   result["stats"]["segment_count"])
    return result


def _step_scenes(segment_result, config, project_id):
    """Generate scene scripts via webhook."""
    segments = [
        {"index": s["index"], "words": s["words"]}
        for s in segment_result.get("segments", [])
        if not s.get("is_filler")
    ]

    if not segments:
        raise RuntimeError("No non-filler segments to generate scenes for")

    webhook_url = config.get("webhook_url") or N8N_WEBHOOK_URL

    resp = http_requests.post(
        webhook_url,
        json={
            "script": config.get("text", ""),
            "style": config.get("style", "cinematic"),
            "segments": segments,
        },
        timeout=120,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Webhook returned {resp.status_code}: {resp.text[:200]}")

    body = resp.text.strip()
    if not body:
        raise RuntimeError("Webhook returned empty response")

    result = json.loads(body)
    if isinstance(result, list):
        if not result:
            raise RuntimeError("Webhook returned empty array")
        result = result[0]

    result["project_id"] = project_id
    result["timestamp"] = datetime.now().isoformat()
    result["source_folder"] = segment_result.get(
        "metadata", {}).get("source_folder", "")

    job_dir = os.path.join(SCENES_DIR, project_id)
    os.makedirs(job_dir, exist_ok=True)
    with open(os.path.join(job_dir, "scenes.json"), "w") as f:
        json.dump(result, f, indent=2)

    logger.success("Pipeline Scenes: {} scenes",
                   len(result.get("scenes", [])))
    return result
