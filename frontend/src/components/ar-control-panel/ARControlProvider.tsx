import { useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import {
  ARControlContext,
  ARControlState,
  AR_CONTROL_DEFAULTS,
  ARBooleanControlKey,
  RangeValue,
  PoiDropdownValue,
} from "./ar-control-context";

const STORAGE_KEY = "openar.arControls";
const RANGE_VALUES: ReadonlySet<RangeValue> = new Set(["off", "3", "5", "10.5", "24"]);
const POI_DROPDOWN_VALUES: ReadonlySet<PoiDropdownValue> = new Set([
  "poi-show",
  "poi-hide",
  "poi-display",
  "poi-icon",
]);

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

function readStoredState(): ARControlState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return AR_CONTROL_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ARControlState> & { rangeVisible?: boolean };
    const fallbackRange = parsed.rangeVisible ? "10.5" : AR_CONTROL_DEFAULTS.rangeValue;
    return {
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
    };
  } catch {
    return AR_CONTROL_DEFAULTS;
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

  const value = useMemo(
    () => ({ state, toggle, setRangeValue, setPoiDropdownValue }),
    [state, toggle, setRangeValue, setPoiDropdownValue]
  );

  return <ARControlContext.Provider value={value}>{children}</ARControlContext.Provider>;
}
