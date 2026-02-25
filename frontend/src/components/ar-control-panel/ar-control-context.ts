import { createContext } from "react";

export type RangeValue = "off" | "3" | "5" | "10.5" | "24";
export type PoiDropdownValue = "poi-show" | "poi-hide" | "poi-display" | "poi-icon";
export type VideoFitMode = "contain" | "cover";

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
  | "detectionVisible";

export interface ARControlContextType {
  state: ARControlState;
  toggle: (key: ARBooleanControlKey) => void;
  setRangeValue: (value: RangeValue) => void;
  setPoiDropdownValue: (value: PoiDropdownValue) => void;
  setVideoFitMode: (value: VideoFitMode) => void;
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
};

export const ARControlContext = createContext<ARControlContextType | undefined>(undefined);
