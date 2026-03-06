"""viral_dna.builders.blueprint — Convert niche DNA into a pipeline-consumable blueprint.

This is the critical translation layer: it takes classified DNA traits and produces
concrete numbers the segmenter, scene generator, and caption system can use.
"""

from __future__ import annotations

from loguru import logger

from viral_dna.schemas import (
    NicheDNA, Blueprint, SegmentationRules, TimingTargets,
    VisualTargets, CaptionTargets, HookRules, VisualConsistency,
)


def _scale(value: float, in_min: float, in_max: float, out_min: float, out_max: float) -> float:
    """Linear scale a value from one range to another, clamped."""
    if in_max == in_min:
        return (out_min + out_max) / 2
    ratio = (value - in_min) / (in_max - in_min)
    ratio = max(0.0, min(1.0, ratio))
    return out_min + ratio * (out_max - out_min)


def _derive_setting(palette: list[str], motion: str, brightness: str) -> str:
    """Auto-derive a setting description from visual DNA."""
    # Analyze palette warmth
    warm_count = 0
    cool_count = 0
    for hex_color in palette[:3]:
        try:
            r = int(hex_color[1:3], 16)
            g = int(hex_color[3:5], 16)
            b = int(hex_color[5:7], 16)
            if r > b + 30:
                warm_count += 1
            elif b > r + 30:
                cool_count += 1
        except (ValueError, IndexError):
            pass

    is_warm = warm_count > cool_count

    parts = []
    if brightness == "dark":
        parts.append("dimly lit" if is_warm else "dark shadowy")
    elif brightness == "bright":
        parts.append("brightly lit" if is_warm else "clean well-lit")

    if is_warm:
        parts.append("warm toned environment with natural earthy textures")
    else:
        parts.append("cool toned environment with modern clean surfaces")

    if motion in ("dynamic", "intense"):
        parts.append("with cinematic camera movement and dramatic angles")
    elif motion == "static":
        parts.append("with steady composed framing")
    else:
        parts.append("with gentle subtle camera motion")

    if brightness == "dark":
        parts.append("moody atmospheric lighting")
    elif brightness == "bright":
        parts.append("soft natural lighting")
    else:
        parts.append("balanced ambient lighting")

    return ", ".join(parts)


def _derive_mood(voice_style: str, brightness: str, energy: str, palette: list[str]) -> str:
    """Auto-derive a mood description from audio + visual DNA."""
    parts = []

    mood_map = {
        ("dramatic", "dark"): "intense moody atmosphere with heavy shadows and cinematic tension",
        ("dramatic", "medium"): "dramatic atmosphere with balanced contrast and emotional depth",
        ("dramatic", "bright"): "powerful uplifting atmosphere with dramatic highlights",
        ("energetic", "dark"): "high energy dark atmosphere with urgent pacing",
        ("energetic", "medium"): "vibrant energetic atmosphere with dynamic lighting",
        ("energetic", "bright"): "bright energetic atmosphere with bold vivid colors",
        ("calm", "dark"): "contemplative moody atmosphere with soft muted tones",
        ("calm", "medium"): "peaceful serene atmosphere with gentle balanced lighting",
        ("calm", "bright"): "warm peaceful atmosphere with soft natural glow",
        ("storytelling", "dark"): "immersive narrative atmosphere with atmospheric shadows",
        ("storytelling", "medium"): "engaging storytelling atmosphere with natural tones",
        ("storytelling", "bright"): "inviting narrative atmosphere with warm open lighting",
    }

    key = (voice_style, brightness)
    base_mood = mood_map.get(key, "balanced cinematic atmosphere")
    parts.append(base_mood)

    if energy == "high":
        parts.append("with heightened visual intensity")
    elif energy == "low":
        parts.append("with subdued restrained visuals")

    return ", ".join(parts)


def build_blueprint(dna: NicheDNA) -> Blueprint:
    """Convert niche DNA into an actionable pipeline blueprint."""
    p = dna.profile
    logger.info("Building blueprint for niche '{}' (ref: {})", dna.niche, dna.reference_video)

    # --- Segmentation rules ---
    avg_shot = p.timing.avg_shot_length or 2.5
    timing = TimingTargets(
        target_duration=round(avg_shot, 2),
        min_duration=round(max(0.8, avg_shot * 0.5), 2),
        max_duration=round(min(5.0, avg_shot * 1.8), 2),
        hook_duration=round(p.timing.hook_duration, 2),
        words_per_second=round(p.timing.words_per_second, 2),
        pause_threshold=round(max(0.15, p.timing.median_pause), 3),
    )

    # Break weights: scale pause weight based on silence ratio
    pause_weight = round(_scale(p.audio.silence_ratio, 0.05, 0.3, 3.0, 8.0))
    density_weight = round(_scale(p.timing.words_per_second, 1.5, 5.0, 1.0, 4.0))

    segmentation = SegmentationRules(
        timing=timing,
        break_weights={
            "pause": int(pause_weight),
            "punctuation": 8,
            "density": int(density_weight),
        },
        trigger_priority=["pause", "punctuation", "word_count"],
    )

    # --- Visual targets ---
    visual = VisualTargets(
        dominant_palette=p.visual.dominant_palette,
        motion_level=p.visual.motion_level,
        cut_rate=p.timing.cut_rate,
        pacing_curve=p.timing.pacing_curve,
        type_mix={"video": 0.70, "image": 0.20, "text": 0.10},
        zoom_behavior=p.visual.zoom_trend,
        transition_type="cut" if p.timing.pacing_label in ("fast", "frantic") else "dissolve",
    )

    # --- Caption targets ---
    caption = CaptionTargets(
        position=p.caption.region,
        max_words_per_line=p.caption.max_words_per_line,
        lines=p.caption.lines,
        highlight_mode=p.caption.highlight_mode,
        style_preset=p.caption.style_preset,
        font_weight=p.caption.font_weight,
        stroke=p.caption.has_stroke,
    )

    # --- Hook rules ---
    hook_intensity = "high" if p.timing.hook_wps > p.timing.words_per_second * 1.2 else (
        "medium" if p.timing.hook_wps > p.timing.words_per_second * 0.8 else "low")
    hook = HookRules(
        duration=round(p.timing.hook_duration, 2),
        caption_scale=1.3 if hook_intensity == "high" else 1.0,
        visual_intensity=hook_intensity,
        word_density=round(p.timing.hook_wps, 2),
    )

    # --- Visual consistency (auto-derived defaults, user edits in UI) ---
    consistency = VisualConsistency(
        character="",  # User fills this in
        setting=_derive_setting(
            p.visual.dominant_palette,
            p.visual.motion_level,
            p.visual.brightness,
        ),
        mood=_derive_mood(
            p.audio.voice_style,
            p.visual.brightness,
            p.audio.energy_level,
            p.visual.dominant_palette,
        ),
    )

    blueprint = Blueprint(
        niche=dna.niche,
        reference_video=dna.reference_video,
        segmentation=segmentation,
        visual=visual,
        caption=caption,
        hook=hook,
        consistency=consistency,
    )

    logger.success("Blueprint built: target_dur={:.1f}s, motion={}, caption={}, hook={}",
                   timing.target_duration, visual.motion_level,
                   caption.style_preset, hook_intensity)
    return blueprint
