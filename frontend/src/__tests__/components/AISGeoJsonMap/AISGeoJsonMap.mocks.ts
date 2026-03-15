import React from "react";
import { vi } from "vitest";

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

  setDraggable(draggable: boolean) {
    void draggable;
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

const mapInstances: MapLibreMap[] = [];

class MapLibreMap {
  private eventHandlers: { [key: string]: (() => void)[] } = {};
  panTo = vi.fn(() => this);
  setStyle = vi.fn(() => this);

  constructor() {
    mapInstances.push(this);
  }

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

vi.mock("maplibre-gl", () => ({
  default: { Map: MapLibreMap, Marker, Popup, _getMapInstances: () => mapInstances },
  Map: MapLibreMap,
  Marker,
  Popup,
}));

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
  AISDataPanel: ({
    selectedIndex,
    onIconClick,
  }: {
    selectedIndex?: number;
    onIconClick?: () => void;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "ais-panel", "data-index": String(selectedIndex ?? "") },
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "ais-panel-icon",
          onClick: () => onIconClick?.(),
        },
        "focus vessel"
      )
    ),
}));

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button",
  () => ({
    ObcButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
      React.createElement("button", { type: "button", onClick }, children),
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
    ObiPlaceholderDeviceStatic: () => React.createElement("span", { "data-testid": "anchor-icon" }),
  })
);
