import { createContext } from "react";

export type VideoFitMode = "contain" | "cover";

export interface SettingsContextType {
  videoFitMode: VideoFitMode;
  setVideoFitMode: (mode: VideoFitMode) => void;
  aisEnabled: boolean;
  setAisEnabled: (enabled: boolean) => void;
  overlayVisible: boolean;
  setOverlayVisible: (visible: boolean) => void;
  detectionVisible: boolean;
  setDetectionVisible: (visible: boolean) => void;
  multiStreamTestingEnabled: boolean;
  setMultiStreamTestingEnabled: (enabled: boolean) => void;
}

export const SettingsContext = createContext<SettingsContextType | undefined>(undefined);
