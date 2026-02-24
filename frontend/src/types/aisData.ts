export interface AISProjection {
  x_px: number;
  y_px: number;
  distance_m: number;
  bearing_deg: number;
  rel_bearing_deg: number;
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
