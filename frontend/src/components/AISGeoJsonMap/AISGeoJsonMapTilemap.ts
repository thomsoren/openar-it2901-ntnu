/**
 * Helpers that map OBC theme names to `CartoDB` tilemap themes
 * and return MapLibre GL style specifications.
 *
 * More info on CartoDB tilemaps here: https://carto.com/help/building-maps/basemap-list/
 * For more free tilemap options, see https://github.com/alexurquhart/free-tiles/blob/master/tiles.json
 */

import type { StyleSpecification } from "maplibre-gl";

const themeToTilemap: Record<string, string> = {
  night: "dark_all",
  dusk: "dark_all",
  day: "light_all",
  bright: "light_all",
};

/** Build a full MapLibre style using CartoDB raster tiles for the given OBC theme. */
export function getMapLibreStyle(theme: string): StyleSpecification {
  const variant = themeToTilemap[theme] ?? "light_all";
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          `https://a.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}@2x.png`,
          `https://b.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}@2x.png`,
          `https://c.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}@2x.png`,
        ],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [{ id: "carto-tiles", type: "raster", source: "carto" }],
  };
}
