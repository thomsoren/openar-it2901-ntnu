import { act, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AISData } from "../../../types/aisData";

const distanceToMock = vi.hoisted(() => vi.fn(() => 1234.4));
const getVesselIconMock = vi.hoisted(() => vi.fn((shipType: number) => `Icon ${shipType}`));

vi.mock("../../../utils/geometryMath", () => ({
  distanceTo: distanceToMock,
}));

vi.mock("../../../utils/vesselIconMapper", () => ({
  default: getVesselIconMock,
}));

vi.mock("../../../components/DirectionalVesselIcon/DirectionalVesselIcon", () => ({
  DirectionalVesselIcon: ({ vessel }: { vessel: AISData }) => (
    <div data-testid="directional-vessel-icon">Directional icon {vessel.mmsi}</div>
  ),
}));

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-card/poi-card",
  async () => {
    const React = await import("react");

    interface MockPoiCardProps {
      cardTitle?: unknown;
      description?: unknown;
      source?: unknown;
      timestamp?: unknown;
      headerVariant?: unknown;
      hasCloseButton?: unknown;
      index?: unknown;
      children?: ReactNode;
      [key: string]: unknown;
    }

    const ObcPoiCard = React.forwardRef<HTMLDivElement, MockPoiCardProps>(
      (
        {
          cardTitle,
          description,
          source,
          timestamp,
          headerVariant,
          index,
          children,
          hasCloseButton: _hasCloseButton, // eslint-disable-line @typescript-eslint/no-unused-vars
          ...rest
        },
        ref
      ) => (
        <div
          ref={ref}
          data-testid="obc-poi-card"
          data-source={String(source)}
          data-timestamp={String(timestamp)}
          data-header-variant={String(headerVariant)}
          data-index={String(index)}
          {...rest}
        >
          <div>{String(cardTitle)}</div>
          <div>{String(description)}</div>
          <div>{String(source)}</div>
          <div>{String(timestamp)}</div>
          {children as ReactNode}
        </div>
      )
    );

    return { ObcPoiCard };
  }
);

vi.mock("@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-card/poi-card", () => ({
  ObcPoiCard: class MockObcPoiCard extends HTMLElement {},
  ObcPoiCardHeaderVariant: {
    Detailed: "Detailed",
  },
}));

import { AISDataPanel } from "../../../components/AISDataPanel/AISDataPanel";

function createVessel(overrides: Partial<AISData> = {}): AISData {
  return {
    courseOverGround: 87,
    latitude: 63.4305,
    longitude: 10.3951,
    name: "Test Vessel",
    rateOfTurn: -4.2,
    shipType: 70,
    speedOverGround: 12.3,
    trueHeading: 91,
    navigationalStatus: 5,
    mmsi: 257123456,
    msgtime: "2026-03-12T11:30:00.000Z",
    projection: null,
    ...overrides,
  };
}

describe("AISDataPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T12:00:00.000Z"));
    distanceToMock.mockReturnValue(1234.4);
    getVesselIconMock.mockImplementation((shipType: number) => `Icon ${shipType}`);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders vessel details, formatted metrics, and icon content when AIS data is enabled", () => {
    const vessel = createVessel();

    const { container } = render(
      <AISDataPanel
        vessel={vessel}
        originVessel={{ latitude: 63.44, longitude: 10.41 }}
        onClose={vi.fn()}
        useAISData
      />
    );

    expect(screen.getByTestId("obc-poi-card").getAttribute("data-source")).toBe("AIS");
    expect(screen.getByText("Test Vessel")).toBeDefined();
    expect(screen.getByText("MMSI 257123456")).toBeDefined();
    expect(screen.getByText("30 min ago")).toBeDefined();
    expect(screen.getByText("Icon 70")).toBeDefined();
    expect(screen.getByTestId("directional-vessel-icon").textContent).toContain("257123456");
    expect(container.textContent).toContain("87");
    expect(container.textContent).toContain("1234");
    expect(container.textContent).toContain("-4.2");
    expect(container.textContent).toContain("91");
    expect(container.textContent).toContain("12.3");
    expect(distanceToMock).toHaveBeenCalledWith(63.4305, 10.3951, 63.44, 10.41);
    expect(getVesselIconMock).toHaveBeenCalledWith(70);
  });

  it("uses fallback labels and metric placeholders when vessel data is incomplete", () => {
    const vessel = createVessel({
      courseOverGround: Number.NaN,
      name: "",
      mmsi: 0,
      msgtime: "not-a-date",
      rateOfTurn: undefined as unknown as number,
      speedOverGround: null as unknown as number,
      trueHeading: Number.POSITIVE_INFINITY,
    });

    const { container } = render(
      <AISDataPanel
        vessel={vessel}
        originVessel={{ latitude: 63.44, longitude: 10.41 }}
        onClose={vi.fn()}
        useAISData
      />
    );

    expect(screen.getByText("Unknown vessel")).toBeDefined();
    expect(screen.getByText("MMSI N/A")).toBeDefined();
    expect(screen.getByText("Unknown time")).toBeDefined();
    expect(container.textContent?.match(/N\/A/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("renders the non-AIS fallback state with SRC source label", () => {
    render(
      <AISDataPanel
        vessel={createVessel()}
        originVessel={{ latitude: 63.44, longitude: 10.41 }}
        onClose={vi.fn()}
        useAISData={false}
      />
    );

    expect(screen.getByTestId("obc-poi-card").getAttribute("data-source")).toBe("SRC");
    expect(screen.getByText("No AIS data available for this vessel.")).toBeDefined();
    expect(screen.queryByTestId("directional-vessel-icon")).toBeNull();
  });

  it("calls onClose when the OpenBridge card emits a close-click event", () => {
    const onClose = vi.fn();

    render(
      <AISDataPanel
        vessel={createVessel()}
        originVessel={{ latitude: 63.44, longitude: 10.41 }}
        onClose={onClose}
        useAISData
      />
    );

    const card = screen.getByTestId("obc-poi-card");

    act(() => {
      card.dispatchEvent(new Event("close-click", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
