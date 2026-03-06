"""viral_dna.builders.niche — Build niche-level DNA from individual profiles.

Currently supports single-video niche (1:1 passthrough).
Architected for future multi-video aggregation (median/mean across profiles).
"""

from __future__ import annotations

from loguru import logger

from viral_dna.schemas import DNAProfile, NicheDNA


def build_niche(
    niche_name: str,
    profiles: list[tuple[str, DNAProfile]],
) -> NicheDNA:
    """Build niche DNA from one or more video profiles.

    Args:
        niche_name: Name of the niche (e.g. "stoic_motivation")
        profiles: List of (video_id, DNAProfile) tuples

    Returns:
        NicheDNA with aggregated profile
    """
    if not profiles:
        logger.warning("No profiles provided for niche '{}'", niche_name)
        return NicheDNA(niche=niche_name)

    # For now: single-video passthrough
    video_id, profile = profiles[0]

    if len(profiles) == 1:
        confidence = "low"
        logger.info("Building niche DNA for '{}' from 1 video (confidence: low)", niche_name)
    else:
        # Future: aggregate across multiple profiles
        # For now just use the first one and warn
        confidence = "medium" if len(profiles) >= 3 else "low"
        logger.info("Building niche DNA for '{}' from {} videos (using first, confidence: {})",
                     niche_name, len(profiles), confidence)

    return NicheDNA(
        niche=niche_name,
        reference_video=video_id,
        video_count=len(profiles),
        confidence=confidence,
        profile=profile,
    )
