import { createElement } from "react";
import { AISData } from "../../types/aisData";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-default-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-slow-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-medium-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-fast-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-stopped-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-anchored-filled.js";
import "./DirectionalVesselIcon.css";

interface DirectionalVesselIconProps {
  vessel: AISData;
}

type VesselGenericIconTag =
  | "obi-vessel-generic-default-filled"
  | "obi-vessel-generic-slow-filled"
  | "obi-vessel-generic-medium-filled"
  | "obi-vessel-generic-fast-filled"
  | "obi-vessel-generic-stopped-filled"
  | "obi-vessel-generic-anchored-filled";

const ANCHORED_STATUSES = new Set([1]);
const STOPPED_STATUSES = new Set([5, 6]);

function getVesselCenterIcon(vessel: AISData): VesselGenericIconTag {
  const speed = vessel.speedOverGround;
  const status = vessel.navigationalStatus;

  if (status !== null && ANCHORED_STATUSES.has(status)) {
    return "obi-vessel-generic-anchored-filled";
  }

  if (status !== null && STOPPED_STATUSES.has(status)) {
    return "obi-vessel-generic-stopped-filled";
  }

  if (speed === null) {
    return "obi-vessel-generic-default-filled";
  }

  if (speed < 0.5) {
    return "obi-vessel-generic-stopped-filled";
  }

  if (speed >= 15) {
    return "obi-vessel-generic-fast-filled";
  }

  if (speed >= 8) {
    return "obi-vessel-generic-medium-filled";
  }

  return "obi-vessel-generic-slow-filled";
}

// Determines the rotation level for styling turn-dot color based on rate of turn
function getRotLevel(
  rateOfTurn: number | null
): "unknown" | "steady" | "gentle" | "moderate" | "sharp" {
  if (rateOfTurn === null || rateOfTurn === -128) {
    return "unknown";
  }

  const absRot = Math.abs(rateOfTurn);
  if (absRot < 0.05) {
    return "steady";
  }
  if (absRot < 5) {
    return "gentle";
  }
  if (absRot < 20) {
    return "moderate";
  }
  return "sharp";
}

export const DirectionalVesselIcon: React.FC<DirectionalVesselIconProps> = ({ vessel }) => {
  // Fallback behavior: if one angle is missing, use the other.
  const headingAngle = vessel.trueHeading ?? vessel.courseOverGround ?? 0;
  const courseAngle = vessel.courseOverGround ?? vessel.trueHeading ?? 0;

  const rotLevel = getRotLevel(vessel.rateOfTurn);
  const centerIconTag = getVesselCenterIcon(vessel);

  return (
    <div
      className={`dvi dvi-rot-${rotLevel}`}
      style={{
        ["--dvi-heading-angle" as string]: `${headingAngle}deg`,
        ["--dvi-course-angle" as string]: `${courseAngle}deg`,
      }}
    >
      <div className="dvi-inner-ring" />
      <div className="dvi-heading-line" />
      <div className="dvi-course-line" />
      <div className="dvi-turn-dot" />

      <div className="dvi-vessel-icon">
        {createElement(centerIconTag, { className: "dvi-vessel-icon-glyph" })}
      </div>
    </div>
  );
};
