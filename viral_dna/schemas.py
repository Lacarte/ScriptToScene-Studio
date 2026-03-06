"""viral_dna.schemas — Pydantic models for DNA profiles and blueprints.

These models define the contract between feature extraction, DNA profiling,
and pipeline consumption. The Blueprint is the final output that drives
ScriptToScene generation.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Raw feature containers (output of extractors)
# ---------------------------------------------------------------------------

class VideoFeatures(BaseModel):
    fps: float = 0.0
    duration: float = 0.0
    width: int = 0
    height: int = 0
    aspect_ratio: str = "9:16"
    scene_cuts: list[float] = Field(default_factory=list)
    cut_count: int = 0
    avg_shot_length: float = 0.0
    cut_rate_per_10s: float = 0.0
    pacing_curve: list[float] = Field(default_factory=list)
    optical_flow_mean: float = 0.0
    optical_flow_std: float = 0.0
    zoom_trend: str = "none"
    dominant_palette: list[str] = Field(default_factory=list)
    avg_brightness: float = 0.0
    contrast_score: float = 0.0


class AudioFeatures(BaseModel):
    duration: float = 0.0
    rms_mean: float = 0.0
    rms_std: float = 0.0
    energy_variance: float = 0.0
    silence_ratio: float = 0.0
    bpm: float = 0.0
    onset_count: int = 0
    onset_rate: float = 0.0


class TextFeatures(BaseModel):
    word_count: int = 0
    duration: float = 0.0
    words_per_second: float = 0.0
    wps_windowed: list[float] = Field(default_factory=list)
    pause_durations: list[float] = Field(default_factory=list)
    median_pause: float = 0.0
    max_pause: float = 0.0
    phrase_lengths: list[int] = Field(default_factory=list)
    avg_phrase_length: float = 0.0
    first_word_latency: float = 0.0
    hook_wps: float = 0.0
    body_wps: float = 0.0
    hook_duration: float = 3.0


class CaptionFeatures(BaseModel):
    presence_score: float = 0.0
    caption_region: str = "bottom_center"
    estimated_lines: int = 2
    estimated_max_words: int = 4
    change_rate: float = 0.0
    has_stroke: bool = False
    has_highlight: bool = False
    font_weight_guess: str = "bold"


class RawFeatures(BaseModel):
    video: VideoFeatures = Field(default_factory=VideoFeatures)
    audio: AudioFeatures = Field(default_factory=AudioFeatures)
    text: TextFeatures = Field(default_factory=TextFeatures)
    caption: CaptionFeatures = Field(default_factory=CaptionFeatures)


# ---------------------------------------------------------------------------
# DNA profile (normalized / classified from raw features)
# ---------------------------------------------------------------------------

class TimingProfile(BaseModel):
    avg_shot_length: float = 0.0
    cut_rate: float = 0.0
    pacing_curve: list[float] = Field(default_factory=list)
    pacing_label: str = "medium"          # slow | medium | fast | frantic
    words_per_second: float = 0.0
    median_pause: float = 0.0
    hook_duration: float = 3.0
    hook_wps: float = 0.0
    first_word_latency: float = 0.0


class VisualProfile(BaseModel):
    motion_level: str = "gentle"          # static | gentle | dynamic | intense
    dominant_palette: list[str] = Field(default_factory=list)
    brightness: str = "medium"            # dark | medium | bright
    contrast: str = "medium"              # low | medium | high
    zoom_trend: str = "none"


class AudioProfile(BaseModel):
    energy_level: str = "medium"          # low | medium | high
    voice_style: str = "calm"             # calm | energetic | dramatic | storytelling
    bpm: float = 0.0
    silence_ratio: float = 0.0


class CaptionProfile(BaseModel):
    region: str = "bottom_center"
    lines: int = 2
    max_words_per_line: int = 4
    highlight_mode: str = "none"          # none | word | phrase
    font_weight: str = "bold"
    has_stroke: bool = False
    change_rate: float = 0.0
    style_preset: str = "bold_popup"


class DNAProfile(BaseModel):
    timing: TimingProfile = Field(default_factory=TimingProfile)
    visual: VisualProfile = Field(default_factory=VisualProfile)
    audio: AudioProfile = Field(default_factory=AudioProfile)
    caption: CaptionProfile = Field(default_factory=CaptionProfile)


# ---------------------------------------------------------------------------
# Niche DNA (aggregated — currently 1:1 with profile)
# ---------------------------------------------------------------------------

class NicheDNA(BaseModel):
    niche: str = ""
    reference_video: str = ""
    video_count: int = 1
    confidence: str = "low"               # low (1 video) | medium | high
    profile: DNAProfile = Field(default_factory=DNAProfile)


# ---------------------------------------------------------------------------
# Blueprint (pipeline-consumable output)
# ---------------------------------------------------------------------------

class TimingTargets(BaseModel):
    target_duration: float = 2.5
    min_duration: float = 0.8
    max_duration: float = 4.0
    hook_duration: float = 3.0
    words_per_second: float = 3.0
    pause_threshold: float = 0.3


class SegmentationRules(BaseModel):
    timing: TimingTargets = Field(default_factory=TimingTargets)
    break_weights: dict = Field(default_factory=lambda: {
        "pause": 6, "punctuation": 8, "density": 3,
    })
    trigger_priority: list[str] = Field(default_factory=lambda: [
        "pause", "punctuation", "word_count",
    ])


class VisualTargets(BaseModel):
    dominant_palette: list[str] = Field(default_factory=list)
    motion_level: str = "gentle"
    cut_rate: float = 0.0
    pacing_curve: list[float] = Field(default_factory=list)
    type_mix: dict[str, float] = Field(default_factory=lambda: {
        "video": 0.70, "image": 0.20, "text": 0.10,
    })
    zoom_behavior: str = "none"
    transition_type: str = "cut"


class CaptionTargets(BaseModel):
    position: str = "bottom_center"
    max_words_per_line: int = 4
    lines: int = 2
    highlight_mode: str = "none"
    style_preset: str = "bold_popup"
    font_weight: str = "bold"
    stroke: bool = False


class HookRules(BaseModel):
    duration: float = 3.0
    caption_scale: float = 1.0
    visual_intensity: str = "medium"
    word_density: float = 3.0


class VisualConsistency(BaseModel):
    """Shared style block prepended to EVERY scene image prompt.

    DNA auto-derives setting and mood from extracted features.
    Character is user-defined (DNA can't know your character).
    All three fields are editable in the UI.
    """
    character: str = ""
    setting: str = ""
    mood: str = ""


class Blueprint(BaseModel):
    """The final output that drives ScriptToScene pipeline."""
    niche: str = ""
    reference_video: str = ""
    segmentation: SegmentationRules = Field(default_factory=SegmentationRules)
    visual: VisualTargets = Field(default_factory=VisualTargets)
    caption: CaptionTargets = Field(default_factory=CaptionTargets)
    hook: HookRules = Field(default_factory=HookRules)
    consistency: VisualConsistency = Field(default_factory=VisualConsistency)
