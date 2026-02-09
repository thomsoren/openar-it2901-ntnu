import os
import aiohttp
import asyncio
import json
import math
from dotenv import load_dotenv

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
        AIS data objects from the stream
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
