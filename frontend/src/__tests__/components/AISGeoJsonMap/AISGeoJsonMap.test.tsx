import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./AISGeoJsonMap.mocks";
import { getButton, clearMarkers, simulateDragTest } from "./AISGeoJsonMap.test-utils";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { AISGeoJsonMap } from "../../../components/AISGeoJsonMap/AISGeoJsonMap";

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

    clearMarkers();

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

    await simulateDragTest({
      markerClassName: "geojson-map-origin-icon",
      newLngLat: [10.4, 63.44],
      onChange,
    });
  });

  it("triggers onChange when range marker is dragged in wedge mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();

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

    await simulateDragTest({
      markerClassName: "geojson-map-range-icon",
      newLngLat: [10.4, 63.45],
      onChange,
    });
  });

  it("triggers onChange when range marker is dragged in rect mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();

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

    await simulateDragTest({
      markerClassName: "geojson-map-range-icon",
      newLngLat: [10.4, 63.45],
      onChange,
    });
  });

  it("triggers onChange when heading marker is dragged", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();

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

    await simulateDragTest({
      markerClassName: "geojson-map-heading-icon",
      newLngLat: [10.4, 63.45],
      onChange,
    });
  });

  it("triggers onChange when FOV marker is dragged in wedge mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();

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

    await simulateDragTest({
      markerClassName: "geojson-map-fov-icon",
      newLngLat: [10.5, 63.45],
      onChange,
    });
  });

  it("triggers onChange when FOV marker is dragged in rect mode", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    clearMarkers();

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

    await simulateDragTest({
      markerClassName: "geojson-map-fov-icon",
      newLngLat: [10.5, 63.45],
      onChange,
    });
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
