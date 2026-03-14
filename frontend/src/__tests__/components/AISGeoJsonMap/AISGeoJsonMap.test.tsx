import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./AISGeoJsonMap.mocks";
import { clearMarkers, getCreatedMarkers, simulateDragTest } from "./AISGeoJsonMap.test-utils";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { AISGeoJsonMap } from "../../../components/AISGeoJsonMap/AISGeoJsonMap";

type MockMapInstance = {
  panTo: ReturnType<typeof vi.fn>;
  setStyle: ReturnType<typeof vi.fn>;
};

const DEFAULT_PROPS = {
  shipLat: 63.4305,
  shipLon: 10.3951,
  heading: 90,
  offsetMeters: 1200,
  fovDegrees: 60,
  shapeMode: "wedge" as const,
  rectLength: 1000,
  rectWidth: 300,
};

async function getLatestMapInstance(): Promise<MockMapInstance | null> {
  const maplibregl = (await import("maplibre-gl")) as {
    default: { _getMapInstances?: () => MockMapInstance[] };
  };
  const instances = maplibregl.default._getMapInstances?.() ?? [];
  return instances.length > 0 ? instances[instances.length - 1] : null;
}

function getLastOnChangePayload<TPayload>(onChange: ReturnType<typeof vi.fn>): TPayload {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as TPayload;
}

describe("AISGeoJsonMap", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
  });

  const renderMap = async (props?: Partial<React.ComponentProps<typeof AISGeoJsonMap>>) => {
    await act(async () => {
      root.render(<AISGeoJsonMap {...DEFAULT_PROPS} {...props} />);
    });
  };

  it("renders map container and canvas", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await renderMap();

    expect(container.querySelector(".geojson-map-container")).not.toBeNull();
    expect(container.querySelector(".geojson-map-canvas")).not.toBeNull();
  });

  it("does not render AISDataPanel when no vessel is selected", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await renderMap();

    expect(container.querySelector('[data-testid="ais-panel"]')).toBeNull();
  });

  it("creates all draggable anchor markers", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clearMarkers();

    await renderMap();

    const classNames = getCreatedMarkers().map((marker) => marker.className);
    expect(classNames).toEqual([
      "geojson-map-origin-icon",
      "geojson-map-range-icon",
      "geojson-map-heading-icon",
      "geojson-map-fov-icon",
    ]);
  });

  it("toggles marker visibility from editMode prop", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clearMarkers();

    await renderMap({ editMode: false });

    getCreatedMarkers().forEach((entry) => {
      const element = (entry.marker as unknown as { getElement: () => HTMLElement }).getElement();
      expect(element.style.display).toBe("none");
    });

    await renderMap({ editMode: true });

    getCreatedMarkers().forEach((entry) => {
      const element = (entry.marker as unknown as { getElement: () => HTMLElement }).getElement();
      expect(element.style.display).toBe("flex");
    });
  });

  it("re-centers map when ship coordinates change", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await renderMap();
    const mapInstance = await getLatestMapInstance();
    expect(mapInstance).not.toBeNull();

    await renderMap({ shipLat: 64.0, shipLon: 11.0 });

    expect(mapInstance?.panTo).toHaveBeenLastCalledWith([11.0, 64.0], { duration: 350 });
  });

  it("re-applies style when theme changes", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const { useObcPalette } = await import("../../../hooks/useOBCTheme");
    const mockedPalette = vi.mocked(useObcPalette);

    mockedPalette.mockReturnValue("dusk");
    await renderMap();

    const mapInstance = await getLatestMapInstance();
    expect(mapInstance).not.toBeNull();

    mockedPalette.mockReturnValue("day");
    await renderMap();

    expect(mapInstance?.setStyle).toHaveBeenCalled();
  });

  it("triggers onChange when origin marker is dragged", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();
    await renderMap({ onChange });

    await simulateDragTest({
      markerClassName: "geojson-map-origin-icon",
      newLngLat: [10.4, 63.44],
      onChange,
    });

    const payload = getLastOnChangePayload<
      Partial<{
        shipLat: number;
        shipLon: number;
      }>
    >(onChange);
    expect(payload.shipLat).toBeDefined();
    expect(payload.shipLon).toBeDefined();
  });

  it("triggers onChange with offsetMeters when range marker is dragged in wedge mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();
    await renderMap({ shapeMode: "wedge", onChange });

    await simulateDragTest({
      markerClassName: "geojson-map-range-icon",
      newLngLat: [10.4, 63.45],
      onChange,
    });

    const payload = getLastOnChangePayload<Partial<{ offsetMeters: number }>>(onChange);
    expect(payload.offsetMeters).toBeDefined();
  });

  it("triggers onChange with rectLength when range marker is dragged in rect mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();
    await renderMap({ shapeMode: "rect", onChange });

    await simulateDragTest({
      markerClassName: "geojson-map-range-icon",
      newLngLat: [10.4, 63.45],
      onChange,
    });

    const payload = getLastOnChangePayload<Partial<{ rectLength: number }>>(onChange);
    expect(payload.rectLength).toBeDefined();
  });

  it("triggers onChange with heading when heading marker is dragged", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();
    await renderMap({ onChange });

    await simulateDragTest({
      markerClassName: "geojson-map-heading-icon",
      newLngLat: [10.4, 63.45],
      onChange,
    });

    const payload = getLastOnChangePayload<Partial<{ heading: number }>>(onChange);
    expect(payload.heading).toBeDefined();
  });

  it("triggers onChange with fovDegrees when fov marker is dragged in wedge mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();
    await renderMap({ shapeMode: "wedge", onChange });

    await simulateDragTest({
      markerClassName: "geojson-map-fov-icon",
      newLngLat: [10.5, 63.45],
      onChange,
    });

    const payload = getLastOnChangePayload<Partial<{ fovDegrees: number }>>(onChange);
    expect(payload.fovDegrees).toBeDefined();
  });

  it("triggers onChange with rectWidth when fov marker is dragged in rect mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();
    await renderMap({ shapeMode: "rect", onChange });

    await simulateDragTest({
      markerClassName: "geojson-map-fov-icon",
      newLngLat: [10.5, 63.45],
      onChange,
    });

    const payload = getLastOnChangePayload<Partial<{ rectWidth: number }>>(onChange);
    expect(payload.rectWidth).toBeDefined();
  });

  it("handles marker drag interactions without onChange callback", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    clearMarkers();
    await renderMap();

    const originMarker = getCreatedMarkers().find(
      (marker) => marker.className === "geojson-map-origin-icon"
    );
    expect(originMarker).toBeDefined();

    expect(() => {
      originMarker?.marker.setLngLat([10.4, 63.44]);
      originMarker?.marker._trigger("dragstart");
      originMarker?.marker._trigger("drag");
      originMarker?.marker._trigger("dragend");
    }).not.toThrow();
  });
});
