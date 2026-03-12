import type { ARControlPanelVisibilityKey } from "./ar-control-context";

export interface ARPanelControlDefinition {
  key: ARControlPanelVisibilityKey;
  label: string;
  description: string;
}

export const AR_PANEL_CONTROL_DEFINITIONS: readonly ARPanelControlDefinition[] = [
  {
    key: "rangeVisible",
    label: "Range selector",
    description: "Dropdown to set range ring distance (NM)",
  },
  { key: "rulerVisible", label: "Ruler", description: "On-screen measurement ruler overlay" },
  {
    key: "buoyLightsVisible",
    label: "Buoy + lighthouse",
    description: "Show buoy and lighthouse markers on the AR view",
  },
  {
    key: "vesselVisible",
    label: "Vessel",
    description: "Vessel layer with detected ship outlines",
  },
  {
    key: "aisDataVisible",
    label: "AIS Data",
    description: "AIS identification cards and MOB markers",
  },
  { key: "imageDataVisible", label: "Image Data", description: "Camera feed metadata overlay" },
  {
    key: "poiSettingsVisible",
    label: "POI settings",
    description: "Point-of-interest display and icon options",
  },
  {
    key: "videoFitVisible",
    label: "Video fit",
    description: "Toggle between fill-screen (crop) and letterbox",
  },
  {
    key: "debugBboxVisible",
    label: "Debug bounding boxes",
    description: "Show raw bounding boxes instead of POI components",
  },
] as const;
