import type { ARControlPanelVisibilityKey } from "./ar-control-context";

export interface ARPanelControlDefinition {
  key: ARControlPanelVisibilityKey;
  label: string;
  description: string;
}

export const AR_PANEL_CONTROL_DEFINITIONS: readonly ARPanelControlDefinition[] = [
  { key: "rangeVisible", label: "Range selector", description: "Range dropdown" },
  { key: "rulerVisible", label: "Ruler", description: "Ruler toggle" },
  {
    key: "buoyLightsVisible",
    label: "Buoy + lighthouse",
    description: "Buoy and lighthouse control",
  },
  { key: "vesselVisible", label: "Boat", description: "Vessel layer toggle" },
  { key: "aisDataVisible", label: "AIS Data", description: "AIS data toggle" },
  { key: "imageDataVisible", label: "Image Data", description: "Image data toggle" },
  { key: "poiSettingsVisible", label: "POI settings", description: "POI settings menu" },
  { key: "videoFitVisible", label: "Video fit", description: "Fit mode toggle" },
] as const;
