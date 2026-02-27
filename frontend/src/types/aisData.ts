export interface AISProjection {
  x_px: number;
  y_px: number;
  distance_m: number;
  bearing_deg: number;
  rel_bearing_deg: number;
}

export interface HistoricalMmsiInAreaRequest {
  /** GeoJSON geometry object (Polygon, MultiPolygon, etc.). Max area: 500 km². */
  polygon: GeoJSONGeometry;
  /** ISO 8601 start datetime. Max timeframe is 7 days from msgTimeTo. */
  msgTimeFrom: string;
  /** ISO 8601 end datetime. */
  msgTimeTo: string;
  /** Whether to write an NDJSON session log on the server. */
  log?: boolean;
  /**Latitude of current ship position. */
  ship_lat: number;
  /**Longitude of current ship position. */
  ship_lon: number;
  /**Heading of the ship in degrees. */
  heading: number;
}

export interface GeoJSONGeometry {
  type: "Polygon";
  coordinates: [number, number][][];
}

export interface AISData {
  courseOverGround: number;
  latitude: number;
  longitude: number;
  name: string;
  rateOfTurn: number;
  shipType: number;
  speedOverGround: number;
  trueHeading: number;
  navigationalStatus: number;
  mmsi: number;
  msgtime: string;
  projection: AISProjection | null;
}
