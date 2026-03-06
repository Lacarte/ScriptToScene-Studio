"""viral_dna.builders.profile — Convert raw features into a normalized DNA profile."""

from __future__ import annotations

from loguru import logger

from viral_dna import config as cfg
from viral_dna.schemas import (
    RawFeatures, DNAProfile, TimingProfile, VisualProfile,
    AudioProfile, CaptionProfile,
)


def _classify(value: float, thresholds: dict[str, tuple[float, float]]) -> str:
    """Classify a value into a named bucket using threshold ranges."""
    for label, (lo, hi) in thresholds.items():
        if lo <= value < hi:
            return label
    return list(thresholds.keys())[-1]


def _map_caption_preset(region: str, highlight: bool, stroke: bool, weight: str) -> str:
    """Map detected caption features to existing ScriptToScene presets."""
    if highlight:
        return "karaoke"
    if weight == "bold" and stroke:
        return "bold_popup"
    if region == "bottom_center" and weight == "normal":
        return "subtitle_bar"
    if weight == "normal":
        return "minimal"
    return "bold_popup"


def _infer_voice_style(wps: float, energy_var: float, silence_ratio: float) -> str:
    """Infer voice style tag from combined metrics."""
    if wps > 4.0 and energy_var > 0.005:
        return "energetic"
    if energy_var > 0.008 and silence_ratio > 0.15:
        return "dramatic"
    if wps < 2.5 and energy_var < 0.003:
        return "calm"
    if silence_ratio > 0.12:
        return "storytelling"
    return "calm"


def build_profile(raw: RawFeatures) -> DNAProfile:
    """Convert raw extracted features into a classified DNA profile."""
    logger.info("Building DNA profile from raw features")

    # Timing
    timing = TimingProfile(
        avg_shot_length=raw.video.avg_shot_length,
        cut_rate=raw.video.cut_rate_per_10s,
        pacing_curve=raw.video.pacing_curve,
        pacing_label=_classify(raw.video.cut_rate_per_10s, cfg.PACING_THRESHOLDS),
        words_per_second=raw.text.words_per_second,
        median_pause=raw.text.median_pause,
        hook_duration=raw.text.hook_duration,
        hook_wps=raw.text.hook_wps,
        first_word_latency=raw.text.first_word_latency,
    )

    # Visual
    visual = VisualProfile(
        motion_level=_classify(raw.video.optical_flow_mean, cfg.MOTION_THRESHOLDS),
        dominant_palette=raw.video.dominant_palette,
        brightness=_classify(raw.video.avg_brightness, cfg.BRIGHTNESS_THRESHOLDS),
        contrast="high" if raw.video.contrast_score > 0.4 else (
            "low" if raw.video.contrast_score < 0.15 else "medium"),
        zoom_trend=raw.video.zoom_trend,
    )

    # Audio
    audio = AudioProfile(
        energy_level=_classify(raw.audio.rms_mean, cfg.ENERGY_THRESHOLDS),
        voice_style=_infer_voice_style(
            raw.text.words_per_second,
            raw.audio.energy_variance,
            raw.audio.silence_ratio,
        ),
        bpm=raw.audio.bpm,
        silence_ratio=raw.audio.silence_ratio,
    )

    # Caption
    caption = CaptionProfile(
        region=raw.caption.caption_region,
        lines=raw.caption.estimated_lines,
        max_words_per_line=raw.caption.estimated_max_words,
        highlight_mode="word" if raw.caption.has_highlight else "none",
        font_weight=raw.caption.font_weight_guess,
        has_stroke=raw.caption.has_stroke,
        change_rate=raw.caption.change_rate,
        style_preset=_map_caption_preset(
            raw.caption.caption_region,
            raw.caption.has_highlight,
            raw.caption.has_stroke,
            raw.caption.font_weight_guess,
        ),
    )

    profile = DNAProfile(timing=timing, visual=visual, audio=audio, caption=caption)
    logger.success("DNA profile: pacing={}, motion={}, voice={}, caption={}",
                   timing.pacing_label, visual.motion_level,
                   audio.voice_style, caption.style_preset)
    return profile
