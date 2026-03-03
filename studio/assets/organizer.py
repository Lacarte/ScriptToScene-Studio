"""Asset Organizer — Download and organize generated images into project folders.

Directory structure (grabber mode):
  output/assets/{project_id}/
    {scene_num}/
      0.png
      1.png
      ...
    metadata.json
"""

import base64
import json
import os
import time
from urllib.parse import urlparse

import requests as http_requests
from loguru import logger

# Midjourney CDN blocks bare requests — mimic a real browser
_DL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.midjourney.com/",
}

MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds


def organize_grabber_assets(project_id, scene_num, urls, assets_dir):
    """Download all image/video URLs for a scene into its subfolder.

    Returns list of local URL paths (e.g. ['/output/assets/proj/1/0.png']).
    """
    scene_dir = os.path.join(assets_dir, project_id, str(scene_num))
    os.makedirs(scene_dir, exist_ok=True)

    local_files = []
    for i, url in enumerate(urls):
        filepath = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = http_requests.get(
                    url, headers=_DL_HEADERS, timeout=120, stream=True,
                )
                resp.raise_for_status()

                ext = _detect_ext(url, resp.headers.get("Content-Type", ""))
                filename = f"{i}{ext}"
                filepath = os.path.join(scene_dir, filename)

                with open(filepath, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=65536):
                        f.write(chunk)

                local_url = f"/output/assets/{project_id}/{scene_num}/{filename}"
                local_files.append(local_url)
                size_kb = os.path.getsize(filepath) / 1024
                logger.info(
                    "Scene {}/{} downloaded ({:.0f} KB): {}",
                    scene_num, filename, size_kb, _truncate(url, 80),
                )
                break  # success
            except Exception as e:
                logger.warning(
                    "Download attempt {}/{} failed for scene {}, file {}: {}",
                    attempt, MAX_RETRIES, scene_num, i, e,
                )
                if filepath and os.path.isfile(filepath):
                    os.remove(filepath)  # clean up partial file
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY * attempt)
                else:
                    logger.error("Gave up downloading scene {}, file {}: {}", scene_num, i, _truncate(url, 60))

    # Update metadata
    _update_project_metadata(assets_dir, project_id, scene_num, urls, local_files)

    return local_files


def save_base64_assets(project_id, scene_num, images, assets_dir):
    """Save base64-encoded image data for a scene.

    Args:
        images: list of dicts with 'data' (base64 string) and optional 'ext' (e.g. '.png').
                The 'data' may include a data URI prefix like 'data:image/png;base64,...'

    Returns list of local URL paths.
    """
    scene_dir = os.path.join(assets_dir, project_id, str(scene_num))
    os.makedirs(scene_dir, exist_ok=True)

    local_files = []
    source_urls = []

    for i, img in enumerate(images):
        raw = img.get("data", "")
        if not raw:
            continue

        # Strip data URI prefix if present
        ext = img.get("ext", ".png")
        if raw.startswith("data:"):
            # data:image/png;base64,iVBOR...
            header, raw = raw.split(",", 1)
            mime = header.split(":")[1].split(";")[0] if ":" in header else ""
            ext = _ext_from_mime(mime) or ext

        try:
            data = base64.b64decode(raw)
        except Exception as e:
            logger.error("Invalid base64 for scene {}, image {}: {}", scene_num, i, e)
            continue

        filename = f"{i}{ext}"
        filepath = os.path.join(scene_dir, filename)
        with open(filepath, "wb") as f:
            f.write(data)

        local_url = f"/output/assets/{project_id}/{scene_num}/{filename}"
        local_files.append(local_url)
        source_urls.append(img.get("source_url", f"base64:{i}"))
        size_kb = len(data) / 1024
        logger.info("Scene {}/{} saved ({:.0f} KB)", scene_num, filename, size_kb)

    _update_project_metadata(assets_dir, project_id, scene_num, source_urls, local_files)
    return local_files


def _ext_from_mime(mime):
    """Convert MIME type to file extension."""
    m = {
        "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
        "image/gif": ".gif", "video/mp4": ".mp4",
    }
    return m.get(mime, "")


def _detect_ext(url, content_type):
    """Detect file extension from URL path or Content-Type header."""
    # Try URL path first (strip query params)
    path = urlparse(url).path.lower()
    for ext in (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".gif"):
        if ext in path:
            return ext if ext != ".jpeg" else ".jpg"

    # Fall back to content-type
    ct = content_type.lower()
    if "mp4" in ct or "video" in ct:
        return ".mp4"
    if "jpeg" in ct or "jpg" in ct:
        return ".jpg"
    if "webp" in ct:
        return ".webp"
    if "gif" in ct:
        return ".gif"
    return ".png"


def _truncate(s, n):
    return s if len(s) <= n else s[:n] + "..."


def _update_project_metadata(assets_dir, project_id, scene_num, source_urls, local_files):
    """Update the project metadata.json with scene download info."""
    project_dir = os.path.join(assets_dir, project_id)
    meta_path = os.path.join(project_dir, "metadata.json")

    meta = {}
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            meta = {}

    if "scenes" not in meta:
        meta["scenes"] = {}

    meta["scenes"][str(scene_num)] = {
        "scene": scene_num,
        "source_urls": source_urls,
        "local_files": local_files,
        "file_count": len(local_files),
    }

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
