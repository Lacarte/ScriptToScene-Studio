"""viral_dna.extractors.text — Alignment-based text/timing feature extraction.

Operates on alignment.json (word-level timestamps) — no heavy dependencies.
"""

from __future__ import annotations

import statistics
from pathlib import Path

from loguru import logger

from viral_dna import config as cfg
from viral_dna.io_utils import load_json, find_alignment, find_transcript
from viral_dna.schemas import TextFeatures


def extract(folder: str | Path) -> TextFeatures:
    """Extract text timing features from alignment.json in the given folder."""
    folder = Path(folder)
    align_path = find_alignment(folder)
    if not align_path:
        logger.warning("No alignment.json found in {}", folder)
        return TextFeatures()

    data = load_json(align_path)
    words = data.get("alignment", [])
    if not words:
        logger.warning("Empty alignment data in {}", align_path)
        return TextFeatures()

    logger.info("Extracting text features from {} ({} words)", align_path.name, len(words))

    # Basic metrics
    word_count = len(words)
    first_begin = words[0].get("begin", 0.0)
    last_end = words[-1].get("end", 0.0)
    duration = last_end - first_begin if last_end > first_begin else 0.001
    wps = word_count / duration if duration > 0 else 0.0

    # First word latency
    first_word_latency = first_begin

    # Pause durations (gaps between consecutive words)
    pauses = []
    for i in range(1, len(words)):
        gap = words[i].get("begin", 0) - words[i - 1].get("end", 0)
        if gap >= cfg.PAUSE_MIN_GAP:
            pauses.append(round(gap, 3))

    median_pause = statistics.median(pauses) if pauses else 0.0
    max_pause = max(pauses) if pauses else 0.0

    # Phrase lengths (words between significant pauses)
    phrases: list[int] = []
    current_phrase = 1
    for i in range(1, len(words)):
        gap = words[i].get("begin", 0) - words[i - 1].get("end", 0)
        if gap >= cfg.PHRASE_BREAK_GAP:
            phrases.append(current_phrase)
            current_phrase = 1
        else:
            current_phrase += 1
    phrases.append(current_phrase)
    avg_phrase = statistics.mean(phrases) if phrases else 0.0

    # Windowed WPS
    window = cfg.WPS_WINDOW_SECONDS
    total_time = last_end
    wps_windowed = []
    t = 0.0
    while t < total_time:
        t_end = t + window
        count = sum(1 for w in words if w.get("begin", 0) >= t and w.get("end", 0) <= t_end)
        wps_windowed.append(round(count / window, 2))
        t += window

    # Hook analysis (first N seconds vs rest)
    hook_dur = cfg.HOOK_DURATION_SECONDS
    hook_words = [w for w in words if w.get("end", 0) <= hook_dur]
    body_words = [w for w in words if w.get("begin", 0) > hook_dur]

    hook_wps = len(hook_words) / hook_dur if hook_dur > 0 else 0.0
    body_dur = duration - hook_dur
    body_wps = len(body_words) / body_dur if body_dur > 0 else 0.0

    features = TextFeatures(
        word_count=word_count,
        duration=round(duration, 3),
        words_per_second=round(wps, 2),
        wps_windowed=wps_windowed,
        pause_durations=pauses,
        median_pause=round(median_pause, 3),
        max_pause=round(max_pause, 3),
        phrase_lengths=phrases,
        avg_phrase_length=round(avg_phrase, 1),
        first_word_latency=round(first_word_latency, 3),
        hook_wps=round(hook_wps, 2),
        body_wps=round(body_wps, 2),
        hook_duration=hook_dur,
    )
    logger.success("Text features: {} words, {:.1f} WPS, {} pauses, hook WPS {:.1f}",
                   word_count, wps, len(pauses), hook_wps)
    return features
