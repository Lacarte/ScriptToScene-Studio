"""Timing Module — Force Alignment Routes"""

import json
import os
import re
import shutil
import subprocess
import time
import threading
import warnings
from datetime import datetime

import numpy as np
import soundfile as sf
from flask import Blueprint, jsonify, request, send_from_directory
from loguru import logger

from config import ALIGN_DIR, ALIGN_TRASH_DIR, BIN_DIR

timing_bp = Blueprint("timing", __name__)

# ---------------------------------------------------------------------------
# Alignment model (stable-ts / Whisper)
# ---------------------------------------------------------------------------
alignment_model = None
alignment_lock = threading.Lock()
alignment_available = None


def _check_alignment_available():
    global alignment_available
    if alignment_available is not None:
        return alignment_available
    try:
        import stable_whisper  # noqa: F401
        alignment_available = True
    except ImportError:
        alignment_available = False
    return alignment_available


def _load_alignment_model():
    global alignment_model
    if alignment_model is not None:
        return alignment_model
    import stable_whisper
    with alignment_lock:
        if alignment_model is None:
            alignment_model = stable_whisper.load_model("tiny.en")
    return alignment_model


def _find_ffmpeg():
    local = os.path.join(BIN_DIR, "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    return local if os.path.isfile(local) else shutil.which("ffmpeg")


def _run_alignment(wav_path, prompt_text):
    try:
        model = _load_alignment_model()
        audio, sr = sf.read(wav_path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 16000:
            target_len = int(len(audio) * 16000 / sr)
            audio = np.interp(
                np.linspace(0, len(audio), target_len, endpoint=False),
                np.arange(len(audio), dtype=np.float32),
                audio,
            ).astype(np.float32)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = model.align(audio, prompt_text, language="en", fast_mode=True)
        for w in caught:
            msg = str(w.message)
            if "failed to align" in msg:
                logger.warning("Align partial: {}", msg)
            else:
                logger.debug("Align warning: {}", msg)
        alignment = []
        for w in result.all_words():
            word_text = w.word.strip()
            if word_text:
                alignment.append({
                    "word": word_text,
                    "begin": round(w.start, 3),
                    "end": round(w.end, 3),
                })
        return alignment if alignment else None
    except Exception:
        logger.exception("Alignment failed for {}", wav_path)
        return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@timing_bp.route("/api/timing/history")
def list_force_alignments():
    items = []
    if not os.path.exists(ALIGN_DIR):
        return jsonify(items)
    for entry in os.listdir(ALIGN_DIR):
        entry_path = os.path.join(ALIGN_DIR, entry)
        if not os.path.isdir(entry_path) or entry == "TRASH":
            continue
        json_path = os.path.join(entry_path, "alignment.json")
        if not os.path.isfile(json_path):
            continue
        try:
            with open(json_path, "r") as f:
                meta = json.load(f)
            words = meta.get("alignment", [])
            duration = round(words[-1]["end"], 2) if words else 0
            items.append({
                "type": "force-alignment",
                "folder": meta.get("folder", entry),
                "source_file": meta.get("source_file", ""),
                "transcript": meta.get("transcript", ""),
                "word_count": meta.get("word_count", len(words)),
                "word_alignment": words,
                "duration_seconds": duration,
                "inference_time": meta.get("inference_time", 0),
                "timestamp": meta.get("timestamp", ""),
            })
        except (json.JSONDecodeError, OSError, IndexError, KeyError):
            pass
    items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return jsonify(items)


@timing_bp.route("/api/timing/align", methods=["POST"])
def force_align():
    if not _check_alignment_available():
        return jsonify({"error": "Force alignment not available (stable-ts not installed)"}), 503

    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
    text = request.form.get("text", "").strip()
    if not text:
        return jsonify({"error": "No transcript text provided"}), 400

    audio_file = request.files["audio"]
    original_name = audio_file.filename
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in (".wav", ".mp3", ".flac", ".ogg"):
        return jsonify({"error": f"Unsupported format: {ext}"}), 400

    safe_name = re.sub(r'[^a-zA-Z0-9]+', '-', os.path.splitext(original_name)[0][:40]).strip('-')
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder_name = f"{safe_name}_{timestamp}"
    job_dir = os.path.join(ALIGN_DIR, folder_name)
    os.makedirs(job_dir, exist_ok=True)

    audio_path = os.path.join(job_dir, original_name)
    audio_file.save(audio_path)

    wav_path = audio_path
    conv_path = None
    try:
        if ext != ".wav":
            ffmpeg = _find_ffmpeg()
            if not ffmpeg:
                return jsonify({"error": "ffmpeg required for non-WAV files"}), 400
            conv_path = os.path.join(job_dir, os.path.splitext(original_name)[0] + "_conv.wav")
            result = subprocess.run(
                [ffmpeg, "-nostdin", "-y", "-i", audio_path, "-ar", "24000", "-ac", "1", conv_path],
                capture_output=True, timeout=60,
            )
            if result.returncode != 0:
                return jsonify({"error": "Audio conversion failed"}), 500
            wav_path = conv_path

        start = time.perf_counter()
        alignment = _run_alignment(wav_path, text)
        elapsed = time.perf_counter() - start

        if not alignment:
            return jsonify({"error": "Alignment produced no results"}), 500

        result_data = {
            "source_file": original_name,
            "folder": folder_name,
            "transcript": text,
            "alignment": alignment,
            "word_count": len(alignment),
            "inference_time": round(elapsed, 3),
            "timestamp": datetime.now().isoformat(),
        }
        with open(os.path.join(job_dir, "alignment.json"), "w") as f:
            json.dump(result_data, f, indent=2)

        logger.success("Force-aligned  {} | {} words in {:.2f}s -> {}", original_name, len(alignment), elapsed, folder_name)
        return jsonify(result_data)

    finally:
        if conv_path:
            try:
                os.unlink(conv_path)
            except OSError:
                pass


@timing_bp.route("/api/timing/<folder>", methods=["DELETE"])
def delete_alignment(folder):
    folder = os.path.basename(folder)
    job_dir = os.path.join(ALIGN_DIR, folder)
    if os.path.isdir(job_dir):
        shutil.move(job_dir, os.path.join(ALIGN_TRASH_DIR, folder))
        return jsonify({"status": "deleted", "folder": folder})
    return jsonify({"error": "Folder not found"}), 404


@timing_bp.route("/output/alignments/<path:filename>")
def serve_alignment_audio(filename):
    return send_from_directory(ALIGN_DIR, filename)
