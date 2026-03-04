"""TTS Module — Kokoro TTS Routes

Provides text-to-speech generation, streaming, model management,
voice blending, and generation history.
"""

import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
import threading
import uuid
from datetime import datetime
from queue import Queue

import numpy as np
import soundfile as sf
import urllib.request
from flask import Blueprint, Response, jsonify, request, send_from_directory
from loguru import logger

from config import TTS_DIR, TTS_TRASH_DIR, MODELS_DIR, BIN_DIR
from .normalize import (
    normalize_for_tts, clean_for_tts, tts_breathing_blocks,
    format_breathing_blocks, validate_brackets,
)
from .audio import pad_audio, concatenate_chunks, run_loudnorm, _find_ffmpeg

# ---------------------------------------------------------------------------
# Blueprint
# ---------------------------------------------------------------------------

tts_bp = Blueprint("tts", __name__)

# ---------------------------------------------------------------------------
# Model / Voice configuration
# ---------------------------------------------------------------------------

MODELS = {
    "kokoro": {
        "name": "Kokoro v1.0",
        "size": "~373MB",
        "onnx_file": "kokoro-v1.0.onnx",
        "voices_file": "voices-v1.0.bin",
        "onnx_url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
        "voices_url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
    },
}

VOICE_LANG_MAP = {
    "af": "en-us", "am": "en-us",
    "bf": "en-gb", "bm": "en-gb",
    "jf": "ja",    "jm": "ja",
    "zf": "cmn",   "zm": "cmn",
    "ef": "es",    "em": "es",
    "ff": "fr-fr",
    "hf": "hi",    "hm": "hi",
    "if": "it",    "im": "it",
    "pf": "pt-br", "pm": "pt-br",
}

VOICES = [
    # American Female
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica",
    "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    # American Male
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
    "am_michael", "am_onyx", "am_puck",
    # British Female
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    # British Male
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
    # Japanese
    "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo",
    # Chinese
    "zf_xiaobei", "zf_xiaoni", "zf_xiaoxuan", "zf_xiaoyi",
    "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
    # Spanish
    "ef_dora", "em_alex", "em_santa",
    # French
    "ff_siwis",
    # Hindi
    "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
    # Italian
    "if_sara", "im_nicola",
    # Portuguese
    "pf_dora", "pm_alex", "pm_santa",
]


def _voice_to_lang(voice_name: str) -> str:
    prefix = voice_name.split("_")[0] if "_" in voice_name else voice_name[:2]
    return VOICE_LANG_MAP.get(prefix, "en-us")


# ---------------------------------------------------------------------------
# Voice blending (SLERP / LERP)
# ---------------------------------------------------------------------------

def _slerp(v0: np.ndarray, v1: np.ndarray, t: float) -> np.ndarray:
    v0 = v0.astype(np.float64)
    v1 = v1.astype(np.float64)
    if v0.ndim == 1:
        n0, n1 = np.linalg.norm(v0), np.linalg.norm(v1)
        dot = np.clip(np.dot(v0, v1) / (n0 * n1 + 1e-10), -1.0, 1.0)
        omega = np.arccos(dot)
        if abs(omega) < 1e-6:
            return ((1.0 - t) * v0 + t * v1).astype(np.float32)
        so = np.sin(omega)
        return ((np.sin((1.0 - t) * omega) / so) * v0
                + (np.sin(t * omega) / so) * v1).astype(np.float32)
    result = np.empty_like(v0)
    for i in range(v0.shape[0]):
        result[i] = _slerp(v0[i], v1[i], t)
    return result.astype(np.float32)


def _lerp(v0: np.ndarray, v1: np.ndarray, t: float) -> np.ndarray:
    return ((1.0 - t) * v0 + t * v1).astype(np.float32)


def _blend_voices(kokoro_inst, voice_a: str, voice_b: str,
                  ratio: float, method: str = "slerp") -> np.ndarray:
    embed_a = kokoro_inst.get_voice_style(voice_a)
    embed_b = kokoro_inst.get_voice_style(voice_b)
    if method == "slerp":
        return _slerp(embed_a, embed_b, ratio)
    return _lerp(embed_a, embed_b, ratio)


# ---------------------------------------------------------------------------
# Misaki G2P (pre-phonemizer for Kokoro pronunciation links)
# ---------------------------------------------------------------------------

_misaki_g2p = None
_misaki_lock = threading.Lock()


def _get_misaki_g2p(british=False):
    """Lazy-load the misaki G2P engine (supports [word](+1) stress syntax)."""
    global _misaki_g2p
    with _misaki_lock:
        if _misaki_g2p is None:
            try:
                from misaki import en
                _misaki_g2p = en.G2P(trf=False, british=british)
                logger.success("Misaki G2P loaded (british={})", british)
            except ImportError:
                logger.warning("misaki not installed — Kokoro pronunciation links will not work")
                return None
            except Exception:
                logger.exception("Failed to load misaki G2P")
                return None
        return _misaki_g2p


def _phonemize_with_misaki(text: str, lang: str = "en-us") -> tuple[str | None, bool]:
    """Convert text to phonemes using misaki G2P.

    Returns (phonemes, success).  If misaki is unavailable or fails,
    returns (original_text, False) so the caller can fall back to
    espeak via kokoro-onnx's default pipeline.
    """
    # Only use misaki for English — other languages use kokoro's built-in G2P
    if not lang.startswith("en"):
        return text, False

    british = lang == "en-gb"
    g2p = _get_misaki_g2p(british=british)
    if g2p is None:
        return text, False

    try:
        phonemes, _tokens = g2p(text)
        if phonemes and phonemes.strip():
            return phonemes, True
    except Exception:
        logger.exception("Misaki G2P failed, falling back to espeak")
    return text, False


# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

kokoro_instance = None
kokoro_lock = threading.Lock()

generation_jobs = {}
generation_jobs_lock = threading.Lock()
generation_inference_lock = threading.Lock()

_stream_active = threading.Event()

_metadata_locks = {}
_metadata_locks_lock = threading.Lock()


def _get_metadata_lock(basename):
    with _metadata_locks_lock:
        if basename not in _metadata_locks:
            _metadata_locks[basename] = threading.Lock()
        return _metadata_locks[basename]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tts_job_dir(basename):
    return os.path.join(TTS_DIR, basename)


def _folder_for_file(filename):
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    changed = True
    while changed:
        changed = False
        for suffix in ("_cleaned", "_enhanced"):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
                changed = True
    return base


def _update_metadata(basename, updates):
    lock = _get_metadata_lock(basename)
    json_path = os.path.join(_tts_job_dir(basename), basename + ".json")
    tmp_path = json_path + ".tmp"
    with lock:
        with open(json_path, "r") as f:
            metadata = json.load(f)
        metadata.update(updates)
        with open(tmp_path, "w") as f:
            json.dump(metadata, f, indent=2)
        os.replace(tmp_path, json_path)
    return metadata


def _read_metadata(basename):
    lock = _get_metadata_lock(basename)
    json_path = os.path.join(_tts_job_dir(basename), basename + ".json")
    with lock:
        with open(json_path, "r") as f:
            return json.load(f)


def generate_filename(prompt: str) -> str:
    excerpt = re.sub(r"[^a-zA-Z0-9]+", "-", prompt[:30].lower()).strip("-")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{excerpt}_{timestamp}"


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------

def _model_files_present() -> bool:
    cfg = MODELS["kokoro"]
    onnx_path = os.path.join(MODELS_DIR, cfg["onnx_file"])
    voices_path = os.path.join(MODELS_DIR, cfg["voices_file"])
    return os.path.isfile(onnx_path) and os.path.isfile(voices_path)


def load_model():
    global kokoro_instance
    if kokoro_instance is not None:
        return kokoro_instance

    from kokoro_onnx import Kokoro

    cfg = MODELS["kokoro"]
    onnx_path = os.path.join(MODELS_DIR, cfg["onnx_file"])
    voices_path = os.path.join(MODELS_DIR, cfg["voices_file"])

    with kokoro_lock:
        if kokoro_instance is None:
            logger.info("Loading Kokoro model ...")
            kokoro_instance = Kokoro(onnx_path, voices_path)
            try:
                available = kokoro_instance.get_voices()
                if available:
                    global VOICES
                    VOICES = sorted(available)
            except Exception:
                pass
            logger.success("Kokoro model ready")
    return kokoro_instance


def _download_file_with_progress(url: str, dest_path: str, queue: Queue, label: str):
    tmp_path = dest_path + ".tmp"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ScriptToScene-Studio/1.0"})
        with urllib.request.urlopen(req, timeout=60) as response:
            total = int(response.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 256 * 1024
            start_time = time.time()

            with open(tmp_path, "wb") as f:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    elapsed = time.time() - start_time
                    speed = downloaded / max(elapsed, 0.001)
                    progress = int((downloaded / total) * 100) if total else 0

                    if speed >= 1_000_000:
                        speed_str = f"{speed / 1_000_000:.1f}MB/s"
                    elif speed >= 1_000:
                        speed_str = f"{speed / 1_000:.1f}KB/s"
                    else:
                        speed_str = f"{speed:.0f}B/s"

                    queue.put({
                        "phase": "downloading",
                        "file": label,
                        "progress": progress,
                        "downloaded_mb": round(downloaded / 1_000_000, 2),
                        "total_mb": round(total / 1_000_000, 2),
                        "size": f"{total / 1_000_000:.1f}MB",
                        "speed": speed_str,
                    })

        os.replace(tmp_path, dest_path)
    except Exception:
        if os.path.isfile(tmp_path):
            os.remove(tmp_path)
        raise


# ---------------------------------------------------------------------------
# Chunked generation background worker
# ---------------------------------------------------------------------------

def _background_chunked_generate(job_id, voice_param, voice_name, sentences, speed,
                                  max_silence_ms, prompt, basename,
                                  voice_for_metadata=None, blend_meta=None):
    with generation_jobs_lock:
        job = generation_jobs[job_id]
    q = job["queue"]
    if voice_for_metadata is None:
        voice_for_metadata = voice_name
    try:
        kokoro = load_model()
        lang = _voice_to_lang(voice_name)

        audio_chunks = []
        total = len(sentences)
        total_inference = 0.0

        for i, block in enumerate(sentences):
            if job.get("abort"):
                q.put({"phase": "aborted"})
                with generation_jobs_lock:
                    job["status"] = "aborted"
                return

            q.put({"phase": "generating", "chunk": i + 1, "total": total,
                    "sentence": block})

            phonemes, is_ph = _phonemize_with_misaki(block, lang)
            start = time.perf_counter()
            with generation_inference_lock:
                chunk_audio, _sr = kokoro.create(
                    text=phonemes, voice=voice_param, speed=speed,
                    lang=lang, is_phonemes=is_ph,
                )
            elapsed = time.perf_counter() - start
            total_inference += elapsed
            audio_chunks.append(chunk_audio)

        q.put({"phase": "concatenating"})
        audio = concatenate_chunks(audio_chunks, sample_rate=24000, gap_ms=80, crossfade_ms=20)
        audio = pad_audio(audio, sample_rate=24000)

        job_dir = _tts_job_dir(basename)
        os.makedirs(job_dir, exist_ok=True)
        wav_path = os.path.join(job_dir, basename + ".wav")
        sf.write(wav_path, audio, 24000)

        q.put({"phase": "normalizing"})
        run_loudnorm(wav_path)

        info = sf.info(wav_path)
        duration_generated = info.duration
        rtf = total_inference / duration_generated if duration_generated > 0 else 0
        logger.success("Generated  {:.1f}s audio in {:.2f}s | RTF {:.2f} | {} chunks",
                       duration_generated, total_inference, rtf, total)

        clean_prompt = re.sub(r'[\[\]]', '', prompt).strip()
        words = len(clean_prompt.split())

        metadata = {
            "filename": basename + ".wav",
            "folder": basename,
            "prompt": clean_prompt,
            "model": "kokoro-v1.0",
            "model_id": "kokoro",
            "voice": voice_for_metadata,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "inference_time": round(total_inference, 3),
            "rtf": round(rtf, 4),
            "duration_seconds": round(duration_generated, 2),
            "sample_rate": 24000,
            "speed": speed,
            "max_silence_ms": max_silence_ms,
            "words": words,
            "approx_tokens": int(words * 1.3),
            "chunked": True,
            "num_chunks": total,
        }
        if blend_meta:
            metadata["blend"] = blend_meta

        json_path = os.path.join(job_dir, basename + ".json")
        with open(json_path, "w") as f:
            json.dump(metadata, f, indent=2)

        q.put({"phase": "done", "metadata": metadata})
        with generation_jobs_lock:
            job["status"] = "done"
            job["metadata"] = metadata

    except Exception as e:
        logger.exception("Chunked generation failed")
        q.put({"phase": "error", "message": str(e)})
        with generation_jobs_lock:
            job["status"] = "error"


def _cleanup_old_jobs(max_age_s=300):
    now = time.time()
    with generation_jobs_lock:
        expired = [jid for jid, job in generation_jobs.items()
                   if now - job.get("created", 0) > max_age_s]
        for jid in expired:
            del generation_jobs[jid]


# ===================================================================
# Routes
# ===================================================================

# --- Normalize text ---
@tts_bp.route("/api/tts/normalize", methods=["POST"])
def normalize_text():
    data = request.get_json(force=True)
    text = data.get("text", "")
    if not text.strip():
        return jsonify({"error": "No text provided"}), 400

    validity = validate_brackets(text)
    if validity == "well_formed":
        blocks = re.findall(r'\[([^\[\]]+)\]', text)
        normalized_blocks = [normalize_for_tts(b) for b in blocks if b.strip()]
        if len(normalized_blocks) <= 1:
            formatted = normalized_blocks[0] if normalized_blocks else text.strip()
        else:
            formatted = "\n\n".join(f"[{b}]" for b in normalized_blocks)
    else:
        stripped = re.sub(r'[\[\]]', '', text)
        normalized = normalize_for_tts(stripped)
        formatted = format_breathing_blocks(normalized)

    return jsonify({"original": text, "normalized": formatted})


# --- Models ---
@tts_bp.route("/api/tts/models")
def models():
    out = []
    for mid, m in MODELS.items():
        out.append({"id": mid, "name": m["name"], "size": m["size"]})
    return jsonify(out)


# --- Voices ---
@tts_bp.route("/api/tts/voices")
def voices():
    return jsonify(VOICES)


# --- Model status ---
@tts_bp.route("/api/tts/model-status/<model_id>")
def model_status(model_id):
    if model_id not in MODELS:
        return jsonify({"error": "Unknown model"}), 404
    cached = _model_files_present()
    return jsonify({"model_id": model_id, "cached": cached})


# --- Download model with SSE progress ---
@tts_bp.route("/api/tts/download-model/<model_id>")
def download_model(model_id):
    if model_id not in MODELS:
        return jsonify({"error": "Unknown model"}), 404

    model_cfg = MODELS[model_id]

    def _stream_download(url, dest, q, label):
        result = {}

        def _run():
            try:
                _download_file_with_progress(url, dest, q, label)
            except Exception as e:
                logger.error("Download failed for {}: {}", label, e)
                result["error"] = e

        t = threading.Thread(target=_run)
        t.start()
        while t.is_alive():
            t.join(timeout=0.15)
            while not q.empty():
                yield f"data: {json.dumps(q.get())}\n\n"
        while not q.empty():
            yield f"data: {json.dumps(q.get())}\n\n"
        if "error" in result:
            raise result["error"]

    def stream():
        q = Queue()
        yield f"data: {json.dumps({'phase': 'checking', 'model': model_id})}\n\n"

        try:
            onnx_path = os.path.join(MODELS_DIR, model_cfg["onnx_file"])
            voices_path = os.path.join(MODELS_DIR, model_cfg["voices_file"])

            if not os.path.isfile(onnx_path):
                for event in _stream_download(model_cfg["onnx_url"], onnx_path, q, model_cfg["onnx_file"]):
                    yield event

            if not os.path.isfile(voices_path):
                for event in _stream_download(model_cfg["voices_url"], voices_path, q, model_cfg["voices_file"]):
                    yield event

            yield f"data: {json.dumps({'phase': 'loading', 'message': 'Loading model...'})}\n\n"
            load_result = {}

            def _load():
                try:
                    load_model()
                except Exception as e:
                    load_result["error"] = e

            t = threading.Thread(target=_load)
            t.start()
            while t.is_alive():
                t.join(timeout=1.0)
                yield f"data: {json.dumps({'phase': 'loading', 'message': 'Loading model...'})}\n\n"
            if "error" in load_result:
                raise load_result["error"]

            yield f"data: {json.dumps({'phase': 'ready', 'message': 'Model ready'})}\n\n"

        except Exception as e:
            logger.exception("Model download/load failed")
            yield f"data: {json.dumps({'phase': 'error', 'message': str(e)})}\n\n"

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# --- Generate audio ---
@tts_bp.route("/api/tts/generate", methods=["POST"])
def generate():
    data = request.get_json()
    model_id = data.get("model", "kokoro")
    voice = data.get("voice", "af_bella")
    prompt = data.get("prompt", "")
    speed = max(0.5, min(2.0, float(data.get("speed", 1.0))))
    max_silence_ms = max(200, min(1000, int(data.get("max_silence_ms", 500))))
    blend = data.get("blend")

    if not prompt.strip():
        return jsonify({"error": "Prompt is required"}), 400
    if model_id not in MODELS:
        return jsonify({"error": "Unknown model"}), 404

    voice_for_metadata = voice
    voice_param = voice
    blend_meta = None

    if blend:
        voice_a = blend.get("voice_a", "")
        voice_b = blend.get("voice_b", "")
        ratio = max(0.0, min(1.0, float(blend.get("ratio", 0.5))))
        method = blend.get("method", "slerp")
        if method not in ("slerp", "lerp"):
            method = "slerp"
        if voice_a not in VOICES:
            return jsonify({"error": f"Unknown voice_a: {voice_a}"}), 400
        if voice_b not in VOICES:
            return jsonify({"error": f"Unknown voice_b: {voice_b}"}), 400

        kokoro_inst = load_model()
        voice_param = _blend_voices(kokoro_inst, voice_a, voice_b, ratio, method)
        pct = int(round(ratio * 100))
        voice_for_metadata = f"{voice_a} + {voice_b} ({pct}% {method.upper()})"
        voice = voice_a
        blend_meta = {"voice_a": voice_a, "voice_b": voice_b,
                      "ratio": ratio, "method": method}
    else:
        if voice not in VOICES:
            return jsonify({"error": f"Unknown voice. Choose from: {VOICES}"}), 400

    if _stream_active.is_set():
        return jsonify({"error": "A stream is already in progress. Please wait."}), 429
    with generation_jobs_lock:
        for job in generation_jobs.values():
            if job.get("status") == "running":
                return jsonify({"error": "A generation is already in progress. Please wait or abort."}), 429

    kokoro = load_model()
    lang = _voice_to_lang(voice)
    logger.info("Generate  \033[1m{}\033[0m | {} | {} chars", model_id, voice_for_metadata, len(prompt))

    skip_clean = data.get("skip_clean", False)

    # Match breathing-block brackets [text] but NOT Kokoro links [word](...)
    pre_blocks = re.findall(r'\[([^\[\]]+)\](?!\()', prompt)
    if pre_blocks and len(pre_blocks) >= 2:
        blocks = []
        for b in pre_blocks:
            if not skip_clean:
                b = re.sub(r"[*_#`~]", "", b)
                b = re.sub(r"https?://\S+", "link", b)
            b = re.sub(r"\s+", " ", b).strip()
            if b:
                blocks.append(b)
        tts_prompt = " ".join(blocks)
    else:
        tts_prompt = clean_for_tts(prompt) if not skip_clean else prompt.strip()
        blocks = tts_breathing_blocks(tts_prompt)

    # Multi-block: chunked background generation with SSE progress
    if len(blocks) > 1:
        _cleanup_old_jobs()
        job_id = uuid.uuid4().hex[:12]
        basename = generate_filename(prompt)
        with generation_jobs_lock:
            generation_jobs[job_id] = {
                "queue": Queue(),
                "status": "running",
                "metadata": None,
                "created": time.time(),
                "abort": False,
            }
        t = threading.Thread(
            target=_background_chunked_generate,
            args=(job_id, voice_param, voice, blocks, speed,
                  max_silence_ms, prompt, basename, voice_for_metadata, blend_meta),
            daemon=True,
        )
        t.start()
        return jsonify({
            "job_id": job_id,
            "status": "chunking",
            "total_chunks": len(blocks),
            "sentences": blocks,
        }), 202

    # Single block: synchronous fast path
    _cleanup_old_jobs()
    single_block = blocks[0] if blocks else tts_prompt
    phonemes, is_ph = _phonemize_with_misaki(single_block, lang)
    start = time.perf_counter()
    try:
        with generation_inference_lock:
            audio, _sr = kokoro.create(
                text=phonemes, voice=voice_param, speed=speed,
                lang=lang, is_phonemes=is_ph,
            )
    except Exception as e:
        logger.exception("TTS inference failed")
        return jsonify({"error": f"Generation failed: {e}"}), 500
    end = time.perf_counter()

    audio = pad_audio(audio, sample_rate=24000)
    duration_generated = len(audio) / 24000
    inference_time = end - start
    rtf = inference_time / duration_generated

    basename = generate_filename(prompt)
    job_dir = _tts_job_dir(basename)
    os.makedirs(job_dir, exist_ok=True)
    wav_name = f"{basename}.wav"
    json_name = f"{basename}.json"

    sf.write(os.path.join(job_dir, wav_name), audio, 24000)
    logger.success("Generated  {:.1f}s audio in {:.2f}s | RTF {:.2f}", duration_generated, inference_time, rtf)

    clean_prompt = re.sub(r'[\[\]]', '', prompt).strip()
    metadata = {
        "filename": wav_name,
        "folder": basename,
        "prompt": clean_prompt,
        "model": "kokoro-v1.0",
        "model_id": "kokoro",
        "voice": voice_for_metadata,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "inference_time": round(inference_time, 3),
        "rtf": round(rtf, 4),
        "duration_seconds": round(duration_generated, 2),
        "sample_rate": 24000,
        "speed": speed,
        "max_silence_ms": max_silence_ms,
        "words": len(clean_prompt.split()),
        "approx_tokens": int(len(clean_prompt.split()) * 1.3),
    }
    if blend_meta:
        metadata["blend"] = blend_meta
    with open(os.path.join(job_dir, json_name), "w") as f:
        json.dump(metadata, f, indent=2)

    return jsonify(metadata)


# --- Chunked generation SSE progress ---
@tts_bp.route("/api/tts/generate-progress/<job_id>")
def generate_progress(job_id):
    with generation_jobs_lock:
        job = generation_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job ID"}), 404

    def stream():
        status = job.get("status")
        if status == "done":
            yield f"data: {json.dumps({'phase': 'done', 'metadata': job.get('metadata')})}\n\n"
            return
        if status in ("error", "aborted"):
            yield f"data: {json.dumps({'phase': status})}\n\n"
            return

        q = job["queue"]
        while True:
            try:
                event = q.get(timeout=10)
            except Exception:
                with generation_jobs_lock:
                    cur_status = job.get("status")
                if cur_status == "done":
                    yield f"data: {json.dumps({'phase': 'done', 'metadata': job.get('metadata')})}\n\n"
                    break
                if cur_status in ("error", "aborted"):
                    yield f"data: {json.dumps({'phase': cur_status})}\n\n"
                    break
                continue
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("phase") in ("done", "error", "aborted"):
                break

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# --- Abort generation ---
@tts_bp.route("/api/tts/generate-abort/<job_id>", methods=["POST"])
def abort_generation(job_id):
    with generation_jobs_lock:
        job = generation_jobs.get(job_id)
        if not job:
            return jsonify({"error": "Unknown job ID"}), 404
        job["abort"] = True
    return jsonify({"status": "aborting"})


# --- Stream audio (listen-only, no save) ---
@tts_bp.route("/api/tts/stream", methods=["POST"])
def stream_audio():
    data = request.get_json()
    model_id = data.get("model", "kokoro")
    voice = data.get("voice", "af_bella")
    prompt = data.get("prompt", "")
    speed = max(0.5, min(2.0, float(data.get("speed", 1.0))))
    blend = data.get("blend")

    if not prompt.strip():
        return jsonify({"error": "Prompt is required"}), 400
    if model_id not in MODELS:
        return jsonify({"error": "Unknown model"}), 404

    voice_param = voice
    if blend:
        voice_a = blend.get("voice_a", "")
        voice_b = blend.get("voice_b", "")
        ratio = max(0.0, min(1.0, float(blend.get("ratio", 0.5))))
        method = blend.get("method", "slerp")
        if method not in ("slerp", "lerp"):
            method = "slerp"
        if voice_a not in VOICES:
            return jsonify({"error": f"Unknown voice_a: {voice_a}"}), 400
        if voice_b not in VOICES:
            return jsonify({"error": f"Unknown voice_b: {voice_b}"}), 400
        kokoro_inst = load_model()
        voice_param = _blend_voices(kokoro_inst, voice_a, voice_b, ratio, method)
        voice = voice_a
    else:
        if voice not in VOICES:
            return jsonify({"error": f"Unknown voice. Choose from: {VOICES}"}), 400

    if _stream_active.is_set():
        return jsonify({"error": "A stream is already in progress."}), 429
    with generation_jobs_lock:
        for job in generation_jobs.values():
            if job.get("status") == "running":
                return jsonify({"error": "A generation is already in progress. Please wait or abort."}), 429

    kokoro = load_model()
    lang = _voice_to_lang(voice)
    skip_clean = data.get("skip_clean", False)
    tts_prompt = clean_for_tts(prompt) if not skip_clean else prompt.strip()

    logger.info("Stream  \033[1m{}\033[0m | {} | {} chars", model_id, voice, len(prompt))

    q = Queue()

    stream_phonemes, stream_is_ph = _phonemize_with_misaki(tts_prompt, lang)

    def _run_stream():
        _stream_active.set()
        loop = asyncio.new_event_loop()
        try:
            async def _produce():
                with generation_inference_lock:
                    stream = kokoro.create_stream(
                        text=stream_phonemes, voice=voice_param,
                        speed=speed, lang=lang, is_phonemes=stream_is_ph,
                    )
                    async for samples, sr in stream:
                        q.put(("audio", samples, sr))
                q.put(("done", None, None))

            loop.run_until_complete(_produce())
        except Exception:
            logger.exception("Stream generation failed")
            q.put(("error", str(Exception), None))
        finally:
            loop.close()
            _stream_active.clear()

    t = threading.Thread(target=_run_stream, daemon=True)
    t.start()

    def _sse():
        chunk_num = 0
        while True:
            try:
                kind, payload, sr = q.get(timeout=60)
            except Exception:
                yield f"data: {json.dumps({'phase': 'error', 'message': 'Stream timed out'})}\n\n"
                break
            if kind == "audio":
                chunk_num += 1
                pcm_bytes = payload.astype(np.float32).tobytes()
                b64 = base64.b64encode(pcm_bytes).decode("ascii")
                yield f"data: {json.dumps({'phase': 'audio', 'chunk': chunk_num, 'samples': b64, 'sample_rate': sr})}\n\n"
            elif kind == "done":
                yield f"data: {json.dumps({'phase': 'done', 'total_chunks': chunk_num})}\n\n"
                break
            elif kind == "error":
                yield f"data: {json.dumps({'phase': 'error', 'message': payload})}\n\n"
                break

    return Response(
        _sse(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# --- List generations ---
@tts_bp.route("/api/tts/generation")
def list_audio():
    files = []
    if not os.path.exists(TTS_DIR):
        return jsonify(files)
    for entry in os.listdir(TTS_DIR):
        entry_path = os.path.join(TTS_DIR, entry)
        if not os.path.isdir(entry_path) or entry == "TRASH":
            continue
        json_path = os.path.join(entry_path, entry + ".json")
        if os.path.isfile(json_path):
            try:
                with open(json_path, "r") as f:
                    files.append(json.load(f))
            except (json.JSONDecodeError, OSError) as e:
                logger.debug("Skipping corrupt/partial metadata {}: {}", entry, e)
    files.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return jsonify(files)


# --- Delete generation (move to TRASH) ---
@tts_bp.route("/api/tts/generation/<filename>", methods=["DELETE"])
def delete_audio(filename):
    basename = filename.rsplit(".", 1)[0]
    job_dir = _tts_job_dir(basename)
    if os.path.isdir(job_dir):
        shutil.move(job_dir, os.path.join(TTS_TRASH_DIR, basename))
        return jsonify({"status": "deleted", "filename": filename})
    return jsonify({"error": "File not found"}), 404


# --- Delete all generations ---
@tts_bp.route("/api/tts/generation", methods=["DELETE"])
def delete_all_audio():
    count = 0
    for entry in os.listdir(TTS_DIR):
        entry_path = os.path.join(TTS_DIR, entry)
        if os.path.isdir(entry_path) and entry != "TRASH":
            shutil.move(entry_path, os.path.join(TTS_TRASH_DIR, entry))
            count += 1
    return jsonify({"status": "deleted", "count": count})


# --- Open generation folder ---
@tts_bp.route("/api/tts/open-generation-folder", methods=["POST"])
def open_audio_folder():
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "")
    filename = os.path.basename(filename) if filename else ""
    basename = filename.rsplit(".", 1)[0] if filename else ""
    job_dir = os.path.abspath(_tts_job_dir(basename)) if basename else ""
    file_path = os.path.join(job_dir, filename) if job_dir and filename else ""
    folder = os.path.abspath(TTS_DIR)
    try:
        if sys.platform == "win32":
            if file_path and os.path.exists(file_path):
                subprocess.Popen(["explorer", "/select,", file_path])
            else:
                os.startfile(folder)
        elif sys.platform == "darwin":
            if file_path and os.path.exists(file_path):
                subprocess.Popen(["open", "-R", file_path])
            else:
                subprocess.Popen(["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])
        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error("Failed to open folder: {}", e)
        return jsonify({"error": str(e)}), 500


# --- MP3 check ---
@tts_bp.route("/api/tts/generation/<filename>/mp3-check")
def check_mp3(filename):
    if not filename.endswith(".wav"):
        return jsonify({"exists": False})
    folder = _folder_for_file(filename)
    mp3_name = filename.rsplit(".", 1)[0] + ".mp3"
    mp3_path = os.path.join(_tts_job_dir(folder), mp3_name)
    return jsonify({"exists": os.path.exists(mp3_path)})


# --- Serve cached MP3 ---
@tts_bp.route("/api/tts/generation/<filename>/mp3")
def serve_mp3(filename):
    if not filename.endswith(".wav"):
        return jsonify({"error": "Only .wav files can be converted"}), 400
    folder = _folder_for_file(filename)
    mp3_name = filename.rsplit(".", 1)[0] + ".mp3"
    job_dir = _tts_job_dir(folder)
    mp3_path = os.path.join(job_dir, mp3_name)
    if not os.path.exists(mp3_path):
        return jsonify({"error": "MP3 not found - convert first"}), 404
    return send_from_directory(job_dir, mp3_name, as_attachment=True)


# --- Convert WAV to MP3 with SSE progress ---
@tts_bp.route("/api/tts/generation/<filename>/mp3-convert")
def convert_to_mp3(filename):
    if not filename.endswith(".wav"):
        return jsonify({"error": "Only .wav files can be converted"}), 400
    folder = _folder_for_file(filename)
    job_dir = _tts_job_dir(folder)
    wav_path = os.path.join(job_dir, filename)
    if not os.path.exists(wav_path):
        return jsonify({"error": "File not found"}), 404

    mp3_name = filename.rsplit(".", 1)[0] + ".mp3"
    mp3_path = os.path.join(job_dir, mp3_name)

    if os.path.exists(mp3_path):
        def _done():
            yield f"data: {json.dumps({'phase': 'done', 'progress': 100})}\n\n"
        return Response(
            _done(), mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return jsonify({"error": "ffmpeg not found. Place ffmpeg in bin/ or install it system-wide."}), 501

    total_duration = 0.0
    json_path = wav_path.rsplit(".", 1)[0] + ".json"
    if os.path.exists(json_path):
        with open(json_path) as f:
            total_duration = json.load(f).get("duration_seconds", 0.0)
    if total_duration <= 0:
        try:
            info = sf.info(wav_path)
            total_duration = info.duration
        except Exception:
            pass

    def stream():
        yield f"data: {json.dumps({'phase': 'converting', 'progress': 0})}\n\n"

        proc = subprocess.Popen(
            [ffmpeg, "-i", wav_path, "-codec:a", "libmp3lame", "-qscale:a", "2",
             "-progress", "pipe:1", "-nostats", "-y", mp3_path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )

        try:
            last_pct = 0
            for line in proc.stdout:
                line = line.strip()
                if line.startswith("out_time_us="):
                    try:
                        us = int(line.split("=", 1)[1])
                        if total_duration > 0:
                            pct = min(99, int((us / 1_000_000) / total_duration * 100))
                            if pct > last_pct:
                                last_pct = pct
                                yield f"data: {json.dumps({'phase': 'converting', 'progress': pct})}\n\n"
                    except (ValueError, ZeroDivisionError):
                        pass
                elif line == "progress=end":
                    break

            proc.wait(timeout=30)

            if proc.returncode == 0:
                yield f"data: {json.dumps({'phase': 'done', 'progress': 100})}\n\n"
            else:
                err = proc.stderr.read()[:200] if proc.stderr else "Unknown error"
                yield f"data: {json.dumps({'phase': 'error', 'message': err})}\n\n"
        except GeneratorExit:
            proc.kill()
            proc.wait(timeout=5)
        finally:
            if proc.stdout:
                proc.stdout.close()
            if proc.stderr:
                proc.stderr.close()

    return Response(
        stream(), mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# --- Serve TTS audio files ---
@tts_bp.route("/output/tts/<path:filename>")
def serve_audio(filename):
    return send_from_directory(TTS_DIR, filename)
