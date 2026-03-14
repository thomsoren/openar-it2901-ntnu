import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useFetchAISGeographicalDataMock = vi.hoisted(() =>
  vi.fn(() => ({
    features: [{ mmsi: 111 }],
  }))
);

type MapUpdates = Partial<{
  shipLat: number;
  shipLon: number;
  heading: number;
  shapeMode: "wedge" | "rect";
  rectLength: number;
  rectWidth: number;
}>;

interface MockAisGeoJsonMapProps {
  onChange?: (updates: MapUpdates) => void;
  [key: string]: unknown;
}

interface MockAisMapParameterPanelProps {
  settings: unknown;
  isLoadingGPS: boolean;
  onUseGPSLocation: () => void;
  onSettingsChange: (updates: {
    shipLat?: number;
    shipLon?: number;
    iconSet?: "detailed";
    editMode?: boolean;
  }) => void;
}

vi.mock("../../hooks/useFetchAISGeographicalData", () => ({
  useFetchAISGeographicalData: useFetchAISGeographicalDataMock,
}));

vi.mock("../../components/AISGeoJsonMap/AISGeoJsonMap", () => ({
  AISGeoJsonMap: ({ onChange, ...props }: MockAisGeoJsonMapProps) => (
    <div data-testid="ais-map">
      <div data-testid="map-props">{JSON.stringify(props)}</div>
      <button
        type="button"
        onClick={() => onChange?.({ shipLat: 64.123456789, shipLon: 11.987654321 })}
      >
        map-update-position
      </button>
      <button
        type="button"
        onClick={() =>
          onChange?.({ heading: 45, shapeMode: "rect", rectLength: 2222, rectWidth: 555 })
        }
      >
        map-update-geometry
      </button>
    </div>
  ),
}));

vi.mock("../../components/AISMapParameterPanel/AISMapParameterPanel", () => ({
  AISMapParameterPanel: ({
    settings,
    isLoadingGPS,
    onUseGPSLocation,
    onSettingsChange,
  }: MockAisMapParameterPanelProps) => (
    <div data-testid="ais-panel">
      <div data-testid="panel-settings">{JSON.stringify(settings)}</div>
      <div data-testid="panel-loading">{isLoadingGPS ? "loading" : "idle"}</div>
      <button
        type="button"
        onClick={() =>
          onSettingsChange({
            shipLat: 63.999999999,
            shipLon: 10.111111111,
            iconSet: "detailed",
            editMode: true,
          })
        }
      >
        panel-update-settings
      </button>
      <button type="button" onClick={onUseGPSLocation}>
        panel-use-gps
      </button>
    </div>
  ),
}));

import Ais from "../../pages/Ais";

type MockGeolocationSuccess = (position: {
  coords: { latitude: number; longitude: number };
}) => void;
type MockGeolocationError = (error: unknown) => void;

function getJsonFromTestId<TData>(testId: string): TData {
  return JSON.parse(screen.getByTestId(testId).textContent ?? "{}") as TData;
}

describe("Ais page", () => {
  let successCallback: MockGeolocationSuccess | null = null;
  let errorCallback: MockGeolocationError | null = null;
  let getCurrentPositionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    successCallback = null;
    errorCallback = null;

    getCurrentPositionMock = vi.fn(
      (success: MockGeolocationSuccess, error: MockGeolocationError) => {
        successCallback = success;
        errorCallback = error;
      }
    );

    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: getCurrentPositionMock,
      },
    });
  });

  it("passes initial state to map, panel, and fetch hook", () => {
    render(<Ais />);

    const mapProps = getJsonFromTestId<{
      shipLat: number;
      shipLon: number;
      heading: number;
      offsetMeters: number;
      fovDegrees: number;
      shapeMode: "wedge" | "rect";
      rectLength: number;
      rectWidth: number;
      editMode: boolean;
      iconSet: string;
      vessels: unknown[];
    }>("map-props");

    const panelSettings = getJsonFromTestId<{
      shipLat: number;
      shipLon: number;
      heading: number;
      offsetMeters: number;
      fovDegrees: number;
      shapeMode: "wedge" | "rect";
      rectLength: number;
      rectWidth: number;
      editMode: boolean;
      iconSet: string;
    }>("panel-settings");

    expect(mapProps.shipLat).toBe(63.4365);
    expect(mapProps.shipLon).toBe(10.3835);
    expect(mapProps.shapeMode).toBe("wedge");
    expect(mapProps.vessels).toEqual([{ mmsi: 111 }]);

    expect(panelSettings.shipLat).toBe(63.4365);
    expect(panelSettings.shipLon).toBe(10.3835);
    expect(panelSettings.editMode).toBe(false);
    expect(panelSettings.iconSet).toBe("generic");

    expect(useFetchAISGeographicalDataMock).toHaveBeenCalledWith(
      true,
      63.4365,
      10.3835,
      0,
      1000,
      60,
      "wedge",
      1000,
      600
    );
  });

  it("applies panel updates to map state with coordinate clamping", () => {
    render(<Ais />);

    fireEvent.click(screen.getByRole("button", { name: "panel-update-settings" }));

    const mapProps = getJsonFromTestId<{
      shipLat: number;
      shipLon: number;
      iconSet: string;
      editMode: boolean;
    }>("map-props");

    expect(mapProps.shipLat).toBe(64);
    expect(mapProps.shipLon).toBe(10.111111);
    expect(mapProps.iconSet).toBe("detailed");
    expect(mapProps.editMode).toBe(true);

    expect(useFetchAISGeographicalDataMock).toHaveBeenLastCalledWith(
      true,
      64,
      10.111111,
      0,
      1000,
      60,
      "wedge",
      1000,
      600
    );
  });

  it("applies map onChange updates back to panel settings", () => {
    render(<Ais />);

    fireEvent.click(screen.getByRole("button", { name: "map-update-position" }));
    fireEvent.click(screen.getByRole("button", { name: "map-update-geometry" }));

    const panelSettings = getJsonFromTestId<{
      shipLat: number;
      shipLon: number;
      heading: number;
      shapeMode: "wedge" | "rect";
      rectLength: number;
      rectWidth: number;
    }>("panel-settings");

    expect(panelSettings.shipLat).toBe(64.123457);
    expect(panelSettings.shipLon).toBe(11.987654);
    expect(panelSettings.heading).toBe(45);
    expect(panelSettings.shapeMode).toBe("rect");
    expect(panelSettings.rectLength).toBe(2222);
    expect(panelSettings.rectWidth).toBe(555);
  });

  it("handles GPS success and failure while toggling loading state", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<Ais />);

    fireEvent.click(screen.getByRole("button", { name: "panel-use-gps" }));

    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("panel-loading").textContent).toBe("loading");

    act(() => {
      successCallback?.({
        coords: {
          latitude: 63.123456789,
          longitude: 10.987654321,
        },
      });
    });

    let panelSettings = getJsonFromTestId<{
      shipLat: number;
      shipLon: number;
    }>("panel-settings");

    expect(panelSettings.shipLat).toBe(63.123457);
    expect(panelSettings.shipLon).toBe(10.987654);
    expect(screen.getByTestId("panel-loading").textContent).toBe("idle");

    fireEvent.click(screen.getByRole("button", { name: "panel-use-gps" }));

    act(() => {
      errorCallback?.({ message: "Permission denied" });
    });

    panelSettings = getJsonFromTestId<{
      shipLat: number;
      shipLon: number;
    }>("panel-settings");

    expect(panelSettings.shipLat).toBe(63.123457);
    expect(panelSettings.shipLon).toBe(10.987654);
    expect(screen.getByTestId("panel-loading").textContent).toBe("idle");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
