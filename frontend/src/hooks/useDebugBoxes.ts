import { useEffect, useRef } from "react";

export interface DebugBoxItem {
  trackId: string | number;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  label: string;
  directionDeg?: number;
}

export function useDebugBoxes(
  containerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  items: DebugBoxItem[]
) {
  const boxesRef = useRef<Map<string | number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!enabled) {
      for (const el of boxesRef.current.values()) {
        el.parentNode?.removeChild(el);
      }
      boxesRef.current.clear();
      return;
    }

    const keysToRemove = new Set(boxesRef.current.keys());

    for (const item of items) {
      keysToRemove.delete(item.trackId);

      let box = boxesRef.current.get(item.trackId);
      if (!box) {
        box = document.createElement("div");
        box.style.position = "absolute";
        box.style.border = "2px solid lime";
        box.style.pointerEvents = "none";
        box.style.zIndex = "9999";
        box.style.boxSizing = "border-box";
        box.style.color = "lime";
        box.style.fontSize = "10px";
        box.style.overflow = "visible";
        box.style.whiteSpace = "nowrap";
        boxesRef.current.set(item.trackId, box);
        container.appendChild(box);
      }

      box.style.left = `${item.screenX - item.width / 2}px`;
      box.style.top = `${item.screenY - item.height / 2}px`;
      box.style.width = `${item.width}px`;
      box.style.height = `${item.height}px`;

      const dirLabel = item.directionDeg !== undefined ? ` ${Math.round(item.directionDeg)}°` : "";
      box.textContent = `${item.label}${dirLabel}`;
    }

    for (const key of keysToRemove) {
      const el = boxesRef.current.get(key);
      if (el) {
        el.parentNode?.removeChild(el);
        boxesRef.current.delete(key);
      }
    }
  }, [containerRef, enabled, items]);

  useEffect(() => {
    const boxes = boxesRef.current;
    return () => {
      for (const el of boxes.values()) {
        el.parentNode?.removeChild(el);
      }
      boxes.clear();
    };
  }, []);
}
