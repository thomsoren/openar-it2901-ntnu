import { createContext } from "react";

export interface ARControlState {
  vesselLayerVisible: boolean;
  buoyLayerVisible: boolean;
  flotsamLayerVisible: boolean;
  mobLayerVisible: boolean;
  rangeVisible: boolean;
  rulerVisible: boolean;
  imageDataVisible: boolean;
  poiVisible: boolean;
  aisCardsVisible: boolean;
}

export interface ARControlContextType {
  state: ARControlState;
  toggle: (key: keyof ARControlState) => void;
}

export const AR_CONTROL_DEFAULTS: ARControlState = {
  vesselLayerVisible: true,
  buoyLayerVisible: true,
  flotsamLayerVisible: true,
  mobLayerVisible: true,
  rangeVisible: false,
  rulerVisible: false,
  imageDataVisible: false,
  poiVisible: true,
  aisCardsVisible: true,
};

export const ARControlContext = createContext<ARControlContextType | undefined>(undefined);
