import os
import aiohttp
from dotenv import load_dotenv, set_key, find_dotenv

load_dotenv()

CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
API_KEY = os.getenv("AIS_API_KEY")

# Refresh the API key using client credentials (Expires every hour)
async def refresh_api_key():
    async with aiohttp.ClientSession() as session:
        async with session.post(
          "https://id.barentswatch.no/connect/token",
          headers={
            "Content-Type": "application/x-www-form-urlencoded"
          },
          data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "client_credentials",
            "scope": "ais"
          }
        ) as response:
          if response.status != 200:
              error_text = await response.text()
              raise ValueError(f"HTTP error {response.status}: {error_text}")
          data = await response.json()
          access_token = data.get("access_token")

          # Update the environment variable in the .env file
          os.environ["AIS_API_KEY"] = access_token
          dotenv_path = find_dotenv()
          set_key(dotenv_path, "AIS_API_KEY", access_token)

          return access_token

# Fetch AIS data with automatic API key refresh (User only needs CLIENT_ID and CLIENT_SECRET in .env)
async def fetch_ais(api_key=None):
  if not CLIENT_ID or not CLIENT_SECRET:
      print("Error: CLIENT_ID or CLIENT_SECRET not set in environment. Make sure it matches .env.example")
      return
  
  # Use provided api_key or fall back to the globally set API_KEY
  if api_key is None:
      api_key = API_KEY
      
  async with aiohttp.ClientSession() as session:
    async with session.get(
      "https://historic.ais.barentswatch.no/v1/historic/trackslast24hours/257111020",
      headers={
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json"
      }
    ) as response:
      
      # If unauthorized (status 401), refresh the API key and retry
      if response.status == 401:
        new_key = await refresh_api_key()
        return await fetch_ais(new_key)
      
      if response.status != 200:
        raise ValueError(f"HTTP error {response.status}")
      
      return await response.json()
