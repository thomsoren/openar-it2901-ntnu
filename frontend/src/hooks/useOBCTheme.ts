import { useState, useEffect } from "react";

export type ObcPalette = "night" | "dusk" | "day" | "bright";

function readPalette(): ObcPalette {
  return (document.documentElement.getAttribute("data-obc-theme") as ObcPalette) ?? "day";
}

/**
 * Subscribes to OBC palette changes driven by <obc-brilliance-menu>.
 *
 * App.tsx keeps `data-obc-theme` on <html> in sync via `handleBrillianceChange`,
 * so we watch that single attribute as the source of truth for the current palette.
 *
 * @returns palette - the current ObcPalette string ("night" | "dusk" | "day" | "bright")
 */
export function useObcPalette(): ObcPalette {
  const [palette, setPalette] = useState<ObcPalette>(readPalette);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPalette(readPalette());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-obc-theme"],
    });

    return () => observer.disconnect();
  }, []);

  return palette;
}
