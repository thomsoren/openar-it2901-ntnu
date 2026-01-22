import os
import json
import asyncio
import aiohttp

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


async def fetch_ais_in_area(
    since: str = "2026-01-21T14:12:02.950Z",
    coordinates: list = None
):
  """
  Fetch AIS data for vessels in a geographic area during a time range.
  Uses historic API with polygon query.
  
  Args:
    msgtimefrom: Start time in ISO format (default: 2022-10-25)
    msgtimeto: End time in ISO format (default: 2022-11-02)
    coordinates: Polygon coordinates as list of [lon, lat] pairs (default: Risøyhavn area)
  
  Returns:
    List of MMSI and vessel data in the specified area
  """
  if not API_KEY:
    raise ValueError("AIS_API_KEY not set in environment")
  
  # Default polygon area (coordinates near Trondheim/Risøyhavn area)
  if coordinates is None:
    coordinates = [
      [10.399613501747382, 63.44313934810131],
      [10.367365255252821, 63.44313934810131],
      [10.367365255252821, 63.43120885914223],
      [10.399613501747382, 63.43120885914223],
      [10.399613501747382, 63.44313934810131]
    ]
  
  payload = {
    "since": since,
    "polygon": {
      "coordinates": [coordinates],
      "type": "Polygon"
    }
  }
  
  async with aiohttp.ClientSession() as session:
    async with session.post(
      "https://historic.ais.barentswatch.no/v1/historic/mmsiinarea",
      headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
      },
      json=payload
    ) as response:
      if response.status != 200:
        raise ValueError(f"HTTP error {response.status}: {await response.text()}")
      return await response.json()

async def fetch_ais_stream_geojson(timeout: int = 30, coordinates: list = None):
    """
    Fetch AIS data stream filtered by geographic polygon.
    Streams NDJSON objects from BarentsWatch using server-side filtering.
    
    Args:
        timeout: Connection timeout in seconds
        coordinates: Polygon coordinates as list of [lon, lat] pairs (default: Risøyhavn area)
    
    Yields:
        GeoJSON Feature objects from the stream
    """

    if not API_KEY:
        raise ValueError("AIS_API_KEY not set in environment")

    # Default polygon area (coordinates near Trondheim/Risøyhavn area)
    if coordinates is None:
        # Expanded area - larger coverage around Norwegian coast
        coordinates = [
            [10.2, 63.3],
            [10.6, 63.3],
            [10.6, 63.5],
            [10.2, 63.5],
            [10.2, 63.3]
        ]
    
    print(f"Stream: Using coordinates: {coordinates}")

    url = "https://live.ais.barentswatch.no/live/v1/combined"

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json"
    }

    request_body = {
        "modelType": "Simple",
        "modelFormat": "Json",
        "geometry": {
            "type": "Polygon",
            "coordinates": [coordinates]
        },
        "downsample": True
    }

    timeout_cfg = aiohttp.ClientTimeout(total=timeout)

    try:
        async with aiohttp.ClientSession(timeout=timeout_cfg) as session:
            async with session.post(url, headers=headers, json=request_body) as response:

                if response.status != 200:
                    raise ValueError(
                        f"HTTP {response.status}: {await response.text()}"
                    )

                async for line in response.content:
                    line = line.decode("utf-8").strip()
                    if not line:
                        continue

                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        print("Invalid JSON line:", line[:200])

    except asyncio.TimeoutError:
        print(f"Stream timed out after {timeout} seconds")
      
def main():
    if not API_KEY:
      print("Warning: AIS_API_KEY not set in environment")
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
