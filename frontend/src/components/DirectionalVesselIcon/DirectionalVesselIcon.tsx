import React from "react";
import { AISData } from "../../types/aisData";
import "./DirectionalVesselIcon.css";

interface DirectionalVesselIconProps {
  vessel: AISData;
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
        {React.createElement("obi-vessel-generic-default-outlined")}
      </div>
    </div>
  );
};
