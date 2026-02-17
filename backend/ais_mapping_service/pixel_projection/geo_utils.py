# geo_utils.py
import math

EARTH_RADIUS_M = 6371000

def haversine_distance(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(1-a))

def bearing_deg(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)

    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1)*math.sin(phi2) - math.sin(phi1)*math.cos(phi2)*math.cos(dlambda)
    brng = math.degrees(math.atan2(y, x))
    return (brng + 360) % 360

def wrap_angle_deg(angle):
    return (angle + 180) % 360 - 180
