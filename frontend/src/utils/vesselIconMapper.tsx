import { ObiAisTargetSleepingIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-sleeping-iec";
import { ObiAisTargetActivatedIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-activated-iec";
import { ObiAisTargetDangerousIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-dangerous-iec";
import { ObiAisSarVesselIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-sar-vessel-iec";

/** Select appropriate AIS icon based on vessel ship type */
function getVesselIcon(shipType?: number): React.ReactElement {
  if (!shipType) return <ObiAisTargetSleepingIec />;

  // AIS ship type codes: https://api.vtexplorer.com/docs/ref-aistypes.html
  // 30-39: Fishing
  // 40-49: High-speed craft
  // 50-59: Pilot vessels, SAR, tugs, port tenders
  // 60-69: Passenger ships
  // 70-79: Cargo ships
  // 80-89: Tankers
  // 90-99: Other types

  if (shipType >= 50 && shipType <= 59) {
    // Pilot, SAR, Tug, Port tender
    return <ObiAisSarVesselIec />;
  } else if (shipType >= 80 && shipType <= 89) {
    // Tankers - show as dangerous
    return <ObiAisTargetDangerousIec />;
  } else if (shipType >= 60 && shipType <= 79) {
    // Passenger and cargo - show as activated
    return <ObiAisTargetActivatedIec />;
  } else {
    // Default: fishing, high-speed, other
    return <ObiAisTargetSleepingIec />;
  }
}

export default getVesselIcon;

// TODO: Decide if we want to use the more detailed vessel type icons instead of generic target icons.

// import { ObiVesselTypeGenericFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-filled";
// import { ObiVesselTypeTankerFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-tanker-filled";
// import { ObiVesselTypeCargoFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-cargo-filled";
// import { ObiVesselTypePassengerFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-passenger-filled";
// import { ObiVesselTypeFishingFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-fishing-filled";
// import { ObiVesselTypeTugFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-tug-filled";
// import { ObiVesselTypeSarFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-sar-filled";
// import { ObiVesselTypePilotFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-pilot-filled";
// import { ObiVesselTypeSpeedCraftFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-speed-craft-filled";
// import { ObiVesselTypeSailingFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-sailing-filled";
// import { ObiVesselTypeCruiseFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-cruise-filled";

// /** Select appropriate vessel icon based on vessel ship type */
// function getVesselIcon(shipType?: number): React.ReactElement {
//   if (!shipType) return <ObiVesselTypeGenericFilled />;

//   // AIS ship type codes: https://api.vtexplorer.com/docs/ref-aistypes.html
//   // 30-39: Fishing
//   // 40-49: High-speed craft / Wing in ground (WIG)
//   // 50-59: Pilot vessels, SAR, tugs, port tenders
//   // 60-69: Passenger ships
//   // 70-79: Cargo ships
//   // 80-89: Tankers
//   // 90-99: Other types

//   if (shipType >= 30 && shipType <= 39) {
//     // Fishing vessels
//     return <ObiVesselTypeFishingFilled />;
//   } else if (shipType >= 40 && shipType <= 49) {
//     // High-speed craft
//     return <ObiVesselTypeSpeedCraftFilled />;
//   } else if (shipType >= 50 && shipType <= 51) {
//     // Pilot vessels
//     return <ObiVesselTypePilotFilled />;
//   } else if (shipType === 52) {
//     // SAR (Search and Rescue)
//     return <ObiVesselTypeSarFilled />;
//   } else if (shipType === 53 || shipType === 54) {
//     // Tug / Port tender
//     return <ObiVesselTypeTugFilled />;
//   } else if (shipType >= 60 && shipType <= 69) {
//     // Passenger ships
//     if (shipType === 69) {
//       return <ObiVesselTypeCruiseFilled />; // Passenger ship - cruise
//     }
//     return <ObiVesselTypePassengerFilled />;
//   } else if (shipType >= 70 && shipType <= 79) {
//     // Cargo ships
//     return <ObiVesselTypeCargoFilled />;
//   } else if (shipType >= 80 && shipType <= 89) {
//     // Tankers
//     return <ObiVesselTypeTankerFilled />;
//   } else if (shipType === 36 || shipType === 37) {
//     // Sailing
//     return <ObiVesselTypeSailingFilled />;
//   } else {
//     // Default: generic vessel
//     return <ObiVesselTypeGenericFilled />;
//   }
// }

// export default getVesselIcon;
