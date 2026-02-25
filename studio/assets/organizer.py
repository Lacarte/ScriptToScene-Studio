"""Asset Organizer — Download and organize generated images into project folders.

Directory structure:
  output/assets/{project_id}/
    scene_{id}.png
    scene_{id}_thumb.png   (optional thumbnail)
    metadata.json          (tracks generation info per scene)
"""

import json
import os

import requests as http_requests
from loguru import logger


def organize_asset(image_url, project_id, scene_id, assets_dir):
    """Download an image from a URL and save it into the organized project folder.

    Returns the local URL path for serving the image (e.g. /output/assets/proj/scene_1.png).
    """
    project_dir = os.path.join(assets_dir, project_id)
    os.makedirs(project_dir, exist_ok=True)

    # Download image
    img_resp = http_requests.get(image_url, timeout=60)
    img_resp.raise_for_status()

    # Determine extension from content type or default to .png
    content_type = img_resp.headers.get("Content-Type", "")
    ext = ".png"
    if "jpeg" in content_type or "jpg" in content_type:
        ext = ".jpg"
    elif "webp" in content_type:
        ext = ".webp"

    filename = f"scene_{scene_id}{ext}"
    img_path = os.path.join(project_dir, filename)

    with open(img_path, "wb") as f:
        f.write(img_resp.content)

    # Update metadata
    _update_metadata(project_dir, scene_id, {
        "scene_id": scene_id,
        "filename": filename,
        "source_url": image_url,
        "size_bytes": len(img_resp.content),
    })

    local_url = f"/output/assets/{project_id}/{filename}"
    logger.info("Organized asset: scene {} -> {}", scene_id, img_path)
    return local_url


def _update_metadata(project_dir, scene_id, entry):
    """Append or update scene entry in the project metadata.json."""
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

    meta["scenes"][str(scene_id)] = entry

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)


def list_project_assets(project_id, assets_dir):
    """List all organized assets for a project."""
    project_dir = os.path.join(assets_dir, project_id)
    meta_path = os.path.join(project_dir, "metadata.json")
    if not os.path.isfile(meta_path):
        return []
    try:
        with open(meta_path) as f:
            meta = json.load(f)
        return list(meta.get("scenes", {}).values())
    except (json.JSONDecodeError, OSError):
        return []
