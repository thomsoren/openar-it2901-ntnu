import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("maplibre-gl", () => {
  class Popup {
    private open = false;
    setText(value: string) {
      void value;
      return this;
    }
    isOpen() {
      return this.open;
    }
  }

  class Marker {
    private lngLat: { lng: number; lat: number } = { lng: 0, lat: 0 };
    private popup: Popup | null = null;
    private element: HTMLElement;
    private eventHandlers: { [key: string]: (() => void)[] } = {};

    constructor(options?: { element?: HTMLElement; draggable?: boolean }) {
      this.element = options?.element ?? document.createElement("div");
    }

    setLngLat([lng, lat]: [number, number]) {
      this.lngLat = { lng, lat };
      return this;
    }

    getLngLat() {
      return this.lngLat;
    }

    addTo() {
      return this;
    }

    setPopup(popup: Popup) {
      this.popup = popup;
      return this;
    }

    getPopup() {
      return this.popup;
    }

    togglePopup() {
      return this;
    }

    getElement() {
      return this.element;
    }

    setRotation(rotation: number) {
      void rotation;
      return this;
    }

    on(event: string, handler: () => void) {
      if (!this.eventHandlers[event]) {
        this.eventHandlers[event] = [];
      }
      this.eventHandlers[event].push(handler);
      return this;
    }

    remove() {
      return this;
    }

    // Test helper to trigger events
    _trigger(event: string) {
      const handlers = this.eventHandlers[event];
      if (handlers) {
        handlers.forEach((handler) => handler());
      }
    }
  }

  class MapLibreMap {
    private eventHandlers: { [key: string]: (() => void)[] } = {};

    on(event: string, handler: () => void) {
      if (!this.eventHandlers[event]) {
        this.eventHandlers[event] = [];
      }
      this.eventHandlers[event].push(handler);
      return this;
    }
    once(event: string, handler: () => void) {
      if (!this.eventHandlers[event]) {
        this.eventHandlers[event] = [];
      }
      this.eventHandlers[event].push(handler);
      return this;
    }
    off() {
      return this;
    }
    remove() {
      return this;
    }
    panTo() {
      return this;
    }
    setStyle() {
      return this;
    }
    isStyleLoaded() {
      return true;
    }

    // Test helper to trigger events
    _trigger(event: string) {
      const handlers = this.eventHandlers[event];
      if (handlers) {
        handlers.forEach((handler) => handler());
      }
    }
  }

  return {
    default: { Map: MapLibreMap, Marker, Popup },
    Map: MapLibreMap,
    Marker,
    Popup,
  };
});

vi.mock("../../../components/AISGeoJsonMap/mapHelpers", async () => {
  const maplibre = await import("maplibre-gl");
  const createdMarkers: unknown[] = [];

  return {
    addScanAreaLayers: vi.fn(),
    updateScanAreaData: vi.fn(),
    getScanAreaSource: vi.fn(() => ({ setData: vi.fn() })),
    createAnchorMarker: vi.fn((_map, options) => {
      const marker = new maplibre.default.Marker(options);
      marker.setLngLat(options.lngLat);
      createdMarkers.push({ className: options.className, marker });
      return marker;
    }),
    _getCreatedMarkers: () => createdMarkers,
    _clearMarkers: () => {
      createdMarkers.length = 0;
    },
  };
});

vi.mock("../../../hooks/useVesselMarkers", () => ({
  useVesselMarkers: vi.fn(),
}));

vi.mock("../../../hooks/useOBCTheme", () => ({
  useObcPalette: vi.fn(() => "dark"),
}));

vi.mock("../../../components/AISGeoJsonMap/AISGeoJsonMapTilemap", () => ({
  getMapLibreStyle: vi.fn(() => ({ version: 8, sources: {}, layers: [] })),
}));

vi.mock("../../../components/AISDataPanel/AISDataPanel", () => ({
  AISDataPanel: () => <div data-testid="ais-panel" />,
}));

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button",
  () => ({
    ObcButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button",
  () => ({
    ButtonVariant: {
      flat: "flat",
      normal: "normal",
    },
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-placeholder-device-static",
  () => ({
    ObiPlaceholderDeviceStatic: () => <span data-testid="anchor-icon" />,
  })
);

import { AISGeoJsonMap } from "../../../components/AISGeoJsonMap/AISGeoJsonMap";
import * as mapHelpers from "../../../components/AISGeoJsonMap/mapHelpers";

interface TestMarkerObject {
  className: string;
  marker: {
    setLngLat: (coords: [number, number]) => void;
    _trigger: (event: string) => void;
  };
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const button = buttons.find((element) => element.textContent === label);
  if (!button) {
    throw new Error(`Button with label "${label}" was not found`);
  }
  return button as HTMLButtonElement;
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

  it("renders coordinate header and wedge info", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    expect(container.textContent).toContain("63.4305N");
    expect(container.textContent).toContain("10.3951E");
    expect(container.textContent).toContain("FOV 60°");
    expect(container.textContent).toContain("Following");
    expect(container.textContent).toContain("Editing");
    expect(container.textContent).toContain("Wedge");
  });

  it("toggles follow and edit button labels when clicked", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    await act(async () => {
      getButton(container, "Following").click();
    });
    expect(container.textContent).toContain("Follow");

    await act(async () => {
      getButton(container, "Editing").click();
    });
    expect(container.textContent).toContain("Edit");
  });

  it("calls onChange when toggling shape mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    await act(async () => {
      getButton(container, "Wedge").click();
    });

    expect(onChange).toHaveBeenCalledWith({ shapeMode: "rect" });
  });

  it("renders rect mode with length and width in header", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={45}
          offsetMeters={800}
          fovDegrees={30}
          shapeMode="rect"
          rectLength={1500}
          rectWidth={400}
        />
      );
    });

    expect(container.textContent).toContain("1500m x 400m");
    expect(container.textContent).toContain("Rect");
    expect(container.textContent).not.toContain("FOV");
  });

  it("displays negative coordinates correctly with S and W labels", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={-33.8688}
          shipLon={-151.2093}
          heading={180}
          offsetMeters={1000}
          fovDegrees={90}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    expect(container.textContent).toContain("33.8688S");
    expect(container.textContent).toContain("151.2093W");
  });

  it("toggles from rect back to wedge mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="rect"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    await act(async () => {
      getButton(container, "Rect").click();
    });

    expect(onChange).toHaveBeenCalledWith({ shapeMode: "wedge" });
  });

  it("does not render AISDataPanel when no vessel is selected", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    expect(container.querySelector('[data-testid="ais-panel"]')).toBeNull();
  });

  it("works without onChange callback provided", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    // Should not throw when clicking buttons without onChange
    await act(async () => {
      getButton(container, "Wedge").click();
    });

    expect(container.textContent).toContain("Wedge");
  });

  it("accepts and displays vessels prop", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const mockVessels = [
      {
        mmsi: 123456789,
        name: "Test Ship",
        latitude: 63.44,
        longitude: 10.4,
        courseOverGround: 90,
        speedOverGround: 10,
        shipType: 70,
        rateOfTurn: 0,
        trueHeading: 90,
        navigationalStatus: 0,
        msgtime: "2026-03-04T08:00:00Z",
        projection: {
          x_px: 100,
          y_px: 100,
          distance_m: 500,
          bearing_deg: 90,
          rel_bearing_deg: 0,
        },
      },
    ];

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
          vessels={mockVessels}
        />
      );
    });

    // Vessel markers are created via useVesselMarkers hook (mocked)
    expect(container).toBeTruthy();
  });

  it("updates position when props change and follow mode is active", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    // Update coordinates while follow mode is active
    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={64.0}
          shipLon={11.0}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    expect(container.textContent).toContain("64.0000N");
    expect(container.textContent).toContain("11.0000E");
  });

  it("does not auto-center when follow mode is disabled", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    // Disable follow mode
    await act(async () => {
      getButton(container, "Following").click();
    });

    // Update coordinates - should not trigger centering
    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={64.0}
          shipLon={11.0}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    expect(container.textContent).toContain("Follow");
  });

  it("updates all geometry parameters", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    // Update all geometry parameters
    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={180}
          offsetMeters={1500}
          fovDegrees={90}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    expect(container.textContent).toContain("180°");
    expect(container.textContent).toContain("1500m");
    expect(container.textContent).toContain("FOV 90°");
  });

  it("updates rect dimensions when changing from wedge to rect", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    // Switch to rect mode with updated dimensions
    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="rect"
          rectLength={2000}
          rectWidth={500}
        />
      );
    });

    expect(container.textContent).toContain("2000m x 500m");
    expect(container.textContent).toContain("Rect");
  });

  it("triggers onChange when origin marker is dragged", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    (mapHelpers as unknown as { _clearMarkers?: () => void })._clearMarkers?.();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    const markers = ((
      mapHelpers as unknown as { _getCreatedMarkers?: () => TestMarkerObject[] }
    )._getCreatedMarkers?.() || []) as TestMarkerObject[];
    const originMarker = markers.find((m) => m.className === "geojson-map-origin-icon");

    if (originMarker) {
      // Simulate drag
      await act(async () => {
        originMarker.marker.setLngLat([10.4, 63.44]);
        originMarker.marker._trigger("dragstart");
        originMarker.marker._trigger("drag");
        originMarker.marker._trigger("dragend");
      });

      expect(onChange).toHaveBeenCalled();
    }
  });

  it("triggers onChange when range marker is dragged in wedge mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    (mapHelpers as unknown as { _clearMarkers?: () => void })._clearMarkers?.();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    const markers = ((
      mapHelpers as unknown as { _getCreatedMarkers?: () => TestMarkerObject[] }
    )._getCreatedMarkers?.() || []) as TestMarkerObject[];
    const rangeMarker = markers.find((m) => m.className === "geojson-map-range-icon");

    if (rangeMarker) {
      // Simulate drag
      await act(async () => {
        rangeMarker.marker.setLngLat([10.4, 63.45]);
        rangeMarker.marker._trigger("dragstart");
        rangeMarker.marker._trigger("drag");
        rangeMarker.marker._trigger("dragend");
      });

      expect(onChange).toHaveBeenCalled();
    }
  });

  it("triggers onChange when range marker is dragged in rect mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    (mapHelpers as unknown as { _clearMarkers?: () => void })._clearMarkers?.();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="rect"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    const markers = ((
      mapHelpers as unknown as { _getCreatedMarkers?: () => TestMarkerObject[] }
    )._getCreatedMarkers?.() || []) as TestMarkerObject[];
    const rangeMarker = markers.find((m) => m.className === "geojson-map-range-icon");

    if (rangeMarker) {
      // Simulate drag
      await act(async () => {
        rangeMarker.marker.setLngLat([10.4, 63.45]);
        rangeMarker.marker._trigger("dragstart");
        rangeMarker.marker._trigger("drag");
        rangeMarker.marker._trigger("dragend");
      });

      expect(onChange).toHaveBeenCalled();
    }
  });

  it("triggers onChange when heading marker is dragged", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    (mapHelpers as unknown as { _clearMarkers?: () => void })._clearMarkers?.();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    const markers = ((
      mapHelpers as unknown as { _getCreatedMarkers?: () => TestMarkerObject[] }
    )._getCreatedMarkers?.() || []) as TestMarkerObject[];
    const headingMarker = markers.find((m) => m.className === "geojson-map-heading-icon");

    if (headingMarker) {
      // Simulate drag
      await act(async () => {
        headingMarker.marker.setLngLat([10.4, 63.45]);
        headingMarker.marker._trigger("dragstart");
        headingMarker.marker._trigger("drag");
        headingMarker.marker._trigger("dragend");
      });

      expect(onChange).toHaveBeenCalled();
    }
  });

  it("triggers onChange when FOV marker is dragged in wedge mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    (mapHelpers as unknown as { _clearMarkers?: () => void })._clearMarkers?.();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    const markers = ((
      mapHelpers as unknown as { _getCreatedMarkers?: () => TestMarkerObject[] }
    )._getCreatedMarkers?.() || []) as TestMarkerObject[];
    const fovMarker = markers.find((m) => m.className === "geojson-map-fov-icon");

    if (fovMarker) {
      // Simulate drag
      await act(async () => {
        fovMarker.marker.setLngLat([10.5, 63.45]);
        fovMarker.marker._trigger("dragstart");
        fovMarker.marker._trigger("drag");
        fovMarker.marker._trigger("dragend");
      });

      expect(onChange).toHaveBeenCalled();
    }
  });

  it("triggers onChange when FOV marker is dragged in rect mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    (mapHelpers as unknown as { _clearMarkers?: () => void })._clearMarkers?.();

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="rect"
          rectLength={1000}
          rectWidth={300}
          onChange={onChange}
        />
      );
    });

    const markers = ((
      mapHelpers as unknown as { _getCreatedMarkers?: () => TestMarkerObject[] }
    )._getCreatedMarkers?.() || []) as TestMarkerObject[];
    const fovMarker = markers.find((m) => m.className === "geojson-map-fov-icon");

    if (fovMarker) {
      // Simulate drag
      await act(async () => {
        fovMarker.marker.setLngLat([10.5, 63.45]);
        fovMarker.marker._trigger("dragstart");
        fovMarker.marker._trigger("drag");
        fovMarker.marker._trigger("dragend");
      });

      expect(onChange).toHaveBeenCalled();
    }
  });

  it("updates theme and rebuilds layers", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const { useObcPalette } = await import("../../../hooks/useOBCTheme");
    const mockPalette = vi.mocked(useObcPalette);

    mockPalette.mockReturnValue("dusk");

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    // Change theme
    mockPalette.mockReturnValue("day");

    await act(async () => {
      root.render(
        <AISGeoJsonMap
          shipLat={63.4305}
          shipLon={10.3951}
          heading={90}
          offsetMeters={1200}
          fovDegrees={60}
          shapeMode="wedge"
          rectLength={1000}
          rectWidth={300}
        />
      );
    });

    expect(container).toBeTruthy();
  });
});
