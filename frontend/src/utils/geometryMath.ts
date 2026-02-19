// Helper functions for geometry calculations related to AIS data and map interactions.

// Geo helpers
const METERS_PER_LAT_DEGREE = 111_320;
const metersPerLonDegree = (lat: number) => METERS_PER_LAT_DEGREE * Math.cos(lat * (Math.PI / 180));

// Return the destination point from current origin, based on heading (degrees) and distance (metres)
function destinationPoint(
  lat: number,
  lon: number,
  headingDeg: number,
  distanceM: number
): [number, number] {
  const headingRad = headingDeg * (Math.PI / 180);
  const destLat = lat + (distanceM * Math.cos(headingRad)) / METERS_PER_LAT_DEGREE;
  const destLon = lon + (distanceM * Math.sin(headingRad)) / metersPerLonDegree(lat);
  return [destLat, destLon];
}

// Return the compass heading (0-360 degrees) from point A to point B
function headingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const deltaY = (lat2 - lat1) * METERS_PER_LAT_DEGREE;
  const deltaX = (lon2 - lon1) * metersPerLonDegree(lat1);
  return (Math.atan2(deltaX, deltaY) * (180 / Math.PI) + 360) % 360;
}

// Return the straight-line distance in metres between two points
function distanceTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const deltaY = (lat2 - lat1) * METERS_PER_LAT_DEGREE;
  const deltaX = (lon2 - lon1) * metersPerLonDegree(lat1);
  return Math.sqrt(deltaX ** 2 + deltaY ** 2);
}

// Build a polygon representing the FOV wedge based on ship position, heading, range, and FOV angle
const buildFovPolygon = (
  shipLat: number,
  shipLon: number,
  heading: number,
  offsetMeters: number,
  fovDegrees: number
): [number, number][] => {
  const [leftLat, leftLon] = destinationPoint(
    shipLat,
    shipLon,
    heading - fovDegrees / 2,
    offsetMeters
  );
  const [rightLat, rightLon] = destinationPoint(
    shipLat,
    shipLon,
    heading + fovDegrees / 2,
    offsetMeters
  );
  return [
    [shipLon, shipLat],
    [leftLon, leftLat],
    [rightLon, rightLat],
    [shipLon, shipLat],
  ];
};

// Check if a point (lon, lat) is inside a polygon using ray casting algorithm.
function isPointInPolygon(
  pointLon: number,
  pointLat: number,
  polygonCoords: [number, number][]
): boolean {
  /**
   * Check if a point (lon, lat) is inside a polygon using ray casting algorithm.
   *
   * @param pointLon - Longitude of the point
   * @param pointLat - Latitude of the point
   * @param polygonCoords - List of [lon, lat] coordinates forming the polygon
   * @returns True if point is inside the polygon, False otherwise
   */
  const x = pointLon;
  const y = pointLat;
  const n = polygonCoords.length;
  let inside = false;

  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = polygonCoords[i];
    const [xj, yj] = polygonCoords[j];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }

  return inside;
}

export { destinationPoint, headingTo, distanceTo, isPointInPolygon, buildFovPolygon };
