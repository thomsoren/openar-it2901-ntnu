export interface ProjectedCoordinate {
  mmsi: number;
  name?: string;
  pixel_x: number;
  pixel_y: number;
  distance_m: number;
  bearing_deg: number;
  relative_bearing_deg: number;
  in_fov: boolean;
  timestamp: string;
}
