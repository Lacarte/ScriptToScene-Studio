"""viral_dna.config — Extraction settings and thresholds."""

# ---------------------------------------------------------------------------
# Video extraction
# ---------------------------------------------------------------------------
SCENE_DETECT_THRESHOLD = 0.3       # ffprobe scene detection sensitivity
MOTION_SAMPLE_EVERY_N = 10         # optical flow: every Nth frame
COLOR_SAMPLE_FPS = 1               # k-means: frames per second to sample
COLOR_K_CLUSTERS = 5               # dominant palette cluster count
PACING_WINDOW_SECONDS = 3.0        # cut density window size

# ---------------------------------------------------------------------------
# Audio extraction
# ---------------------------------------------------------------------------
SILENCE_THRESHOLD_DB = -40.0       # dB below which = silence
RMS_HOP_LENGTH = 512
RMS_FRAME_LENGTH = 2048

# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------
HOOK_DURATION_SECONDS = 3.0        # first N seconds = hook region
WPS_WINDOW_SECONDS = 3.0           # windowed WPS window size
PAUSE_MIN_GAP = 0.15               # minimum gap (s) to count as a pause
PHRASE_BREAK_GAP = 0.4             # gap (s) that breaks a phrase

# ---------------------------------------------------------------------------
# Caption extraction
# ---------------------------------------------------------------------------
CAPTION_SAMPLE_FPS = 1
CAPTION_BOTTOM_FRACTION = 0.33     # bottom third of frame
CAPTION_EDGE_THRESHOLD = 50        # Canny edge density threshold

# ---------------------------------------------------------------------------
# Profile classification thresholds
# ---------------------------------------------------------------------------
MOTION_THRESHOLDS = {
    "static": (0, 1.0),
    "gentle": (1.0, 4.0),
    "dynamic": (4.0, 10.0),
    "intense": (10.0, float("inf")),
}

PACING_THRESHOLDS = {
    "slow": (0, 2.0),
    "medium": (2.0, 4.0),
    "fast": (4.0, 7.0),
    "frantic": (7.0, float("inf")),
}

BRIGHTNESS_THRESHOLDS = {
    "dark": (0, 85),
    "medium": (85, 170),
    "bright": (170, 256),
}

ENERGY_THRESHOLDS = {
    "low": (0, 0.02),
    "medium": (0.02, 0.08),
    "high": (0.08, float("inf")),
}
