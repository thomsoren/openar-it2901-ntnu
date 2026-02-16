# camera_config.py
from pydantic import BaseModel

class CameraConfig(BaseModel):
    image_width: int = 1920
    image_height: int = 1080
    h_fov_deg: float = 180.0
    v_fov_deg: float = 60.0
    pitch_deg: float = -1.0   # camera tilted slightly down
