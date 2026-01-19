import os
import json
import asyncio
import aiohttp

API_KEY = os.getenv("AIS_API_KEY")

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
