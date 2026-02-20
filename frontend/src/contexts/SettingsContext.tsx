import { useEffect, useMemo, useState, ReactNode } from "react";
import { SettingsContext, SettingsContextType, VideoFitMode } from "./settings-context";
const STORAGE_KEYS = {
  videoFitMode: "openar.videoFitMode",
  aisEnabled: "openar.aisEnabled",
  overlayVisible: "openar.overlayVisible",
  detectionVisible: "openar.detectionVisible",
  multiStreamTestingEnabled: "openar.multiStreamTestingEnabled",
} as const;

// Detect if device is mobile (viewport width < 768px or touch device)
const isMobileDevice = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth < 768;
  return isTouchDevice || isSmallScreen;
};

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
};

const readStoredFitMode = (): VideoFitMode => {
  const fallback: VideoFitMode = isMobileDevice() ? "contain" : "cover";
  try {
    const value = localStorage.getItem(STORAGE_KEYS.videoFitMode);
    return value === "contain" || value === "cover" ? value : fallback;
  } catch {
    return fallback;
  }
};

const persistValue = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode, blocked storage, etc.).
  }
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Default to "contain" (letterbox) on mobile, "cover" on desktop
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>(() => readStoredFitMode());
  const [aisEnabled, setAisEnabled] = useState<boolean>(() =>
    readStoredBoolean(STORAGE_KEYS.aisEnabled, true)
  );
  const [overlayVisible, setOverlayVisible] = useState<boolean>(() =>
    readStoredBoolean(STORAGE_KEYS.overlayVisible, true)
  );
  const [detectionVisible, setDetectionVisible] = useState<boolean>(() =>
    readStoredBoolean(STORAGE_KEYS.detectionVisible, true)
  );
  const [multiStreamTestingEnabled, setMultiStreamTestingEnabled] = useState<boolean>(() =>
    readStoredBoolean(STORAGE_KEYS.multiStreamTestingEnabled, false)
  );

  useEffect(() => {
    persistValue(STORAGE_KEYS.videoFitMode, videoFitMode);
  }, [videoFitMode]);

  useEffect(() => {
    persistValue(STORAGE_KEYS.aisEnabled, String(aisEnabled));
  }, [aisEnabled]);

  useEffect(() => {
    persistValue(STORAGE_KEYS.overlayVisible, String(overlayVisible));
  }, [overlayVisible]);

  useEffect(() => {
    persistValue(STORAGE_KEYS.detectionVisible, String(detectionVisible));
  }, [detectionVisible]);

  useEffect(() => {
    persistValue(STORAGE_KEYS.multiStreamTestingEnabled, String(multiStreamTestingEnabled));
  }, [multiStreamTestingEnabled]);

  const value = useMemo<SettingsContextType>(
    () => ({
      videoFitMode,
      setVideoFitMode,
      aisEnabled,
      setAisEnabled,
      overlayVisible,
      setOverlayVisible,
      detectionVisible,
      setDetectionVisible,
      multiStreamTestingEnabled,
      setMultiStreamTestingEnabled,
    }),
    [videoFitMode, aisEnabled, overlayVisible, detectionVisible, multiStreamTestingEnabled]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
