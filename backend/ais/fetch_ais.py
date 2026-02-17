import os
import aiohttp
import asyncio
import json
import math
from dotenv import load_dotenv
from ais_mapping_service.pixel_projection.projection import project_ais_to_pixel
from ais_mapping_service.pixel_projection.camera_config import CameraConfig

load_dotenv()

AIS_CLIENT_ID = os.getenv("AIS_CLIENT_ID", "").strip()
AIS_CLIENT_SECRET = os.getenv("AIS_CLIENT_SECRET", "").strip()
AIS_TOKEN_URL = "https://id.barentswatch.no/connect/token"
AIS_SCOPE = "ais"

async def _fetch_token(session: aiohttp.ClientSession) -> str:
  if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
    raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET is missing")

  payload = {
    "client_id": AIS_CLIENT_ID,
    "client_secret": AIS_CLIENT_SECRET,
    "grant_type": "client_credentials",
    "scope": AIS_SCOPE,
  }

  async with session.post(AIS_TOKEN_URL, data=payload) as response:
    if response.status != 200:
      detail = await response.text()
      raise ValueError(f"Token request failed ({response.status}): {detail}")
    data = await response.json()
    token = data.get("access_token")
    if not token:
      raise ValueError("Token response missing access_token")
    return token

# Fetch AIS data with automatic API key refresh
async def fetch_ais():
  if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
      print("Error: AIS_CLIENT_ID or AIS_CLIENT_SECRET not set in environment. Make sure it matches .env.example")
      return
  
  async with aiohttp.ClientSession() as session:
    token = await _fetch_token(session)
    async with session.get(
      "https://historic.ais.barentswatch.no/v1/historic/trackslast24hours/257111020",
      headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
      }
    ) as response:
      
      if response.status != 200:
        raise ValueError(f"HTTP error {response.status}")
      
      return await response.json()


async def fetch_vessel_position_by_mmsi(mmsi: str) -> dict | None:
    """
    Fetch a specific vessel's latest position and heading from Barentswatch API.
    
    Args:
        mmsi: Maritime Mobile Service Identity (vessel ID)
    
    Returns:
        Dictionary with keys: latitude, longitude, trueHeading
        Returns None if vessel not found
    """
    if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
        raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET not set")
    
    try:
        async with aiohttp.ClientSession() as session:
            token = await _fetch_token(session)
            async with session.get(
                f"https://historic.ais.barentswatch.no/v1/historic/trackslast24hours/{mmsi}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json"
                }
            ) as response:
                if response.status == 404:
                    return None
                if response.status != 200:
                    error_text = await response.text()
                    raise ValueError(f"HTTP {response.status}: {error_text}")
                
                data = await response.json()
                if not data or "features" not in data:
                    return None
                
                # Get the last (most recent) position from the track
                features = data.get("features", [])
                if not features:
                    return None
                
                latest = features[-1]
                props = latest.get("properties", {})
                geometry = latest.get("geometry", {})
                coords = geometry.get("coordinates", [])
                
                if not coords or len(coords) < 2:
                    return None
                
                return {
                    "longitude": coords[0],
                    "latitude": coords[1],
                    "trueHeading": props.get("trueHeading", 0)
                }
    except Exception as e:
        raise ValueError(f"Error fetching vessel {mmsi} from Barentswatch: {type(e).__name__}: {str(e)}")

async def fetch_ais_stream_geojson(
    timeout: int = 120,
    ship_lat: float = None,
    ship_lon: float = None,
    heading: float = 0,
    offset_meters: float = 1000,
    fov_degrees: float = 60
):
    """
    Fetch AIS data stream in a triangular field of view from ship's position.
    
    Args:
        timeout: Connection timeout in seconds
        ship_lat: Ship latitude (default: Trondheim harbor)
        ship_lon: Ship longitude (default: Trondheim harbor)
        heading: Ship heading in degrees (0 = North, 90 = East)
        offset_meters: Distance from ship to triangle base in meters
        fov_degrees: Field of view angle in degrees
    
    Yields:
        AIS data objects from the stream.
        
        Example:
            {
                'courseOverGround': 223.4,
                'latitude': 63.439218,
                'longitude': 10.398735,
                'name': 'OCEAN SPACE DRONE1',
                'rateOfTurn': -6,
                'shipType': 99,
                'speedOverGround': 0.1,
                'trueHeading': 138,
                'navigationalStatus': 0,
                'mmsi': 257030830,
                'msgtime': '2026-02-17T14:13:04+00:00',
                'stream': 'terra'
            }
    """
    if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
        raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET not set")

    # Default to Trondheim harbor
    if ship_lat is None or ship_lon is None:
        ship_lat, ship_lon = 63.4365, 10.3835

    # Calculate triangle coordinates for FOV
    half_fov = fov_degrees / 2
    
    # Convert offset to degrees (approximate)
    meters_per_degree_lat = 111320
    meters_per_degree_lon = 111320 * math.cos(math.radians(ship_lat))
    
    offset_lat = offset_meters / meters_per_degree_lat
    offset_lon = offset_meters / meters_per_degree_lon
    
    # Calculate left and right points
    left_angle = heading - half_fov
    right_angle = heading + half_fov
    
    left_lat = ship_lat + offset_lat * math.cos(math.radians(left_angle))
    left_lon = ship_lon + offset_lon * math.sin(math.radians(left_angle))
    
    right_lat = ship_lat + offset_lat * math.cos(math.radians(right_angle))
    right_lon = ship_lon + offset_lon * math.sin(math.radians(right_angle))
    
    # Triangle: ship position + left point + right point + close triangle
    coordinates = [
        [ship_lon, ship_lat],
        [left_lon, left_lat],
        [right_lon, right_lat],
        [ship_lon, ship_lat]
    ]

    request_body = {
        "modelType": "Simple",
        "modelFormat": "Json",
        "geometry": {"type": "Polygon", "coordinates": [coordinates]},
        "downsample": True
    }

    timeout_cfg = aiohttp.ClientTimeout(total=None, sock_read=timeout)

    try:
        async with aiohttp.ClientSession(timeout=timeout_cfg) as session:
            token = await _fetch_token(session)
            
            for attempt in range(2):
                async with session.post(
                    "https://live.ais.barentswatch.no/live/v1/combined",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=request_body
                ) as response:
                    if response.status == 401 and attempt == 0:
                        token = await _fetch_token(session)
                        continue
                    if response.status != 200:
                        error_text = await response.text()
                        raise ValueError(f"HTTP {response.status}: {error_text}")

                    async for line in response.content:
                        line = line.decode("utf-8").strip()
                        if line:
                            try:
                                data = json.loads(line)
                                yield data
                            except json.JSONDecodeError:
                                continue
                    return
    except Exception as e:
        raise ValueError(f"Stream error in fetch_ais_stream_geojson: {type(e).__name__}: {str(e)}")

async def fetch_ais_stream_projections(
    ship_lat: float,
    ship_lon: float,
    heading: float,
    offset_meters: float,
    fov_degrees: float
):
    """
    Fetch AIS data stream and project vessel positions to camera pixel coordinates.
    Offset and FOV define the area around the ship to fetch AIS data from.
    
    Args:
        ship_lat: Observer latitude
        ship_lon: Observer longitude
        heading: Observer heading in degrees
        offset_meters: How far from the observer to fetch AIS data (in meters)
        fov_degrees: Field of view angle in degrees
    
    Yields:
        AIS features enriched with projection field containing pixel coordinates
    """
    
    cam_cfg = CameraConfig(h_fov_deg=fov_degrees)
    
    async for feature in fetch_ais_stream_geojson(
        ship_lat=ship_lat,
        ship_lon=ship_lon,
        heading=heading,
        offset_meters=offset_meters,
        fov_degrees=fov_degrees
    ):
        # Extract coordinates from top-level latitude/longitude keys
        lat = feature.get("latitude")
        lon = feature.get("longitude")

        projection = None
        if lat is not None and lon is not None:
            projection = project_ais_to_pixel(
                ship_lat=ship_lat,
                ship_lon=ship_lon,
                ship_heading=heading,
                target_lat=lat,
                target_lon=lon,
                cam_cfg=cam_cfg
            )

        # Enrich feature with projection (or null if outside FOV)
        feature["projection"] = projection
        yield feature



async def fetch_ais_stream_projections_by_mmsi(
    mmsi: str,
    offset_meters: float = 3000,
    fov_degrees: float = 120
):
    """
    Fetch a specific vessel by MMSI, then stream AIS data of nearby vessels
    within that vessel's field of view, enriched with camera pixel projections.
    
    Args:
        mmsi: Maritime Mobile Service Identity (vessel ID)
        offset_meters: Distance to triangle base in meters
        fov_degrees: Field of view angle in degrees
    
    Yields:
        AIS features enriched with projection field containing pixel coordinates
        
    Raises:
        ValueError: If vessel with MMSI not found
    """
    from ais_mapping_service.pixel_projection.projection import project_ais_to_pixel
    from ais_mapping_service.pixel_projection.camera_config import CameraConfig
    
    # Fetch vessel position and heading by MMSI
    vessel_info = await fetch_vessel_position_by_mmsi(mmsi)
    if not vessel_info:
        raise ValueError(f"Vessel with MMSI {mmsi} not found in Barentswatch AIS data")
    
    ship_lat = vessel_info["latitude"]
    ship_lon = vessel_info["longitude"]
    heading = vessel_info["trueHeading"]
    
    cam_cfg = CameraConfig(h_fov_deg=fov_degrees)
    
    async for feature in fetch_ais_stream_geojson(
        ship_lat=ship_lat,
        ship_lon=ship_lon,
        heading=heading,
        offset_meters=offset_meters,
        fov_degrees=fov_degrees
    ):
        # Extract coordinates from top-level latitude/longitude keys
        lat = feature.get("latitude")
        lon = feature.get("longitude")

        projection = None
        if lat is not None and lon is not None:
            projection = project_ais_to_pixel(
                ship_lat=ship_lat,
                ship_lon=ship_lon,
                ship_heading=heading,
                target_lat=lat,
                target_lon=lon,
                cam_cfg=cam_cfg
            )

        # Enrich feature with projection (or null if outside FOV)
        feature["projection"] = projection
        yield feature


def main():
    if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
      print("Warning: AIS_CLIENT_ID or AIS_CLIENT_SECRET not set in environment")
      return
    try:
      ais_data = asyncio.run(fetch_ais())
      with open("ais_data.json", "w") as f:
        json.dump(ais_data, f, indent=2)
      print("AIS data fetched and saved to ais_data.json")
    except Exception as e:
      print(f"\nError fetching AIS data: {e}")

if __name__ == "__main__":
    main()
