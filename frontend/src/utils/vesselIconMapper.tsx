import { createElement, type ComponentType, type ReactElement } from "react";
import type { AISData } from "../types/aisData";
import { ObiAisSarVesselIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-sar-vessel-iec";
import { ObiAisTargetActivatedIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-activated-iec";
import { ObiAisTargetDangerousIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-dangerous-iec";
import { ObiAisTargetSleepingIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-sleeping-iec";
import { ObiVesselTypeCargoFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-cargo-filled";
import { ObiVesselTypeCruiseFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-cruise-filled";
import { ObiVesselTypeFishingFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-fishing-filled";
import { ObiVesselTypeGenericFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-filled";
import { ObiVesselTypePassengerFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-passenger-filled";
import { ObiVesselTypePilotFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-pilot-filled";
import { ObiVesselTypeSarFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-sar-filled";
import { ObiVesselTypeSailingFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-sailing-filled";
import { ObiVesselTypeSpeedCraftFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-speed-craft-filled";
import { ObiVesselTypeTankerFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-tanker-filled";
import { ObiVesselTypeTugFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-tug-filled";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-anchored-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-default-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-fast-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-medium-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-slow-filled.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-stopped-filled.js";

export type VesselIconSet = "generic" | "detailed" | "directional";

type VesselIconInput =
  | number
  | Partial<Pick<AISData, "shipType" | "speedOverGround" | "navigationalStatus">>
  | null
  | undefined;

type VesselGenericIconTag =
  | "obi-vessel-generic-default-filled"
  | "obi-vessel-generic-slow-filled"
  | "obi-vessel-generic-medium-filled"
  | "obi-vessel-generic-fast-filled"
  | "obi-vessel-generic-stopped-filled"
  | "obi-vessel-generic-anchored-filled";

type VesselIconOptions = {
  iconSet?: VesselIconSet;
  className?: string;
  returnType?: "icon" | "name";
};

type VesselIconNameOptions = Omit<VesselIconOptions, "returnType"> & {
  returnType: "name";
};

type VesselIconElementOptions = Omit<VesselIconOptions, "returnType"> & {
  returnType?: "icon";
};

type VesselIconDetails = {
  icon: ComponentType<{ className?: string }> | VesselGenericIconTag;
  name: string;
  isCustomElementTag?: boolean;
};

const ANCHORED_STATUSES = new Set([1]);
const STOPPED_STATUSES = new Set([5, 6]);

function normalizeInput(input: VesselIconInput) {
  if (typeof input === "number") {
    return { shipType: input };
  }

  return input ?? {};
}

function getGenericIconDetails(shipType?: number): VesselIconDetails {
  if (!shipType) {
    return { icon: ObiAisTargetSleepingIec, name: "Unknown vessel" };
  }

  if (shipType >= 50 && shipType <= 59) {
    return { icon: ObiAisSarVesselIec, name: "Service vessel" };
  }

  if (shipType >= 80 && shipType <= 89) {
    return { icon: ObiAisTargetDangerousIec, name: "Tanker" };
  }

  if (shipType >= 60 && shipType <= 79) {
    return { icon: ObiAisTargetActivatedIec, name: "Passenger/Cargo vessel" };
  }

  return { icon: ObiAisTargetSleepingIec, name: "General vessel" };
}

function getDetailedIconDetails(shipType?: number): VesselIconDetails {
  if (!shipType) {
    return { icon: ObiVesselTypeGenericFilled, name: "Unknown vessel" };
  }

  if (shipType === 36 || shipType === 37) {
    return { icon: ObiVesselTypeSailingFilled, name: "Sailing vessel" };
  }

  if (shipType >= 30 && shipType <= 39) {
    return { icon: ObiVesselTypeFishingFilled, name: "Fishing vessel" };
  }

  if (shipType >= 40 && shipType <= 49) {
    return { icon: ObiVesselTypeSpeedCraftFilled, name: "High-speed craft" };
  }

  if (shipType >= 50 && shipType <= 51) {
    return { icon: ObiVesselTypePilotFilled, name: "Pilot vessel" };
  }

  if (shipType === 52) {
    return { icon: ObiVesselTypeSarFilled, name: "Search and rescue vessel" };
  }

  if (shipType === 53 || shipType === 54) {
    return { icon: ObiVesselTypeTugFilled, name: "Tug/Port tender" };
  }

  if (shipType >= 60 && shipType <= 69) {
    return shipType === 69
      ? { icon: ObiVesselTypeCruiseFilled, name: "Cruise ship" }
      : { icon: ObiVesselTypePassengerFilled, name: "Passenger ship" };
  }

  if (shipType >= 70 && shipType <= 79) {
    return { icon: ObiVesselTypeCargoFilled, name: "Cargo ship" };
  }

  if (shipType >= 80 && shipType <= 89) {
    return { icon: ObiVesselTypeTankerFilled, name: "Tanker" };
  }

  return { icon: ObiVesselTypeGenericFilled, name: "General vessel" };
}

function getDirectionalIconDetails(
  speedOverGround?: number,
  navigationalStatus?: number
): VesselIconDetails {
  if (navigationalStatus != null && ANCHORED_STATUSES.has(navigationalStatus)) {
    return {
      icon: "obi-vessel-generic-anchored-filled",
      name: "Anchored vessel",
      isCustomElementTag: true,
    };
  }

  if (navigationalStatus != null && STOPPED_STATUSES.has(navigationalStatus)) {
    return {
      icon: "obi-vessel-generic-stopped-filled",
      name: "Stopped vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround == null) {
    return {
      icon: "obi-vessel-generic-default-filled",
      name: "Vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround < 0.5) {
    return {
      icon: "obi-vessel-generic-stopped-filled",
      name: "Stopped vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround >= 15) {
    return {
      icon: "obi-vessel-generic-fast-filled",
      name: "Fast vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround >= 8) {
    return {
      icon: "obi-vessel-generic-medium-filled",
      name: "Medium-speed vessel",
      isCustomElementTag: true,
    };
  }

  return {
    icon: "obi-vessel-generic-slow-filled",
    name: "Slow vessel",
    isCustomElementTag: true,
  };
}

function resolveIconDetails(input: VesselIconInput, iconSet: VesselIconSet): VesselIconDetails {
  const { shipType, speedOverGround, navigationalStatus } = normalizeInput(input);

  if (iconSet === "detailed") {
    return getDetailedIconDetails(shipType);
  }

  if (iconSet === "directional") {
    return getDirectionalIconDetails(speedOverGround, navigationalStatus);
  }

  return getGenericIconDetails(shipType);
}

function createIcon(details: VesselIconDetails, className?: string): ReactElement {
  if (details.isCustomElementTag) {
    return createElement(details.icon as VesselGenericIconTag, { className });
  }

  return createElement(details.icon as ComponentType<{ className?: string }>, {
    className,
  });
}

function getVesselIcon(input: VesselIconInput, options: VesselIconNameOptions): string;
function getVesselIcon(input?: VesselIconInput, options?: VesselIconElementOptions): ReactElement;
function getVesselIcon(
  input?: VesselIconInput,
  options: VesselIconOptions = {}
): ReactElement | string {
  const { iconSet = "generic", className, returnType = "icon" } = options;
  const details = resolveIconDetails(input, iconSet);

  if (returnType === "name") {
    return details.name;
  }

  return createIcon(details, className);
}

export default getVesselIcon;
