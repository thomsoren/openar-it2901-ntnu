import { createContext } from "react";

export type RangeValue = "off" | "3" | "5" | "10.5" | "24";
export type PoiDropdownValue = "poi-show" | "poi-hide" | "poi-display" | "poi-icon";
export type VideoFitMode = "contain" | "cover";

export interface ARControlPanelVisibilityState {
  rangeVisible: boolean;
  rulerVisible: boolean;
  buoyLightsVisible: boolean;
  vesselVisible: boolean;
  aisDataVisible: boolean;
  imageDataVisible: boolean;
  poiSettingsVisible: boolean;
  videoFitVisible: boolean;
  debugBboxVisible: boolean;
  navigationVisible: boolean;
}

export interface ARControlState {
  vesselLayerVisible: boolean;
  buoyLayerVisible: boolean;
  flotsamLayerVisible: boolean;
  mobLayerVisible: boolean;
  rangeValue: RangeValue;
  rulerVisible: boolean;
  imageDataVisible: boolean;
  poiVisible: boolean;
  poiDropdownValue: PoiDropdownValue;
  aisCardsVisible: boolean;
  detectionVisible: boolean;
  videoFitMode: VideoFitMode;
  debugBboxVisible: boolean;
  navigationVisible: boolean;
}

export type ARBooleanControlKey =
  | "vesselLayerVisible"
  | "buoyLayerVisible"
  | "flotsamLayerVisible"
  | "mobLayerVisible"
  | "rulerVisible"
  | "imageDataVisible"
  | "poiVisible"
  | "aisCardsVisible"
  | "detectionVisible"
  | "debugBboxVisible"
  | "navigationVisible";

export type ARControlPanelVisibilityKey = keyof ARControlPanelVisibilityState;

export interface ARControlContextType {
  state: ARControlState;
  panelVisibility: ARControlPanelVisibilityState;
  toggle: (key: ARBooleanControlKey) => void;
  setRangeValue: (value: RangeValue) => void;
  setPoiDropdownValue: (value: PoiDropdownValue) => void;
  setVideoFitMode: (value: VideoFitMode) => void;
  setPanelControlVisibility: (key: ARControlPanelVisibilityKey, visible: boolean) => void;
}

export const AR_CONTROL_DEFAULTS: ARControlState = {
  vesselLayerVisible: true,
  buoyLayerVisible: true,
  flotsamLayerVisible: true,
  mobLayerVisible: true,
  rangeValue: "off",
  rulerVisible: false,
  imageDataVisible: false,
  poiVisible: true,
  poiDropdownValue: "poi-display",
  aisCardsVisible: true,
  detectionVisible: true,
  videoFitMode: "cover",
  debugBboxVisible: false,
  navigationVisible: false,
};

export const AR_CONTROL_PANEL_VISIBILITY_DEFAULTS: ARControlPanelVisibilityState = {
  rangeVisible: true,
  rulerVisible: true,
  buoyLightsVisible: true,
  vesselVisible: true,
  aisDataVisible: true,
  imageDataVisible: true,
  poiSettingsVisible: true,
  videoFitVisible: true,
  debugBboxVisible: true,
  navigationVisible: true,
};

export const ARControlContext = createContext<ARControlContextType | undefined>(undefined);
