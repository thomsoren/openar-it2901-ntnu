import { useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import {
  ARControlContext,
  ARControlState,
  AR_CONTROL_DEFAULTS,
  ARBooleanControlKey,
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

function ensurePoiLayersVisible(state: ARControlState): ARControlState {
  if (state.vesselLayerVisible && state.detectionVisible) {
    return state;
  }
  return {
    ...state,
    vesselLayerVisible: true,
    detectionVisible: true,
  };
}

function readStoredState(): ARControlState {
  const mobileDefault: VideoFitMode = isMobileDevice() ? "contain" : "cover";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return ensurePoiLayersVisible({ ...AR_CONTROL_DEFAULTS, videoFitMode: mobileDefault });
    }
    const parsed = JSON.parse(raw) as Partial<ARControlState> & { rangeVisible?: boolean };
    const fallbackRange = parsed.rangeVisible ? "10.5" : AR_CONTROL_DEFAULTS.rangeValue;
    return ensurePoiLayersVisible({
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
    });
  } catch {
    return ensurePoiLayersVisible({ ...AR_CONTROL_DEFAULTS, videoFitMode: mobileDefault });
  }
}

export function ARControlProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ARControlState>(readStoredState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc.)
    }
  }, [state]);

  const toggle = useCallback((key: ARBooleanControlKey) => {
    setState((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setRangeValue = useCallback((value: RangeValue) => {
    setState((prev) => ({ ...prev, rangeValue: value }));
  }, []);

  const setPoiDropdownValue = useCallback((value: PoiDropdownValue) => {
    setState((prev) => ({ ...prev, poiDropdownValue: value }));
  }, []);

  const setVideoFitMode = useCallback((value: VideoFitMode) => {
    setState((prev) => ({ ...prev, videoFitMode: value }));
  }, []);

  const value = useMemo(
    () => ({ state, toggle, setRangeValue, setPoiDropdownValue, setVideoFitMode }),
    [state, toggle, setRangeValue, setPoiDropdownValue, setVideoFitMode]
  );

  return <ARControlContext.Provider value={value}>{children}</ARControlContext.Provider>;
}
