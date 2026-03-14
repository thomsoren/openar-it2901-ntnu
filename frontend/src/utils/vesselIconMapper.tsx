import { createElement, type ComponentType, type ReactElement } from "react";
import type { AISData } from "../types/aisData";
import { ObiAisSarVesselIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-sar-vessel-iec";
import { ObiAisTargetActivatedIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-activated-iec";
import { ObiAisTargetDangerousIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-dangerous-iec";
import { ObiAisTargetSleepingIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-sleeping-iec";
import { ObiVesselTypeCargoOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-cargo-outlined";
import { ObiVesselTypeCruiseOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-cruise-outlined";
import { ObiVesselTypeFishingOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-fishing-outlined";
import { ObiVesselTypeGenericOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-outlined";
import { ObiVesselTypePassengerOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-passenger-outlined";
import { ObiVesselTypePilotOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-pilot-outlined";
import { ObiVesselTypeSarOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-sar-outlined";
import { ObiVesselTypeSailingOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-sailing-outlined";
import { ObiVesselTypeSpeedCraftOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-speed-craft-outlined";
import { ObiVesselTypeTankerOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-tanker-outlined";
import { ObiVesselTypeTugOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-tug-outlined";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-anchored-outlined.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-default-outlined.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-fast-outlined.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-medium-outlined.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-slow-outlined.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-stopped-outlined.js";

export type VesselIconSet = "generic" | "detailed" | "directional";

type VesselIconInput =
  | number
  | Partial<Pick<AISData, "shipType" | "speedOverGround" | "navigationalStatus">>
  | null
  | undefined;

type VesselGenericIconTag =
  | "obi-vessel-generic-default-outlined"
  | "obi-vessel-generic-slow-outlined"
  | "obi-vessel-generic-medium-outlined"
  | "obi-vessel-generic-fast-outlined"
  | "obi-vessel-generic-stopped-outlined"
  | "obi-vessel-generic-anchored-outlined";

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
    return { icon: ObiVesselTypeGenericOutlined, name: "Unknown vessel" };
  }

  if (shipType === 36 || shipType === 37) {
    return { icon: ObiVesselTypeSailingOutlined, name: "Sailing vessel" };
  }

  if (shipType >= 30 && shipType <= 39) {
    return { icon: ObiVesselTypeFishingOutlined, name: "Fishing vessel" };
  }

  if (shipType >= 40 && shipType <= 49) {
    return { icon: ObiVesselTypeSpeedCraftOutlined, name: "High-speed craft" };
  }

  if (shipType >= 50 && shipType <= 51) {
    return { icon: ObiVesselTypePilotOutlined, name: "Pilot vessel" };
  }

  if (shipType === 52) {
    return { icon: ObiVesselTypeSarOutlined, name: "Search and rescue vessel" };
  }

  if (shipType === 53 || shipType === 54) {
    return { icon: ObiVesselTypeTugOutlined, name: "Tug/Port tender" };
  }

  if (shipType >= 60 && shipType <= 69) {
    return shipType === 69
      ? { icon: ObiVesselTypeCruiseOutlined, name: "Cruise ship" }
      : { icon: ObiVesselTypePassengerOutlined, name: "Passenger ship" };
  }

  if (shipType >= 70 && shipType <= 79) {
    return { icon: ObiVesselTypeCargoOutlined, name: "Cargo ship" };
  }

  if (shipType >= 80 && shipType <= 89) {
    return { icon: ObiVesselTypeTankerOutlined, name: "Tanker" };
  }

  return { icon: ObiVesselTypeGenericOutlined, name: "General vessel" };
}

function getDirectionalIconDetails(
  speedOverGround?: number,
  navigationalStatus?: number
): VesselIconDetails {
  if (navigationalStatus != null && ANCHORED_STATUSES.has(navigationalStatus)) {
    return {
      icon: "obi-vessel-generic-anchored-outlined",
      name: "Anchored vessel",
      isCustomElementTag: true,
    };
  }

  if (navigationalStatus != null && STOPPED_STATUSES.has(navigationalStatus)) {
    return {
      icon: "obi-vessel-generic-stopped-outlined",
      name: "Stopped vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround == null) {
    return {
      icon: "obi-vessel-generic-default-outlined",
      name: "Vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround < 0.5) {
    return {
      icon: "obi-vessel-generic-stopped-outlined",
      name: "Stopped vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround >= 15) {
    return {
      icon: "obi-vessel-generic-fast-outlined",
      name: "Fast vessel",
      isCustomElementTag: true,
    };
  }

  if (speedOverGround >= 8) {
    return {
      icon: "obi-vessel-generic-medium-outlined",
      name: "Medium-speed vessel",
      isCustomElementTag: true,
    };
  }

  return {
    icon: "obi-vessel-generic-slow-outlined",
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
