# ScriptToScene Studio — Project Plan

## Project Overview

**ScriptToScene Studio** is a Flask-based SPA that converts text stories into visual video shorts through a 6-step pipeline: TTS → Timing → Segmentation → Scene Generation → Asset Grabbing → Timeline Editing.

**Goal:** Full automation — paste a story, each step executes automatically, final video is reviewed in the editor (human-in-the-loop validation).

---

## Current Architecture (6-Step Manual Pipeline)

```
 STORY TEXT
    │
    ▼
┌─────────┐   ┌─────────┐   ┌───────────┐   ┌────────┐   ┌────────┐   ┌────────┐
│  1.TTS  │──▶│2.TIMING │──▶│3.SEGMENT  │──▶│4.SCENES│──▶│5.ASSETS│──▶│6.EDITOR│
│ Kokoro  │   │ Whisper  │   │ Splitter  │   │  n8n   │   │ Automa │   │Timeline│
│         │   │         │   │           │   │ + LLM  │   │Midjourn│   │        │
└─────────┘   └─────────┘   └───────────┘   └────────┘   └────────┘   └────────┘
  audio.wav    word timings   scene breaks    AI prompts   images       final video
                                              per scene    per scene    (review)
```

Each step is **manual** — user clicks through 6 pages, picks outputs, clicks "next". That's the bottleneck.

---

## Changes & Improvements

### A. Pipeline Automation

| # | Improvement | Impact | Effort |
|---|---|---|---|
| 1 | **Pipeline Orchestrator API** — single `/api/pipeline/run` endpoint that takes story text and runs TTS → Timing → Segment → Scenes → Assets sequentially, emitting SSE progress | Eliminates all manual handoff | High |
| 2 | **Project Entity** — a single `project_id` that threads through ALL modules (currently each module generates its own ID) | Enables traceability and auto-chaining | Medium |
| 3 | **Auto-forward outputs** — TTS output auto-feeds into Timing, Timing into Segmenter, etc. without user clicking "Send to X" | Removes 5 manual transitions | Medium |
| 4 | **Pipeline Dashboard** — a new page showing the full pipeline status with step indicators (like a CI/CD pipeline view) | User sees the whole flow at a glance | Medium |

### B. TTS Module

| # | Improvement | Why |
|---|---|---|
| 5 | **Preset voice profiles** for viral content (energetic narrator, calm storyteller, dramatic voice) | Users shouldn't think about voice params — pick a "vibe" |
| 6 | **Auto-pacing** — detect story mood (horror = slower, comedy = faster) and adjust speed automatically | Better pacing without manual speed tweaking |
| 7 | **Multi-voice support** — assign different voices to dialogue vs narration | Reddit stories often have "narrator + character" voices |

### C. Timing + Segmentation

| # | Improvement | Why |
|---|---|---|
| 8 | **Merge Timing + Segmenter into one step** — alignment → segmentation should be a single click | They always run together, no reason for 2 pages |
| 9 | **Visual segment preview** with audio waveform — see where cuts land on the waveform | Users need to validate scene breaks make sense |
| 10 | **Smart segment presets** — "YouTube Shorts" (2-3s scenes, fast cuts), "Cinematic" (4-6s, slow), "Reddit Story" (2-4s) | Different content types need different rhythm |

### D. Scene Generation (n8n / LLM)

| # | Improvement | Why |
|---|---|---|
| 11 | **Remove n8n dependency** — call the LLM directly from Python (OpenAI/Anthropic SDK) | n8n adds latency, complexity, and a separate service to maintain |
| 12 | **Scene style templates** — "Dark/Horror", "Motivational", "Reddit Story", "Nature Documentary" with pre-tuned prompts | Users pick a template instead of writing prompts |
| 13 | **Prompt refinement loop** — LLM generates prompts, user can regenerate individual scenes | Not every scene prompt hits — need per-scene retry |
| 14 | **Camera direction hints** — zoom-in, pan, static — embedded in scene metadata for the editor | Adds motion variety to the final video |

### E. Assets Module

| # | Improvement | Why |
|---|---|---|
| 15 | **Replace Automa/Midjourney with direct API** — use DALL-E 3, Flux, or Stability AI API directly | Automa browser automation is fragile, slow, and breaks often |
| 16 | **Parallel image generation** — generate all scene images concurrently | Current sequential flow is slow for 15+ scenes |
| 17 | **Image variant selection** — generate 2-3 options per scene, let user pick (or auto-select best) | First generation isn't always the best |
| 18 | **Stock footage fallback** — Pexels/Pixabay API for scenes where AI images don't fit | Some scenes work better with real footage |

### F. Editor / Final Output

| # | Improvement | Why |
|---|---|---|
| 19 | **Auto-assemble timeline** — when pipeline finishes, auto-place all clips on timeline with transitions | The editor should open with a ready-to-review video, not an empty timeline |
| 20 | **Ken Burns effect** — auto-apply subtle zoom/pan to static images | Static images look amateurish in shorts |
| 21 | **Auto-captions** — word-level captions synced to audio (you already have the timing data!) | Captions are essential for viral shorts |
| 22 | **One-click export** — preset export profiles: "YouTube Shorts" (9:16, 1080x1920), "TikTok", "Reels" | Eliminate manual export config |
| 23 | **Background music layer** — auto-add royalty-free background music with ducking | Music dramatically improves engagement |
| 24 | **Transition presets** — auto-apply scene transitions (crossfade, zoom, etc.) based on content type | Manual transition placement is tedious |

### G. Architecture / Infrastructure

| # | Improvement | Why |
|---|---|---|
| 25 | **Unified project model** — one project ID, one folder, all outputs together | Currently scattered across `output/tts/`, `output/scenes/`, `output/assets/` etc. |
| 26 | **SQLite or TinyDB** instead of JSON files | Faster queries, history management, search |
| 27 | **Job queue** (Celery or simple threading queue) | Pipeline steps can queue and retry properly |
| 28 | **WebSocket for real-time updates** instead of SSE polling | More reliable, bidirectional communication |

---

## Priority Roadmap

### Phase 1: Foundation
- [ ] Unified project ID (#2)
- [ ] Merge timing + segmenter (#8)
- [ ] Auto-forward between steps (#3)
- [ ] Pipeline orchestrator API (#1)

### Phase 2: Direct APIs
- [ ] Direct LLM calls (#11)
- [ ] Direct image API (#15)
- [ ] Parallel image gen (#16)
- [ ] Scene style templates (#12)

### Phase 3: Smart Assembly
- [ ] Auto-assemble timeline (#19)
- [ ] Ken Burns / motion (#20)
- [ ] Transition presets (#24)
- [ ] Pipeline dashboard (#4)


### Phase 4: Polish
- [ ] Auto-captions (#21)
- [ ] Background music (#23)
- [ ] Multi-voice (#7)
- [ ] One-click export (#22)

---

## Dual-Mode UX: Projects Hub

### Entry Point — New "Projects" Page

When opening the app or starting a new project, a **Projects** page acts as the hub with two paths:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                    New Project                                   │
│                                                                  │
│  ┌───────────────────────┐    ┌───────────────────────┐         │
│  │                       │    │                       │         │
│  │   ⚡ Auto Pipeline    │    │   🎛️ Manual Studio    │         │
│  │                       │    │                       │         │
│  │  Paste your story,    │    │  Full control over    │         │
│  │  pick a preset,       │    │  each step. Tweak     │         │
│  │  get a video.         │    │  voice, timing,       │         │
│  │                       │    │  prompts, assets.     │         │
│  │  Best for:            │    │                       │         │
│  │  • Quick drafts       │    │  Best for:            │         │
│  │  • Batch content      │    │  • Fine-tuning        │         │
│  │  • Testing ideas      │    │  • Custom voices      │         │
│  │                       │    │  • Complex stories    │         │
│  └───────────────────────┘    └───────────────────────┘         │
│                                                                  │
│  Recent Projects:                                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 📁 The Lost Treasure    ⚡auto   3 min ago    [Resume]     │ │
│  │ 📁 Horror Story #4      🎛️manual  2 hrs ago   [Resume]     │ │
│  │ 📁 Reddit AITA          ⚡auto   yesterday    [Resume]     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Auto Pipeline Path

```
┌─────────────────────────────────────────────────────────────┐
│  ⚡ Auto Pipeline                                           │
│                                                             │
│  Story:                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Paste your story here...                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Preset:                                                    │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌─────────┐ │
│  │ Reddit     │ │ Horror     │ │ Motivation │ │ Custom  │ │
│  │ Story      │ │ /Dark      │ │ /Inspire   │ │         │ │
│  └────────────┘ └────────────┘ └────────────┘ └─────────┘ │
│                                                             │
│  Each preset bundles: voice, speed, scene style,            │
│  segment rhythm, image style                                │
│                                                             │
│                              [▶ Generate Video]             │
│                                                             │
│  💡 You can switch to Manual mode at any step               │
│     to fine-tune before continuing.                         │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline Dashboard (during auto run)

```
┌──────────────────────────────────────────────────────────────────┐
│  Pipeline: "The Lost Treasure"                          ⏱ 2:34  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ TTS ──▶ ✅ Timing ──▶ ✅ Segment ──▶ 🔄 Scenes ──▶ ⏳ Assets ──▶ ⏳ Editor │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Step 4/6: Generating Scenes                                │ │
│  │ ████████████████░░░░░░░░░░░░░░░░  8/15 scenes              │ │
│  │                                                             │ │
│  │  Scene 8: "A dimly lit corridor with ancient symbols..."    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Step Log:                                                       │
│  ✅ TTS      — 24.3s audio, voice: af_heart, 156 words          │
│  ✅ Timing   — 156 words aligned in 1.8s                        │
│  ✅ Segment  — 15 scenes (avg 1.9s each)                        │
│  🔄 Scenes   — 8/15 prompts generated...                        │
│  ⏳ Assets   — waiting                                           │
│  ⏳ Editor   — waiting                                           │
│                                                                  │
│                                          [Pause]  [Cancel]       │
└──────────────────────────────────────────────────────────────────┘
```

### Switch Between Modes Anytime

The pipeline never locks you in. At any step:

```
Auto running...
  ✅ TTS ──▶ ✅ Timing ──▶ 🔄 Segment ──▶ ⏳ Scenes ──▶ ⏳ Assets
                              │
                              ├── [⏸ Pause & Edit] → Opens that module's
                              │    page with this project's data loaded.
                              │    When done → [▶ Resume Pipeline]
                              │
                              └── [▶ Continue] (auto)
```

| Action | What happens |
|---|---|
| **Auto all the way** | Paste → preset → wait → review in editor |
| **Auto then manual** | Pipeline runs, pause at any step, tweak, resume or go fully manual |
| **Manual all the way** | Current flow — click through each page yourself |
| **Manual then auto** | Do TTS manually, then hit "Auto-complete remaining steps" |

### Sidebar Update

The sidebar gains a **Projects** item at the top:

```
 ┌──────────────┐
 │ 🎬 Projects  │  ← NEW: start screen / project picker
 │──────────────│
 │ 🎤 TTS       │
 │ ⏱ Timing     │
 │ ✂ Segmenter  │
 │ 🎬 Scenes    │
 │ 🖼 Assets    │
 │ 🎞 Editor    │
 │ ⚙ Settings   │
 └──────────────┘
```

The **Projects** page is the hub — new projects, recent history, resume any project in either mode. The other 6 pages stay exactly as they are for manual mode.

---

## Automated Vision (Post Phase 3)

```
PASTE STORY → [auto TTS → auto align → auto segment → auto scenes → auto images → auto assemble]
                                                                                        │
                                                                                        ▼
                                                                              EDITOR (human review)
                                                                                        │
                                                                                        ▼
                                                                                  EXPORT VIDEO
```

The two biggest wins for eliminating manual work are **#1 (pipeline orchestrator)** and **#15 (direct image API replacing Automa)**. Those two changes alone turn 15 minutes of clicking into one paste + wait + review.
