"""viral_dna.extractors.video — Video feature extraction.

Uses ffprobe for metadata/scene cuts, OpenCV for motion/color analysis.
Subsamples aggressively for performance.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
from loguru import logger

from viral_dna import config as cfg
from viral_dna.io_utils import find_video
from viral_dna.schemas import VideoFeatures


def _ffprobe_metadata(video_path: Path) -> dict:
    """Extract basic metadata via ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", str(video_path)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                return {
                    "width": int(stream.get("width", 0)),
                    "height": int(stream.get("height", 0)),
                    "fps": eval(stream["r_frame_rate"]) if "r_frame_rate" in stream else 30.0,
                    "duration": float(data.get("format", {}).get("duration", 0)),
                }
    except Exception as e:
        logger.warning("ffprobe metadata failed: {}", e)
    return {"width": 0, "height": 0, "fps": 30.0, "duration": 0.0}


def _detect_scene_cuts(video_path: Path) -> list[float]:
    """Detect scene cuts using ffprobe scene filter (fast, reliable)."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-f", "lavfi",
             "-i", f"movie={str(video_path).replace(chr(92), '/')},select='gt(scene,{cfg.SCENE_DETECT_THRESHOLD})'",
             "-show_entries", "frame=pkt_pts_time",
             "-print_format", "json"],
            capture_output=True, text=True, timeout=120,
        )
        data = json.loads(result.stdout)
        cuts = [float(f["pkt_pts_time"]) for f in data.get("frames", [])
                if "pkt_pts_time" in f]
        return sorted(cuts)
    except Exception as e:
        logger.warning("ffprobe scene detection failed, falling back to OpenCV: {}", e)
        return _detect_cuts_opencv(video_path)


def _detect_cuts_opencv(video_path: Path) -> list[float]:
    """Fallback: detect scene cuts via frame histogram diff."""
    try:
        import cv2
    except ImportError:
        logger.warning("OpenCV not available — no scene cut detection")
        return []

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cuts = []
    prev_hist = None
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % 3 == 0:  # sample every 3rd frame
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            hist = cv2.calcHist([gray], [0], None, [64], [0, 256])
            cv2.normalize(hist, hist)
            if prev_hist is not None:
                diff = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA)
                if diff > 0.5:
                    cuts.append(round(frame_idx / fps, 3))
            prev_hist = hist
        frame_idx += 1

    cap.release()
    return cuts


def _analyze_motion(video_path: Path, fps: float, duration: float) -> tuple[float, float, str]:
    """Analyze motion via optical flow on subsampled frames."""
    try:
        import cv2
    except ImportError:
        return 0.0, 0.0, "none"

    cap = cv2.VideoCapture(str(video_path))
    sample_every = max(1, cfg.MOTION_SAMPLE_EVERY_N)
    prev_gray = None
    flow_magnitudes = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_every == 0:
            small = cv2.resize(frame, (160, 90))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            if prev_gray is not None:
                flow = cv2.calcOpticalFlowFarneback(
                    prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
                mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                flow_magnitudes.append(float(np.mean(mag)))
            prev_gray = gray
        frame_idx += 1

    cap.release()

    if not flow_magnitudes:
        return 0.0, 0.0, "none"

    mean_flow = float(np.mean(flow_magnitudes))
    std_flow = float(np.std(flow_magnitudes))

    # Detect zoom trend from flow field (simplified)
    zoom_trend = "none"
    if len(flow_magnitudes) >= 4:
        first_half = np.mean(flow_magnitudes[:len(flow_magnitudes) // 2])
        second_half = np.mean(flow_magnitudes[len(flow_magnitudes) // 2:])
        if second_half > first_half * 1.3:
            zoom_trend = "slow_in"
        elif first_half > second_half * 1.3:
            zoom_trend = "slow_out"

    return round(mean_flow, 3), round(std_flow, 3), zoom_trend


def _analyze_color(video_path: Path, duration: float) -> tuple[list[str], float, float]:
    """Extract dominant color palette via k-means on subsampled frames."""
    try:
        import cv2
    except ImportError:
        return [], 128.0, 0.5

    cap = cv2.VideoCapture(str(video_path))
    fps_actual = cap.get(cv2.CAP_PROP_FPS) or 30.0
    sample_interval = max(1, int(fps_actual / cfg.COLOR_SAMPLE_FPS))
    all_pixels = []
    brightnesses = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_interval == 0:
            small = cv2.resize(frame, (80, 45))
            rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
            all_pixels.append(rgb.reshape(-1, 3))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            brightnesses.append(float(np.mean(gray)))
        frame_idx += 1

    cap.release()

    if not all_pixels:
        return [], 128.0, 0.5

    pixels = np.vstack(all_pixels).astype(np.float32)
    avg_brightness = float(np.mean(brightnesses))

    # Contrast: std of brightness across frames
    contrast = float(np.std(brightnesses)) / 128.0 if brightnesses else 0.5

    # K-means clustering
    k = min(cfg.COLOR_K_CLUSTERS, len(pixels))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(pixels, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)

    # Sort by frequency
    counts = np.bincount(labels.flatten())
    sorted_indices = np.argsort(-counts)
    palette = []
    for idx in sorted_indices:
        r, g, b = centers[idx].astype(int)
        palette.append(f"#{r:02x}{g:02x}{b:02x}")

    return palette, round(avg_brightness, 1), round(contrast, 3)


def _compute_pacing_curve(cuts: list[float], duration: float) -> list[float]:
    """Compute cut density per time window — preserves pacing structure."""
    window = cfg.PACING_WINDOW_SECONDS
    if duration <= 0:
        return []
    bins = int(duration / window) + 1
    curve = [0.0] * bins
    for cut_time in cuts:
        idx = min(int(cut_time / window), bins - 1)
        curve[idx] += 1.0
    return [round(v, 1) for v in curve]


def extract(folder: str | Path) -> VideoFeatures:
    """Extract video features from video file in the given folder."""
    folder = Path(folder)
    video_path = find_video(folder)
    if not video_path:
        logger.warning("No video file found in {}", folder)
        return VideoFeatures()

    logger.info("Extracting video features from {}", video_path.name)

    # Metadata
    meta = _ffprobe_metadata(video_path)
    fps = meta["fps"]
    duration = meta["duration"]
    width = meta["width"]
    height = meta["height"]

    # Aspect ratio
    if width > 0 and height > 0:
        from math import gcd
        g = gcd(width, height)
        aspect_ratio = f"{width // g}:{height // g}"
    else:
        aspect_ratio = "9:16"

    # Scene cuts
    cuts = _detect_scene_cuts(video_path)
    cut_count = len(cuts)
    avg_shot = duration / (cut_count + 1) if cut_count > 0 else duration
    cut_rate_10s = (cut_count / duration * 10) if duration > 0 else 0.0
    pacing_curve = _compute_pacing_curve(cuts, duration)

    # Motion analysis
    flow_mean, flow_std, zoom_trend = _analyze_motion(video_path, fps, duration)

    # Color analysis
    palette, brightness, contrast = _analyze_color(video_path, duration)

    features = VideoFeatures(
        fps=round(fps, 2),
        duration=round(duration, 3),
        width=width,
        height=height,
        aspect_ratio=aspect_ratio,
        scene_cuts=cuts,
        cut_count=cut_count,
        avg_shot_length=round(avg_shot, 2),
        cut_rate_per_10s=round(cut_rate_10s, 2),
        pacing_curve=pacing_curve,
        optical_flow_mean=flow_mean,
        optical_flow_std=flow_std,
        zoom_trend=zoom_trend,
        dominant_palette=palette,
        avg_brightness=brightness,
        contrast_score=contrast,
    )
    logger.success("Video features: {:.1f}s, {} cuts, avg shot {:.1f}s, motion {:.2f}",
                   duration, cut_count, avg_shot, flow_mean)
    return features
