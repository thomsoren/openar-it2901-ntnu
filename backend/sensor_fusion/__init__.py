"""Sensor fusion: matches RT-DETR detections with AIS projection data."""
from sensor_fusion.ais_store import AISStore
from sensor_fusion.matcher import match_detections_to_ais
from sensor_fusion.service import SensorFusionService

__all__ = ["AISStore", "match_detections_to_ais", "SensorFusionService"]
