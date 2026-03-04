import { type AISData } from "../types/aisData";
import { type Vessel } from "../types/detection";

/** Map a fusion Vessel (from DetectedVessel) to AISData shape for AISDataPanel. */
export function vesselToAISData(vessel: Vessel): AISData {
  return {
    mmsi: vessel.mmsi ? Number(vessel.mmsi) : -1,
    name: vessel.name ?? "",
    latitude: vessel.latitude ?? -1,
    longitude: vessel.longitude ?? -1,
    courseOverGround: -1,
    speedOverGround: vessel.speed ?? -1,
    trueHeading: vessel.heading ?? -1,
    rateOfTurn: -1,
    navigationalStatus: -1,
    shipType: -1,
    msgtime: "",
    projection: null,
  };
}
