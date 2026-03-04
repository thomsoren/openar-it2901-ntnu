import { act } from "react";
import { vi, expect } from "vitest";
import * as mapHelpers from "../../../components/AISGeoJsonMap/mapHelpers";

export interface TestMarkerObject {
  className: string;
  marker: {
    setLngLat: (coords: [number, number]) => void;
    _trigger: (event: string) => void;
  };
}

export interface AISGeoJsonMapProps {
  shipLat: number;
  shipLon: number;
  heading: number;
  offsetMeters: number;
  fovDegrees: number;
  shapeMode: "wedge" | "rect";
  rectLength: number;
  rectWidth: number;
  onChange?: (changes: Record<string, unknown>) => void;
  vessels?: unknown[];
}

interface MockedMaplibreGl {
  default: {
    _getMapInstances?: () => object[];
  };
}

interface MockedMapHelpers {
  _getCreatedMarkers?: () => TestMarkerObject[];
  _clearMarkers?: () => void;
}

export function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const button = buttons.find((element) => element.textContent === label);
  if (!button) {
    throw new Error(`Button with label "${label}" was not found`);
  }
  return button as HTMLButtonElement;
}

export async function triggerMapLoadEvent() {
  const maplibregl = (await import("maplibre-gl")) as MockedMaplibreGl;
  const mapInstances = maplibregl.default._getMapInstances?.() || [];
  const mapInstance = mapInstances[mapInstances.length - 1] as {
    _trigger: (event: string) => void;
  };
  if (mapInstance) {
    mapInstance._trigger("load");
  }
}

export function getCreatedMarkers(): TestMarkerObject[] {
  const helpers = mapHelpers as unknown as MockedMapHelpers;
  return helpers._getCreatedMarkers?.() || [];
}

export function clearMarkers() {
  const helpers = mapHelpers as unknown as MockedMapHelpers;
  helpers._clearMarkers?.();
}

export async function simulateDragTest(options: {
  markerClassName: string;
  newLngLat: [number, number];
  onChange: ReturnType<typeof vi.fn>;
}) {
  // Trigger map load event to initialize markers
  await triggerMapLoadEvent();

  const markers = getCreatedMarkers();
  const marker = markers.find((m) => m.className === options.markerClassName);

  expect(marker).toBeDefined();
  if (marker) {
    // Simulate drag
    await act(async () => {
      marker.marker.setLngLat(options.newLngLat);
      marker.marker._trigger("dragstart");
      marker.marker._trigger("drag");
      marker.marker._trigger("dragend");
    });

    expect(options.onChange).toHaveBeenCalled();
  }
}
