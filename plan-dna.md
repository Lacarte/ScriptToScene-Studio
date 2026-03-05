
This prompt ensures the system is built **incrementally**, testable at each step, and **future-proof for clustering** even though you are starting with **Niche DNA only**.

---

# MASTER PROMPT

## Build a Viral Video DNA Extractor (Phase-Based Development)

You are a **Senior Python Engineer + AI Video Analysis Architect**.

Your task is to build a tool called **viral_dna** for the project **ScriptToScene-Studio**.

The goal of this tool is to analyze viral videos and extract their **style DNA**, then generate a **blueprint** that can be used by a Script-to-Scene engine to recreate similar videos.

The system must be implemented **in phases**, where each phase builds on the previous one.

For now the system must support **Niche DNA only (one viral reference)**, but it must be architected so that **multi-video clustering can be added later without refactoring**.

Everything must run **locally using Python**.

---

# PROJECT CONTEXT

The analyzer receives a folder containing a viral video and related files.

Each input folder contains:

```
video.mp4
audio.mp3 (optional)
alignment.json
text.txt
```

alignment.json contains word timestamps.

Example:

```
{
 "word": "garden",
 "begin": 0.28,
 "end": 0.56
}
```

The viral videos are **mostly TikTok format (9:16)**.

The analyzer must extract style information from:

* video editing
* motion
* captions
* narration timing
* audio rhythm
* scene pacing

Then it must produce a **DNA profile** and a **generation blueprint**.

---

# OUTPUT STRUCTURE

```
outputs/
  niche_name/
      video_id/
          raw_features.json
          dna_profile.json
          report.md

      niche_dna.json
      blueprint.json
      scoring_rules.json
```

---

# PHASE 1 — PROJECT STRUCTURE

First create a Python package with the following architecture:

```
viral_dna/
    __init__.py
    cli.py
    config.py
    io.py

    features/
        video_features.py
        audio_features.py
        text_features.py
        caption_features.py

    dna/
        profile_builder.py
        niche_builder.py
        blueprint_builder.py
        scoring.py

    reports/
        report_md.py

requirements.txt
README.md
```

Provide:

* clean modular architecture
* logging
* type hints
* CLI entrypoint

---

# PHASE 2 — FEATURE EXTRACTION

Create feature extractors.

## Video features

Using OpenCV extract:

* fps
* duration
* resolution
* aspect ratio
* scene cuts
* average shot length
* shot length histogram
* cut rate per 10 seconds

Motion analysis:

* optical flow magnitude
* detect zoom trend
* detect camera shake

Color analysis:

* dominant palette using k-means
* brightness distribution
* contrast score

Illustration detection heuristic:

High flat colors + strong edges = illustration probability.

---

## Audio features

Using librosa or soundfile extract:

* RMS energy
* energy variance
* silence ratio
* onset detection
* approximate BPM

Using alignment.json compute:

* words per second
* pause duration
* phrase length

Infer voice style tags:

```
calm
energetic
fast
storytelling
dramatic
```

---

## Text structure

Using alignment and text:

Compute:

* average words per phrase
* phrase duration
* phrase density per second
* hook duration (first seconds)

---

## Caption features

Detect caption style using heuristics.

Extract:

* caption presence score
* caption region
* caption alignment
* average lines
* max words per line
* font weight guess
* stroke detection
* highlight mode
* caption change rate

OCR should be **optional only** via CLI flag.

Default method:

OpenCV edge density + bottom frame clustering.

---

# PHASE 3 — RAW FEATURES OUTPUT

Save all extracted metrics into:

```
raw_features.json
```

Example structure:

```
{
 "video_features": {},
 "audio_features": {},
 "text_features": {},
 "caption_features": {}
}
```

---

# PHASE 4 — DNA PROFILE

Convert raw features into a **normalized DNA profile**.

Create:

```
dna_profile.json
```

Example:

```
{
 "video_style": {},
 "audio_style": {},
 "caption_style": {},
 "timing_style": {}
}
```

Normalize numeric metrics into stable ranges.

Add interpretation tags.

---

# PHASE 5 — NICHE DNA

Since there is **one viral video per niche for now**, build:

```
niche_dna.json
```

This represents the **reference style**.

Later this will be aggregated across videos.

Structure:

```
{
 "niche": "example_niche",
 "reference_video": "video01",

 "core_traits": {},
 "timing_targets": {},
 "visual_targets": {},
 "caption_targets": {}
}
```

---

# PHASE 6 — BLUEPRINT GENERATOR

Create:

```
blueprint.json
```

This file must describe how to generate a similar video.

Include rules for:

### Scene segmentation

```
trigger_priority:
 - pause
 - word_count
 - time_limit
```

### Caption rules

```
region
lines
max_words_per_line
highlight_mode
stroke
font_weight
```

### Visual rules

```
motion_preset
transition_type
zoom_behavior
```

### Hook rules

```
hook_duration
caption_scale_multiplier
```

This blueprint must be **engine-agnostic** and usable by a Script-to-Scene generator.

---

# PHASE 7 — SCORING ENGINE

Create a scoring system that evaluates generated videos.

Input:

```
generated/video_folder
```

Output:

```
score.json
```

Score components:

```
timing_similarity
caption_similarity
audio_similarity
visual_similarity
```

Final score:

```
0 – 100
```

Provide suggestions for improvement.

Example:

```
increase words per second
reduce scene duration
move captions lower
```

---

# PHASE 8 — CLI COMMANDS

Implement CLI commands.

Analyze a viral video:

```
python -m viral_dna analyze --input inputs/niche/video01 --output outputs/niche/video01
```

Build niche DNA:

```
python -m viral_dna build-niche --input outputs/niche --output outputs/niche
```

Score a generated video:

```
python -m viral_dna score --ref outputs/niche/niche_dna.json --input generated/video01
```

Optional flags:

```
--ocr
--debug
--max-frames
```

---

# PHASE 9 — REPORT GENERATION

Generate:

```
report.md
```

The report should include:

* summary of style
* pacing analysis
* caption behavior
* audio rhythm
* recommendations

---

# PHASE 10 — FUTURE EXTENSIONS (Do Not Implement Yet)

Design the architecture so future phases can add:

* clustering
* multi-video aggregation
* cluster DNA
* style variants
* automatic blueprint optimization

But **do not implement clustering yet**.

Only ensure the architecture supports it.

---

# DELIVERY REQUIREMENTS

Return:

1. full Python code
2. README
3. example JSON outputs
4. CLI usage instructions
5. error handling
6. validation checks

Everything must be **clean, modular, and production-ready**.

---

If you'd like, I can also give you a **much stronger “Phase 0” step** that will save you weeks of work: a **Viral Style DNA schema** designed specifically for **TikTok storytelling videos**, which makes the analyzer far more accurate.
