"""
Matcher — nearest-neighbour fusion of RT-DETR detections and AIS records.

Each AIS record from the snapshot may carry a pre-computed `projection`
dict (x_px, y_px) produced by project_ais_to_pixel.  The matcher uses
those pixel coordinates to find the closest unmatched detection.

Algorithm: greedy nearest-neighbour in pixel space.
    1. For each AIS record, compute pixel distance to every detection.
    2. Sort (ais, detection) pairs by distance ascending.
    3. Greedily assign the closest pair; mark both as used.
    4. Unmatched detections → DetectedVessel(vessel=None).
    5. AIS records with no detection match → DetectedVessel(detection=None)
       only when include_unmatched_ais=True.

A match is only accepted when the pixel distance is ≤ MAX_MATCH_DISTANCE_PX.
"""
from __future__ import annotations

import logging
import math
from typing import Any

from common.config import FUSION_MAX_MATCH_PX as MAX_MATCH_DISTANCE_PX
from common.types import Detection, DetectedVessel, Vessel

logger = logging.getLogger(__name__)



def _pixel_distance(det: Detection, proj: dict[str, Any]) -> float:
    """Euclidean pixel distance between a detection centre and an AIS projection."""
    dx = det.x - proj["x_px"]
    dy = det.y - proj["y_px"]
    return math.hypot(dx, dy)


def _record_to_vessel(record: dict[str, Any]) -> Vessel:
    speed = record.get("speedOverGround", -1)
    heading = record.get("trueHeading", -1)
    return Vessel(
        mmsi=str(record.get("mmsi", "")),
        name=record.get("name"),
        ship_type=str(record.get("shipType")) if record.get("shipType") is not None else None,
        speed=speed if speed >= 0 else None,
        heading=heading if heading >= 0 else None,
        latitude=record.get("latitude"),
        longitude=record.get("longitude"),
    )


def match_detections_to_ais(
    detections: list[dict[str, Any]],
    ais_snapshot: list[dict[str, Any]],
    include_unmatched_ais: bool = False,
    max_distance_px: float = MAX_MATCH_DISTANCE_PX,
) -> list[dict[str, Any]]:
    """
    Fuse a list of detection dicts with a list of AIS record dicts.

    Args:
        detections: List of detection dicts from the inference payload
                    (each has `x`, `y`, `width`, `height`, `confidence`, etc.)
        ais_snapshot: List of AIS record dicts with a `projection` key
                      containing at least `x_px` and `y_px`.
        include_unmatched_ais: If True, AIS records with no detection match
                               are included as vessels with detection=None.
        max_distance_px: Maximum pixel distance to accept a match.

    Returns:
        List of fused vessel dicts ready for the Redis payload, each with
        `detection` and `vessel` keys.
    """
    # Only AIS records with a valid projection can be matched
    projectable = [r for r in ais_snapshot if r.get("projection")]

    # Parse detections into Detection objects for easier maths
    parsed_dets: list[Detection] = []
    for d in detections:
        det_data = d.get("detection", d)  # support both raw and wrapped dicts
        try:
            parsed_dets.append(Detection(**det_data))
        except Exception as exc:
            logger.warning("[matcher] Skipping malformed detection: %s", exc)

    if not projectable or not parsed_dets:
        # No AIS or no detections — return detections unmatched
        result = [{"detection": d.model_dump(), "vessel": None} for d in parsed_dets]
        if include_unmatched_ais:
            for rec in projectable:
                result.append({"detection": None, "vessel": _record_to_vessel(rec).model_dump()})
        return result

    # Build all (distance, ais_idx, det_idx) pairs
    pairs: list[tuple[float, int, int]] = []
    for ai, rec in enumerate(projectable):
        proj = rec["projection"]
        for di, det in enumerate(parsed_dets):
            dist = _pixel_distance(det, proj)
            if dist <= max_distance_px:
                pairs.append((dist, ai, di))

    pairs.sort(key=lambda p: p[0])

    matched_ais: set[int] = set()
    matched_det: set[int] = set()
    fused: list[dict[str, Any]] = []

    for dist, ai, di in pairs:
        if ai in matched_ais or di in matched_det:
            continue
        matched_ais.add(ai)
        matched_det.add(di)
        vessel = _record_to_vessel(projectable[ai])
        projection = projectable[ai].get("projection") or {}
        fused.append({
            "detection": parsed_dets[di].model_dump(),
            "vessel": vessel.model_dump(),
            "match_distance_px": round(dist, 1),
            "fusion": {
                "match_distance_px": round(dist, 1),
                "range_m": projection.get("distance_m"),
                "rel_bearing_deg": projection.get("rel_bearing_deg"),
            },
        })
        logger.debug(
            "[matcher] Matched MMSI %s to detection at (%.0f,%.0f) dist=%.1fpx",
            vessel.mmsi, parsed_dets[di].x, parsed_dets[di].y, dist,
        )

    # Unmatched detections
    for di, det in enumerate(parsed_dets):
        if di not in matched_det:
            fused.append({"detection": det.model_dump(), "vessel": None, "match_distance_px": None})

    # Optionally include unmatched AIS
    if include_unmatched_ais:
        for ai, rec in enumerate(projectable):
            if ai not in matched_ais:
                fused.append({
                    "detection": None,
                    "vessel": _record_to_vessel(rec).model_dump(),
                    "match_distance_px": None,
                })

    return fused
