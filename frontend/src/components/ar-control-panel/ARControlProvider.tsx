import { useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import {
  ARControlContext,
  ARControlState,
  AR_CONTROL_DEFAULTS,
  AR_CONTROL_PANEL_VISIBILITY_DEFAULTS,
  ARBooleanControlKey,
  ARControlPanelVisibilityKey,
  ARControlPanelVisibilityState,
  RangeValue,
  PoiDropdownValue,
  VideoFitMode,
} from "./ar-control-context";

const STORAGE_KEY = "openar.arControls";
const RANGE_VALUES: ReadonlySet<RangeValue> = new Set(["off", "3", "5", "10.5", "24"]);
const POI_DROPDOWN_VALUES: ReadonlySet<PoiDropdownValue> = new Set([
  "poi-show",
  "poi-hide",
  "poi-display",
  "poi-icon",
]);
const VIDEO_FIT_MODES: ReadonlySet<VideoFitMode> = new Set(["contain", "cover"]);

interface StoredARControlState extends Partial<ARControlState> {
  // Legacy: old localStorage format stored rangeVisible as a top-level boolean.
  // Kept for backwards-compat so existing users get a sensible range default on upgrade.
  rangeVisible?: boolean;
  panelVisibility?: Partial<ARControlPanelVisibilityState>;
}

function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asRangeValue(value: unknown, fallback: RangeValue): RangeValue {
  return typeof value === "string" && RANGE_VALUES.has(value as RangeValue)
    ? (value as RangeValue)
    : fallback;
}

function asPoiDropdownValue(value: unknown, fallback: PoiDropdownValue): PoiDropdownValue {
  return typeof value === "string" && POI_DROPDOWN_VALUES.has(value as PoiDropdownValue)
    ? (value as PoiDropdownValue)
    : fallback;
}

function asVideoFitMode(value: unknown, fallback: VideoFitMode): VideoFitMode {
  return typeof value === "string" && VIDEO_FIT_MODES.has(value as VideoFitMode)
    ? (value as VideoFitMode)
    : fallback;
}

function readPanelVisibility(value: unknown): ARControlPanelVisibilityState {
  const obj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    rangeVisible: asBoolean(obj.rangeVisible, AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.rangeVisible),
    rulerVisible: asBoolean(obj.rulerVisible, AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.rulerVisible),
    buoyLightsVisible: asBoolean(
      obj.buoyLightsVisible,
      AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.buoyLightsVisible
    ),
    vesselVisible: asBoolean(obj.vesselVisible, AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.vesselVisible),
    aisDataVisible: asBoolean(
      obj.aisDataVisible,
      AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.aisDataVisible
    ),
    imageDataVisible: asBoolean(
      obj.imageDataVisible,
      AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.imageDataVisible
    ),
    poiSettingsVisible: asBoolean(
      obj.poiSettingsVisible,
      AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.poiSettingsVisible
    ),
    videoFitVisible: asBoolean(
      obj.videoFitVisible,
      AR_CONTROL_PANEL_VISIBILITY_DEFAULTS.videoFitVisible
    ),
  };
}

function readStoredState(): {
  state: ARControlState;
  panelVisibility: ARControlPanelVisibilityState;
} {
  const mobileDefault: VideoFitMode = isMobileDevice() ? "contain" : "cover";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        state: { ...AR_CONTROL_DEFAULTS, videoFitMode: mobileDefault },
        panelVisibility: { ...AR_CONTROL_PANEL_VISIBILITY_DEFAULTS },
      };
    }
    const parsed = JSON.parse(raw) as StoredARControlState;
    const fallbackRange = parsed.rangeVisible ? "10.5" : AR_CONTROL_DEFAULTS.rangeValue;
    return {
      state: {
        vesselLayerVisible: asBoolean(
          parsed.vesselLayerVisible,
          AR_CONTROL_DEFAULTS.vesselLayerVisible
        ),
        buoyLayerVisible: asBoolean(parsed.buoyLayerVisible, AR_CONTROL_DEFAULTS.buoyLayerVisible),
        flotsamLayerVisible: asBoolean(
          parsed.flotsamLayerVisible,
          AR_CONTROL_DEFAULTS.flotsamLayerVisible
        ),
        mobLayerVisible: asBoolean(parsed.mobLayerVisible, AR_CONTROL_DEFAULTS.mobLayerVisible),
        rangeValue: asRangeValue(parsed.rangeValue, fallbackRange),
        rulerVisible: asBoolean(parsed.rulerVisible, AR_CONTROL_DEFAULTS.rulerVisible),
        imageDataVisible: asBoolean(parsed.imageDataVisible, AR_CONTROL_DEFAULTS.imageDataVisible),
        poiVisible: asBoolean(parsed.poiVisible, AR_CONTROL_DEFAULTS.poiVisible),
        poiDropdownValue: asPoiDropdownValue(
          parsed.poiDropdownValue,
          AR_CONTROL_DEFAULTS.poiDropdownValue
        ),
        aisCardsVisible: asBoolean(parsed.aisCardsVisible, AR_CONTROL_DEFAULTS.aisCardsVisible),
        detectionVisible: asBoolean(parsed.detectionVisible, AR_CONTROL_DEFAULTS.detectionVisible),
        videoFitMode: asVideoFitMode(parsed.videoFitMode, mobileDefault),
      },
      panelVisibility: readPanelVisibility(parsed.panelVisibility),
    };
  } catch {
    return {
      state: { ...AR_CONTROL_DEFAULTS, videoFitMode: mobileDefault },
      panelVisibility: { ...AR_CONTROL_PANEL_VISIBILITY_DEFAULTS },
    };
  }
}

export function ARControlProvider({ children }: { children: ReactNode }) {
  const [storedState, setStoredState] = useState(readStoredState);
  const { state, panelVisibility } = storedState;

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...state,
          panelVisibility,
        })
      );
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc.)
    }
  }, [panelVisibility, state]);

  const toggle = useCallback((key: ARBooleanControlKey) => {
    setStoredState((prev) => ({
      ...prev,
      state: { ...prev.state, [key]: !prev.state[key] },
    }));
  }, []);

  const setRangeValue = useCallback((value: RangeValue) => {
    setStoredState((prev) => ({
      ...prev,
      state: { ...prev.state, rangeValue: value },
    }));
  }, []);

  const setPoiDropdownValue = useCallback((value: PoiDropdownValue) => {
    setStoredState((prev) => ({
      ...prev,
      state: { ...prev.state, poiDropdownValue: value },
    }));
  }, []);

  const setVideoFitMode = useCallback((value: VideoFitMode) => {
    setStoredState((prev) => ({
      ...prev,
      state: { ...prev.state, videoFitMode: value },
    }));
  }, []);

  const setPanelControlVisibility = useCallback(
    (key: ARControlPanelVisibilityKey, visible: boolean) => {
      setStoredState((prev) => ({
        ...prev,
        panelVisibility: { ...prev.panelVisibility, [key]: visible },
      }));
    },
    []
  );

  const value = useMemo(
    () => ({
      state,
      panelVisibility,
      toggle,
      setRangeValue,
      setPoiDropdownValue,
      setVideoFitMode,
      setPanelControlVisibility,
    }),
    [
      state,
      panelVisibility,
      toggle,
      setRangeValue,
      setPoiDropdownValue,
      setVideoFitMode,
      setPanelControlVisibility,
    ]
  );

  return <ARControlContext.Provider value={value}>{children}</ARControlContext.Provider>;
}
