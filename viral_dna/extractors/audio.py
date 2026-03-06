"""viral_dna.extractors.audio — Audio feature extraction.

Uses soundfile + numpy for core metrics, librosa (lazy) for BPM/onsets.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np
from loguru import logger

from viral_dna import config as cfg
from viral_dna.io_utils import find_audio, find_video
from viral_dna.schemas import AudioFeatures


def _extract_audio_from_video(video_path: Path) -> Path | None:
    """Extract audio track from video to a temp WAV file."""
    tmp = Path(tempfile.mktemp(suffix=".wav"))
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-vn", "-acodec", "pcm_s16le",
             "-ar", "22050", "-ac", "1", str(tmp)],
            capture_output=True, timeout=60,
        )
        if tmp.is_file() and tmp.stat().st_size > 0:
            return tmp
    except Exception as e:
        logger.warning("Failed to extract audio from video: {}", e)
    return None


def _load_audio(folder: Path) -> tuple[np.ndarray, int] | None:
    """Load audio data as numpy array + sample rate."""
    import soundfile as sf

    audio_path = find_audio(folder)
    if audio_path:
        data, sr = sf.read(str(audio_path), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        return data, sr

    video_path = find_video(folder)
    if video_path:
        tmp = _extract_audio_from_video(video_path)
        if tmp:
            try:
                data, sr = sf.read(str(tmp), dtype="float32")
                if data.ndim > 1:
                    data = data.mean(axis=1)
                return data, sr
            finally:
                tmp.unlink(missing_ok=True)

    return None


def extract(folder: str | Path) -> AudioFeatures:
    """Extract audio features from audio/video in the given folder."""
    folder = Path(folder)
    result = _load_audio(folder)
    if result is None:
        logger.warning("No audio found in {}", folder)
        return AudioFeatures()

    audio, sr = result
    duration = len(audio) / sr
    logger.info("Extracting audio features ({:.1f}s, {}Hz)", duration, sr)

    # RMS energy
    hop = cfg.RMS_HOP_LENGTH
    frame_len = cfg.RMS_FRAME_LENGTH
    n_frames = max(1, (len(audio) - frame_len) // hop + 1)
    rms_values = np.array([
        np.sqrt(np.mean(audio[i * hop:i * hop + frame_len] ** 2))
        for i in range(n_frames)
    ])
    rms_mean = float(np.mean(rms_values))
    rms_std = float(np.std(rms_values))
    energy_variance = float(np.var(rms_values))

    # Silence ratio
    silence_db = cfg.SILENCE_THRESHOLD_DB
    silence_threshold = 10 ** (silence_db / 20)
    silent_frames = int(np.sum(rms_values < silence_threshold))
    silence_ratio = silent_frames / max(1, len(rms_values))

    # BPM and onsets (lazy librosa import)
    bpm = 0.0
    onset_count = 0
    try:
        import librosa
        tempo, _ = librosa.beat.beat_track(y=audio, sr=sr, hop_length=hop)
        bpm = float(tempo[0]) if hasattr(tempo, '__len__') else float(tempo)
        onsets = librosa.onset.onset_detect(y=audio, sr=sr, hop_length=hop)
        onset_count = len(onsets)
    except ImportError:
        logger.debug("librosa not available — skipping BPM/onset detection")
    except Exception as e:
        logger.warning("BPM/onset detection failed: {}", e)

    onset_rate = onset_count / duration if duration > 0 else 0.0

    features = AudioFeatures(
        duration=round(duration, 3),
        rms_mean=round(rms_mean, 6),
        rms_std=round(rms_std, 6),
        energy_variance=round(energy_variance, 8),
        silence_ratio=round(silence_ratio, 3),
        bpm=round(bpm, 1),
        onset_count=onset_count,
        onset_rate=round(onset_rate, 2),
    )
    logger.success("Audio features: {:.1f}s, RMS {:.4f}, BPM {:.0f}, silence {:.0%}",
                   duration, rms_mean, bpm, silence_ratio)
    return features
