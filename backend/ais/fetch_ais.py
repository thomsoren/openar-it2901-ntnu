import os
import json
import aiohttp
import math

API_KEY = os.getenv("AIS_API_KEY")
print(f"API_KEY loaded: {API_KEY[:50] if API_KEY else 'None'}...")

async def fetch_ais():
  async with aiohttp.ClientSession() as session:
    async with session.get(
      "https://historic.ais.barentswatch.no/v1/historic/trackslast24hours/257111020",
      headers={
        "Authorization": f"Bearer {API_KEY}",
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
    if not API_KEY:
        raise ValueError("AIS_API_KEY not set")

    # Default to Trondheim harbor
    if ship_lat is None or ship_lon is None:
        ship_lat, ship_lon = 63.4365, 10.3835

    # Calculate triangle coordinates
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
    print(coordinates)

    request_body = {
        "modelType": "Simple",
        "modelFormat": "Json",
        "geometry": {"type": "Polygon", "coordinates": [coordinates]},
        "downsample": True
    }

    timeout_cfg = aiohttp.ClientTimeout(total=None, sock_read=120)

    try:
        async with aiohttp.ClientSession(timeout=timeout_cfg) as session:
            async with session.post(
                "https://live.ais.barentswatch.no/live/v1/combined",
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                json=request_body
            ) as response:
                print(f"API Response status: {response.status}")
                if response.status != 200:
                    error_text = await response.text()
                    print(f"API Error: {error_text}")
                    raise ValueError(f"HTTP {response.status}: {error_text}")

                async for line in response.content:
                    line = line.decode("utf-8").strip()
                    if line:
                        try:
                            data = json.loads(line)
                            print(f"Raw data from BarentsWatch: {json.dumps(data, indent=2)[:500]}")
                            yield data
                        except json.JSONDecodeError:
                            continue
    except Exception as e:
        print(f"Stream error in fetch_ais_stream_geojson: {type(e).__name__}: {str(e)}")
        raise