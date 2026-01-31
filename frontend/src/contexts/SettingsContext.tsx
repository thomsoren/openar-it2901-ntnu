import { createContext, useContext, useState, ReactNode } from "react";

export type VideoFitMode = "contain" | "cover";

interface SettingsContextType {
  videoFitMode: VideoFitMode;
  setVideoFitMode: (mode: VideoFitMode) => void;
  aisEnabled: boolean;
  setAisEnabled: (enabled: boolean) => void;
  overlayVisible: boolean;
  setOverlayVisible: (visible: boolean) => void;
  detectionVisible: boolean;
  setDetectionVisible: (visible: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// Detect if device is mobile (viewport width < 768px or touch device)
const isMobileDevice = (): boolean => {
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth < 768;
  return isTouchDevice || isSmallScreen;
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Default to "contain" (letterbox) on mobile, "cover" on desktop
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>(
    isMobileDevice() ? "contain" : "cover"
  );
  const [aisEnabled, setAisEnabled] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [detectionVisible, setDetectionVisible] = useState(true);

  return (
    <SettingsContext.Provider
      value={{
        videoFitMode,
        setVideoFitMode,
        aisEnabled,
        setAisEnabled,
        overlayVisible,
        setOverlayVisible,
        detectionVisible,
        setDetectionVisible,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
