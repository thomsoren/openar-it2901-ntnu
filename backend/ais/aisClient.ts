import { AIS_TOKEN } from './env';

export async function fetchAis() {
  const apiKey = AIS_TOKEN
  
  const response = await fetch(
    "https://historic.ais.barentswatch.no/v1/historic/trackslast24hours/257111020",
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  return response.json();
}
