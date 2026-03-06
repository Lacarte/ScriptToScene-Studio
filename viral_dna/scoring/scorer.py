"""viral_dna.scoring.scorer — Compare generated video output against DNA targets.

Scores timing, visual, caption, and pacing similarity, returning 0–100
with actionable suggestions.
"""

from __future__ import annotations

from loguru import logger

from viral_dna.schemas import Blueprint


def _score_timing(blueprint: Blueprint, segments: list[dict]) -> tuple[float, list[str]]:
    """Score how well segment durations match blueprint timing targets."""
    if not segments:
        return 0.0, ["No segments found"]

    target = blueprint.segmentation.timing
    suggestions = []
    scores = []

    for seg in segments:
        dur = seg.get("duration", 0)
        if dur <= 0:
            continue
        # Score based on distance from target
        diff = abs(dur - target.target_duration)
        max_diff = target.max_duration - target.min_duration
        score = max(0, 1.0 - (diff / max(0.1, max_diff)))
        scores.append(score)

        if dur > target.max_duration:
            suggestions.append(
                f"Scene {seg.get('index', '?')} is {dur:.1f}s — reduce to ≤{target.max_duration:.1f}s")
        elif dur < target.min_duration:
            suggestions.append(
                f"Scene {seg.get('index', '?')} is {dur:.1f}s — extend to ≥{target.min_duration:.1f}s")

    avg_score = sum(scores) / len(scores) if scores else 0.0
    return round(avg_score * 100, 1), suggestions


def _score_visual(blueprint: Blueprint, scenes: list[dict]) -> tuple[float, list[str]]:
    """Score visual composition against blueprint targets."""
    if not scenes:
        return 0.0, ["No scenes found"]

    target_mix = blueprint.visual.type_mix
    suggestions = []

    # Count scene types
    type_counts: dict[str, int] = {}
    for s in scenes:
        t = s.get("type_of_scene", "video")
        type_counts[t] = type_counts.get(t, 0) + 1

    total = len(scenes)
    scores = []

    for scene_type, target_ratio in target_mix.items():
        actual_ratio = type_counts.get(scene_type, 0) / total
        diff = abs(actual_ratio - target_ratio)
        score = max(0, 1.0 - diff * 2)
        scores.append(score)

        if actual_ratio < target_ratio - 0.15:
            suggestions.append(
                f"Add more {scene_type} scenes ({actual_ratio:.0%} vs target {target_ratio:.0%})")
        elif actual_ratio > target_ratio + 0.15:
            suggestions.append(
                f"Too many {scene_type} scenes ({actual_ratio:.0%} vs target {target_ratio:.0%})")

    avg_score = sum(scores) / len(scores) if scores else 0.0
    return round(avg_score * 100, 1), suggestions


def _score_caption(blueprint: Blueprint, caption_data: dict | None) -> tuple[float, list[str]]:
    """Score caption style against blueprint targets."""
    if not caption_data:
        return 50.0, ["No caption data available for scoring"]

    target = blueprint.caption
    suggestions = []
    scores = []

    # Check preset match
    style = caption_data.get("style", {})
    if style.get("preset") == target.style_preset:
        scores.append(1.0)
    else:
        scores.append(0.3)
        suggestions.append(f"Caption preset '{style.get('preset', '?')}' doesn't match target '{target.style_preset}'")

    return round(sum(scores) / len(scores) * 100, 1) if scores else 50.0, suggestions


def _score_pacing(blueprint: Blueprint, segments: list[dict]) -> tuple[float, list[str]]:
    """Score pacing curve similarity."""
    target_curve = blueprint.visual.pacing_curve
    if not target_curve or not segments:
        return 50.0, []

    # Build actual pacing from segment durations
    suggestions = []

    # Check hook timing
    if segments:
        first_dur = segments[0].get("duration", 0)
        hook_target = blueprint.hook.duration
        if first_dur > hook_target * 1.3:
            suggestions.append(
                f"Hook scene is {first_dur:.1f}s — should be ≤{hook_target:.1f}s for faster engagement")

    # Check acceleration pattern
    if len(segments) >= 3:
        first_third = [s.get("duration", 0) for s in segments[:len(segments) // 3]]
        last_third = [s.get("duration", 0) for s in segments[-(len(segments) // 3):]]
        avg_first = sum(first_third) / len(first_third) if first_third else 0
        avg_last = sum(last_third) / len(last_third) if last_third else 0

        # Check if target curve shows acceleration
        if len(target_curve) >= 2 and target_curve[-1] > target_curve[0]:
            # Target accelerates — check if actual does too
            if avg_last >= avg_first:
                suggestions.append("Closing scenes should be shorter/faster to match viral pacing")

    return 65.0, suggestions


def score_project(
    blueprint: Blueprint,
    segments: list[dict] | None = None,
    scenes: list[dict] | None = None,
    caption_data: dict | None = None,
) -> dict:
    """Score a generated project against blueprint DNA.

    Returns dict with overall score (0–100), component scores, and suggestions.
    """
    logger.info("Scoring project against blueprint (niche: {})", blueprint.niche)

    timing_score, timing_suggestions = _score_timing(blueprint, segments or [])
    visual_score, visual_suggestions = _score_visual(blueprint, scenes or [])
    caption_score, caption_suggestions = _score_caption(blueprint, caption_data)
    pacing_score, pacing_suggestions = _score_pacing(blueprint, segments or [])

    # Weighted average
    overall = round(
        timing_score * 0.30 +
        visual_score * 0.25 +
        caption_score * 0.15 +
        pacing_score * 0.30,
        1,
    )

    all_suggestions = timing_suggestions + visual_suggestions + caption_suggestions + pacing_suggestions

    result = {
        "overall_score": overall,
        "timing_similarity": timing_score,
        "visual_similarity": visual_score,
        "caption_similarity": caption_score,
        "pacing_similarity": pacing_score,
        "suggestions": all_suggestions[:10],  # Cap at 10
    }

    logger.success("Score: {}/100 (timing={}, visual={}, caption={}, pacing={})",
                   overall, timing_score, visual_score, caption_score, pacing_score)
    return result
