"""viral_dna.extractors.caption — Caption style detection via frame analysis.

Samples frames at 1fps and analyzes bottom-third edge density to detect
caption presence, position, and change rate. OCR is optional.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from loguru import logger

from viral_dna import config as cfg
from viral_dna.io_utils import find_video
from viral_dna.schemas import CaptionFeatures


def _analyze_caption_region(frame, height: int) -> tuple[float, str]:
    """Analyze edge density in frame regions to detect caption placement."""
    try:
        import cv2
    except ImportError:
        return 0.0, "bottom_center"

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)

    # Split into thirds
    third = height // 3
    top_density = float(np.mean(edges[:third] > 0))
    mid_density = float(np.mean(edges[third:2 * third] > 0))
    bot_density = float(np.mean(edges[2 * third:] > 0))

    # Determine caption region by highest text-like density
    densities = {"top": top_density, "center": mid_density, "bottom_center": bot_density}
    region = max(densities, key=densities.get)

    # Caption presence = excess edge density vs background
    bg_density = min(top_density, mid_density, bot_density)
    caption_density = max(top_density, mid_density, bot_density)
    presence = max(0.0, caption_density - bg_density)

    return presence, region


def _detect_stroke(frame, region_slice) -> bool:
    """Detect if captions have stroke/outline (high contrast edges in text region)."""
    try:
        import cv2
    except ImportError:
        return False

    roi = frame[region_slice]
    if roi.size == 0:
        return False
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 100, 200)
    edge_ratio = float(np.mean(edges > 0))
    return edge_ratio > 0.08


def _detect_highlight(frames_data: list[dict]) -> bool:
    """Detect word-by-word highlight mode from frame-to-frame color changes in caption region."""
    if len(frames_data) < 3:
        return False
    color_changes = 0
    for i in range(1, len(frames_data)):
        if frames_data[i].get("region") == frames_data[i - 1].get("region"):
            diff = abs(frames_data[i].get("mean_color", 0) - frames_data[i - 1].get("mean_color", 0))
            if diff > 20:
                color_changes += 1
    return color_changes / max(1, len(frames_data) - 1) > 0.3


def extract(folder: str | Path) -> CaptionFeatures:
    """Extract caption features from video frames in the given folder."""
    folder = Path(folder)
    video_path = find_video(folder)
    if not video_path:
        logger.warning("No video file found in {}", folder)
        return CaptionFeatures()

    try:
        import cv2
    except ImportError:
        logger.warning("OpenCV not available — returning defaults for caption features")
        return CaptionFeatures()

    logger.info("Extracting caption features from {}", video_path.name)

    cap = cv2.VideoCapture(str(video_path))
    fps_actual = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sample_interval = max(1, int(fps_actual / cfg.CAPTION_SAMPLE_FPS))

    presence_scores = []
    regions = []
    frames_data = []
    has_stroke_votes = []
    frame_idx = 0
    prev_region_hash = None

    caption_changes = 0
    third = height // 3

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % sample_interval == 0:
            small = cv2.resize(frame, (320, 180))
            small_h = 180
            presence, region = _analyze_caption_region(small, small_h)
            presence_scores.append(presence)
            regions.append(region)

            # Region slice for caption area
            bot_slice = slice(int(small_h * (1 - cfg.CAPTION_BOTTOM_FRACTION)), small_h)
            has_stroke_votes.append(_detect_stroke(small, bot_slice))

            # Track mean color in caption region for highlight detection
            roi = small[bot_slice]
            mean_color = float(np.mean(roi)) if roi.size > 0 else 0.0
            frames_data.append({"region": region, "mean_color": mean_color})

            # Caption change detection
            region_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            region_hash = hash(region_gray.tobytes()[:200])
            if prev_region_hash is not None and region_hash != prev_region_hash:
                caption_changes += 1
            prev_region_hash = region_hash

        frame_idx += 1

    cap.release()

    if not presence_scores:
        return CaptionFeatures()

    # Aggregate
    avg_presence = float(np.mean(presence_scores))
    dominant_region = max(set(regions), key=regions.count) if regions else "bottom_center"
    has_stroke = sum(has_stroke_votes) > len(has_stroke_votes) * 0.4
    has_highlight = _detect_highlight(frames_data)

    duration = total_frames / fps_actual if fps_actual > 0 else 1.0
    change_rate = caption_changes / duration if duration > 0 else 0.0

    # Estimate font weight from edge density magnitude
    font_weight = "bold" if avg_presence > 0.04 else "normal"

    features = CaptionFeatures(
        presence_score=round(avg_presence, 4),
        caption_region=dominant_region,
        estimated_lines=2,
        estimated_max_words=4,
        change_rate=round(change_rate, 2),
        has_stroke=has_stroke,
        has_highlight=has_highlight,
        font_weight_guess=font_weight,
    )
    logger.success("Caption features: region={}, presence={:.3f}, change_rate={:.1f}/s, stroke={}, highlight={}",
                   dominant_region, avg_presence, change_rate, has_stroke, has_highlight)
    return features
