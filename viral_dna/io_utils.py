"""viral_dna.io_utils — File I/O helpers for JSON loading/saving."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from loguru import logger


def load_json(path: str | Path) -> dict[str, Any]:
    """Load a JSON file and return its contents as a dict."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"JSON file not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(data: Any, path: str | Path, indent: int = 2) -> Path:
    """Save data as JSON. Creates parent directories if needed."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent, ensure_ascii=False, default=str)
    logger.debug("Saved JSON: {}", path)
    return path


def find_file(folder: str | Path, *names: str) -> Path | None:
    """Find the first file matching any of the given names in a folder."""
    folder = Path(folder)
    for name in names:
        candidate = folder / name
        if candidate.is_file():
            return candidate
    # Try glob patterns
    for name in names:
        matches = list(folder.glob(name))
        if matches:
            return matches[0]
    return None


def find_video(folder: str | Path) -> Path | None:
    """Find a video file in the folder."""
    return find_file(folder, "video.mp4", "*.mp4", "*.mov", "*.avi", "*.webm")


def find_audio(folder: str | Path) -> Path | None:
    """Find an audio file in the folder (or None if video-only)."""
    return find_file(folder, "audio.mp3", "audio.wav", "*.mp3", "*.wav")


def find_alignment(folder: str | Path) -> Path | None:
    """Find alignment.json in the folder."""
    return find_file(folder, "alignment.json")


def find_transcript(folder: str | Path) -> Path | None:
    """Find transcript text in the folder."""
    return find_file(folder, "text.txt", "transcript.txt", "*.txt")


def list_niche_folders(base_dir: str | Path) -> list[dict]:
    """List all niche input folders with their available files."""
    base = Path(base_dir)
    if not base.is_dir():
        return []
    niches = []
    for entry in sorted(base.iterdir()):
        if not entry.is_dir():
            continue
        info = {
            "name": entry.name,
            "path": str(entry),
            "has_video": find_video(entry) is not None,
            "has_audio": find_audio(entry) is not None,
            "has_alignment": find_alignment(entry) is not None,
            "has_transcript": find_transcript(entry) is not None,
        }
        niches.append(info)
    return niches
