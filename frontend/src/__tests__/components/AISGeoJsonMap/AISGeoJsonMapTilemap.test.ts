import { describe, expect, it } from "vitest";
import type { RasterSourceSpecification } from "maplibre-gl";
import { getMapLibreStyle } from "../../../components/AISGeoJsonMap/AISGeoJsonMapTilemap";

describe("AISGeoJsonMapTilemap", () => {
  describe("getMapLibreStyle", () => {
    it("returns a valid MapLibre StyleSpecification", () => {
      const style = getMapLibreStyle("day");

      expect(style).toHaveProperty("version", 8);
      expect(style).toHaveProperty("sources");
      expect(style).toHaveProperty("layers");
    });

    it("maps 'night' theme to dark_all tilemap", () => {
      const style = getMapLibreStyle("night");
      const cartoSource = style.sources.carto as RasterSourceSpecification;

      expect(cartoSource).toBeDefined();
      expect(cartoSource.type).toBe("raster");
      expect(cartoSource.tiles).toEqual([
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ]);
    });

    it("maps 'dusk' theme to dark_all tilemap", () => {
      const style = getMapLibreStyle("dusk");
      const cartoSource = style.sources.carto as RasterSourceSpecification;

      expect(cartoSource.tiles).toEqual([
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ]);
    });

    it("maps 'day' theme to light_all tilemap", () => {
      const style = getMapLibreStyle("day");
      const cartoSource = style.sources.carto as RasterSourceSpecification;

      expect(cartoSource.tiles).toEqual([
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ]);
    });

    it("maps 'bright' theme to light_all tilemap", () => {
      const style = getMapLibreStyle("bright");
      const cartoSource = style.sources.carto as RasterSourceSpecification;

      expect(cartoSource.tiles).toEqual([
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ]);
    });

    it("falls back to light_all for unknown themes", () => {
      const style = getMapLibreStyle("unknown-theme");
      const cartoSource = style.sources.carto as RasterSourceSpecification;

      expect(cartoSource.tiles).toEqual([
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ]);
    });

    it("sets correct tile configuration", () => {
      const style = getMapLibreStyle("day");
      const cartoSource = style.sources.carto as RasterSourceSpecification;

      expect(cartoSource.tileSize).toBe(256);
      expect(cartoSource.maxzoom).toBe(19);
    });

    it("includes a raster layer mapped to the carto source", () => {
      const style = getMapLibreStyle("day");

      expect(style.layers).toHaveLength(1);
      expect(style.layers[0]).toEqual({
        id: "carto-tiles",
        type: "raster",
        source: "carto",
      });
    });

    it("returns three tile URLs for load balancing across CartoDB servers", () => {
      const style = getMapLibreStyle("night");
      const cartoSource = style.sources.carto as RasterSourceSpecification;

      expect(cartoSource.tiles).toHaveLength(3);
      expect(cartoSource.tiles![0]).toContain("a.basemaps.cartocdn.com");
      expect(cartoSource.tiles![1]).toContain("b.basemaps.cartocdn.com");
      expect(cartoSource.tiles![2]).toContain("c.basemaps.cartocdn.com");
    });
  });
});
