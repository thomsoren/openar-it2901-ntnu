# projection.py
from __future__ import annotations

from typing import Any

from .geo_utils import bearing_deg, haversine_distance, wrap_angle_deg

HORIZON_Y_RATIO = 0.4  # fraction of image height where horizon sits
MAX_Y_OFFSET_PX = 300  # maximum vertical pixel offset for projected vessels
DISTANCE_SCALE_FACTOR = 10000  # scaling factor for distance-to-pixel conversion


def project_ais_to_pixel(
    ship_lat: float,
    ship_lon: float,
    ship_heading: float,
    target_lat: float,
    target_lon: float,
    cam_cfg: Any,
) -> dict[str, float] | None:
    dist_m = haversine_distance(ship_lat, ship_lon, target_lat, target_lon)
    bearing = bearing_deg(ship_lat, ship_lon, target_lat, target_lon)
    rel_bearing = wrap_angle_deg(bearing - ship_heading)

    if abs(rel_bearing) > cam_cfg.h_fov_deg / 2:
        return None  # outside FOV

    x_norm = (rel_bearing / cam_cfg.h_fov_deg) + 0.5
    x_px = int(x_norm * cam_cfg.image_width)

    # Vertical placement: closer boats appear lower on screen
    horizon_y = cam_cfg.image_height * HORIZON_Y_RATIO
    y_px = int(horizon_y + min(MAX_Y_OFFSET_PX, DISTANCE_SCALE_FACTOR / max(dist_m, 1)))

    return {
        "x_px": x_px,
        "y_px": y_px,
        "distance_m": dist_m,
        "bearing_deg": bearing,
        "rel_bearing_deg": rel_bearing
    }
