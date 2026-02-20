# projection.py
import math
from .geo_utils import bearing_deg, haversine_distance, wrap_angle_deg

def project_ais_to_pixel(
    ship_lat, ship_lon, ship_heading,
    target_lat, target_lon,
    cam_cfg
):
    dist_m = haversine_distance(ship_lat, ship_lon, target_lat, target_lon)
    bearing = bearing_deg(ship_lat, ship_lon, target_lat, target_lon)
    rel_bearing = wrap_angle_deg(bearing - ship_heading)

    if abs(rel_bearing) > cam_cfg.h_fov_deg / 2:
        return None  # outside FOV

    x_norm = (rel_bearing / cam_cfg.h_fov_deg) + 0.5
    x_px = int(x_norm * cam_cfg.image_width)
    

    # Fake vertical placement: closer boats appear lower
    horizon_y = cam_cfg.image_height * 0.4
    y_px = int(horizon_y + min(300, 10000 / max(dist_m, 1)))

    return {
        "x_px": x_px,
        "y_px": y_px,
        "distance_m": dist_m,
        "bearing_deg": bearing,
        "rel_bearing_deg": rel_bearing
    }
