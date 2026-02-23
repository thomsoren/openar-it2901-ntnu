import { useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import { ARControlContext, ARControlState, AR_CONTROL_DEFAULTS } from "./ar-control-context";

const STORAGE_KEY = "openar.arControls";

function readStoredState(): ARControlState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return AR_CONTROL_DEFAULTS;
    return { ...AR_CONTROL_DEFAULTS, ...JSON.parse(raw) };
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

  const toggle = useCallback((key: keyof ARControlState) => {
    setState((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const value = useMemo(() => ({ state, toggle }), [state, toggle]);

  return <ARControlContext.Provider value={value}>{children}</ARControlContext.Provider>;
}
