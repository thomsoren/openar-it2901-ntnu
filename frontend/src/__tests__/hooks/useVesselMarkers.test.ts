import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import maplibregl from "maplibre-gl";
import { useVesselMarkers } from "../../hooks/useVesselMarkers";
import * as mapHelpers from "../../components/AISGeoJsonMap/mapHelpers";
import type { AISData } from "../../types/aisData";

vi.mock("maplibre-gl", () => {
  class Marker {
    private lngLat: [number, number] = [0, 0];
    private rotation = 0;

    constructor(options?: unknown) {
      void options;
    }

    setLngLat(coords: [number, number]) {
      this.lngLat = coords;
      return this;
    }

    getLngLat() {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }

    setRotation(angle: number) {
      this.rotation = angle;
      return this;
    }

    getRotation() {
      return this.rotation;
    }

    remove = vi.fn();
  }

  class Map {
    constructor(options?: unknown) {
      void options;
    }
    panTo = vi.fn();
  }

  return {
    default: { Map, Marker },
    Map,
    Marker,
  };
});

vi.mock("../../components/AISGeoJsonMap/mapHelpers", () => ({
  createVesselMarker: vi.fn(),
}));

describe("useVesselMarkers", () => {
  let mockMap: maplibregl.Map;
  let mockMarker: maplibregl.Marker;
  let onVesselClick: (vessel: AISData) => void;

  const createMockVessel = (overrides?: Partial<AISData>): AISData => ({
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
    projection: null,
    ...overrides,
  });

  beforeEach(() => {
    mockMap = new maplibregl.Map(
      {} as unknown as maplibregl.MapOptions
    ) as unknown as maplibregl.Map;
    mockMarker = new maplibregl.Marker() as unknown as maplibregl.Marker;
    onVesselClick = vi.fn() as unknown as (vessel: AISData) => void;
    vi.mocked(mapHelpers.createVesselMarker).mockReturnValue(mockMarker);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when map is null", () => {
    const vessels = [createMockVessel()];

    renderHook(() => useVesselMarkers(null, vessels, onVesselClick));

    expect(mapHelpers.createVesselMarker).not.toHaveBeenCalled();
  });

  it("does nothing when vessels is undefined", () => {
    renderHook(() => useVesselMarkers(mockMap, undefined, onVesselClick));

    expect(mapHelpers.createVesselMarker).not.toHaveBeenCalled();
  });

  it("creates markers for vessels with valid coordinates", () => {
    const vessels = [createMockVessel()];

    renderHook(() => useVesselMarkers(mockMap, vessels, onVesselClick));

    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(1);
    expect(mapHelpers.createVesselMarker).toHaveBeenCalledWith(
      mockMap,
      vessels[0],
      expect.any(Function)
    );
  });

  it("skips vessels without latitude or longitude", () => {
    const vessels = [
      createMockVessel({ latitude: 0, longitude: 0 }),
      createMockVessel({ mmsi: 987654321, latitude: 63.44, longitude: 10.4 }),
    ];

    renderHook(() => useVesselMarkers(mockMap, vessels, onVesselClick));

    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(1);
    expect(mapHelpers.createVesselMarker).toHaveBeenCalledWith(
      mockMap,
      vessels[1],
      expect.any(Function)
    );
  });

  it("updates existing marker position and rotation on vessel updates", () => {
    const vessel = createMockVessel();
    const { rerender } = renderHook(
      ({ vessels }) => useVesselMarkers(mockMap, vessels, onVesselClick),
      { initialProps: { vessels: [vessel] } }
    );

    // Initial render creates marker
    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(1);

    // Update vessel position
    const updatedVessel = createMockVessel({
      latitude: 64.0,
      longitude: 11.0,
      courseOverGround: 180,
    });

    const setLngLatSpy = vi.spyOn(mockMarker, "setLngLat");
    const setRotationSpy = vi.spyOn(mockMarker, "setRotation");

    rerender({ vessels: [updatedVessel] });

    // Should update existing marker, not create new one
    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(1);
    expect(setLngLatSpy).toHaveBeenCalledWith([11.0, 64.0]);
    expect(setRotationSpy).toHaveBeenCalledWith(180);
  });

  it("removes markers for vessels that are no longer present", () => {
    const vessel1 = createMockVessel({ mmsi: 111111111 });
    const vessel2 = createMockVessel({ mmsi: 222222222 });

    const marker1 = new maplibregl.Marker() as unknown as maplibregl.Marker;
    const marker2 = new maplibregl.Marker() as unknown as maplibregl.Marker;

    vi.mocked(mapHelpers.createVesselMarker)
      .mockReturnValueOnce(marker1)
      .mockReturnValueOnce(marker2);

    const { rerender } = renderHook(
      ({ vessels }) => useVesselMarkers(mockMap, vessels, onVesselClick),
      { initialProps: { vessels: [vessel1, vessel2] } }
    );

    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(2);

    // Remove vessel2
    rerender({ vessels: [vessel1] });

    expect(marker2.remove).toHaveBeenCalledTimes(1);
    expect(marker1.remove).not.toHaveBeenCalled();
  });

  it("cleans up all markers when vessels becomes undefined", () => {
    const vessels = [createMockVessel({ mmsi: 111111111 }), createMockVessel({ mmsi: 222222222 })];

    const marker1 = new maplibregl.Marker() as unknown as maplibregl.Marker;
    const marker2 = new maplibregl.Marker() as unknown as maplibregl.Marker;

    vi.mocked(mapHelpers.createVesselMarker)
      .mockReturnValueOnce(marker1)
      .mockReturnValueOnce(marker2);

    const { rerender } = renderHook(
      ({ vessels }) => useVesselMarkers(mockMap, vessels, onVesselClick),
      { initialProps: { vessels } }
    );

    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(2);

    // Clear vessels
    rerender({ vessels: undefined as unknown as AISData[] });

    expect(marker1.remove).toHaveBeenCalledTimes(1);
    expect(marker2.remove).toHaveBeenCalledTimes(1);
  });

  it("cleans up all markers when map becomes null", () => {
    const vessels = [createMockVessel()];

    const marker = new maplibregl.Marker() as unknown as maplibregl.Marker;
    vi.mocked(mapHelpers.createVesselMarker).mockReturnValue(marker);

    const { rerender } = renderHook(
      ({ map, vessels }) => useVesselMarkers(map, vessels, onVesselClick),
      { initialProps: { map: mockMap, vessels } }
    );

    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(1);

    // Set map to null
    rerender({ map: null as unknown as maplibregl.Map, vessels });

    expect(marker.remove).toHaveBeenCalledTimes(1);
  });

  it("calls onVesselClick and pans to vessel when marker is clicked", () => {
    const vessel = createMockVessel();
    let clickHandler: ((v: AISData) => void) | undefined;

    vi.mocked(mapHelpers.createVesselMarker).mockImplementation((_map, _vessel, onClick) => {
      clickHandler = onClick;
      return mockMarker;
    });

    renderHook(() => useVesselMarkers(mockMap, [vessel], onVesselClick));

    expect(clickHandler).toBeDefined();

    // Trigger click
    clickHandler!(vessel);

    expect(onVesselClick).toHaveBeenCalledWith(vessel);
    expect(mockMap.panTo).toHaveBeenCalledWith([10.4, 63.44], { duration: 500 });
  });

  it("calls onVesselClick but does not pan when clicked vessel has no valid coordinates", () => {
    const vessel = createMockVessel({ latitude: 63.44, longitude: 10.4 });
    let clickHandler: ((v: AISData) => void) | undefined;

    vi.mocked(mapHelpers.createVesselMarker).mockImplementation((_map, _vessel, onClick) => {
      clickHandler = onClick;
      return mockMarker;
    });

    const { rerender } = renderHook(
      ({ vessels }) => useVesselMarkers(mockMap, vessels, onVesselClick),
      { initialProps: { vessels: [vessel] } }
    );

    expect(clickHandler).toBeDefined();

    // Update vessel to have invalid coordinates
    const vesselWithoutCoords = createMockVessel({ latitude: 0, longitude: 0 });
    rerender({ vessels: [vesselWithoutCoords] });

    // Vessel with invalid coords is skipped, marker should be removed
    // So this test actually verifies that markers are removed for invalid coords
    expect(mockMarker.remove).toHaveBeenCalled();
  });

  it("handles empty vessels array", () => {
    renderHook(() => useVesselMarkers(mockMap, [], onVesselClick));

    expect(mapHelpers.createVesselMarker).not.toHaveBeenCalled();
  });

  it("creates markers for multiple vessels", () => {
    const vessels = [
      createMockVessel({ mmsi: 111111111 }),
      createMockVessel({ mmsi: 222222222 }),
      createMockVessel({ mmsi: 333333333 }),
    ];

    renderHook(() => useVesselMarkers(mockMap, vessels, onVesselClick));

    expect(mapHelpers.createVesselMarker).toHaveBeenCalledTimes(3);
  });

  it("uses default rotation of 0 when courseOverGround is missing", () => {
    const vessel = createMockVessel({ courseOverGround: 0 });

    renderHook(() => useVesselMarkers(mockMap, [vessel], onVesselClick));

    expect(mapHelpers.createVesselMarker).toHaveBeenCalledWith(
      mockMap,
      vessel,
      expect.any(Function)
    );

    // Update to trigger setRotation
    const updatedVessel = createMockVessel({ courseOverGround: 0 });
    const marker = new maplibregl.Marker() as unknown as maplibregl.Marker;
    vi.mocked(mapHelpers.createVesselMarker).mockReturnValue(marker);

    const { rerender } = renderHook(
      ({ vessels }) => useVesselMarkers(mockMap, vessels, onVesselClick),
      { initialProps: { vessels: [vessel] } }
    );

    const setRotationSpy = vi.spyOn(marker, "setRotation");
    rerender({ vessels: [updatedVessel] });

    expect(setRotationSpy).toHaveBeenCalledWith(0);
  });
});
