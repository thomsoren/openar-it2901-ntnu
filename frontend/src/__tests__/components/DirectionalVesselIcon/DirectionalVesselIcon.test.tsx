import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISData } from "../../../types/aisData";

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-default-filled.js",
  () => ({})
);
vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-slow-filled.js",
  () => ({})
);
vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-medium-filled.js",
  () => ({})
);
vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-fast-filled.js",
  () => ({})
);
vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-stopped-filled.js",
  () => ({})
);
vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-vessel-generic-anchored-filled.js",
  () => ({})
);

import { DirectionalVesselIcon } from "../../../components/DirectionalVesselIcon/DirectionalVesselIcon";

function createVessel(overrides: Partial<AISData> = {}): AISData {
  return {
    courseOverGround: 45,
    latitude: 63.4305,
    longitude: 10.3951,
    name: "Test Vessel",
    rateOfTurn: 0,
    shipType: 70,
    speedOverGround: 12,
    trueHeading: 90,
    navigationalStatus: 0,
    mmsi: 257123456,
    msgtime: "2026-03-12T11:30:00.000Z",
    projection: null,
    ...overrides,
  };
}

describe("DirectionalVesselIcon", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders CSS angle variables and selects the fast icon for high-speed vessels", () => {
    const { container } = render(
      <DirectionalVesselIcon
        vessel={createVessel({ speedOverGround: 18, trueHeading: 90, courseOverGround: 45 })}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root.className).toContain("dvi-rot-steady");
    expect(root.style.getPropertyValue("--dvi-heading-angle")).toBe("90deg");
    expect(root.style.getPropertyValue("--dvi-course-angle")).toBe("45deg");
    expect(
      container.querySelector("obi-vessel-generic-fast-filled.dvi-vessel-icon-glyph")
    ).not.toBeNull();
  });

  it.each([
    { navigationalStatus: 1, expectedTag: "obi-vessel-generic-anchored-filled" },
    { navigationalStatus: 5, expectedTag: "obi-vessel-generic-stopped-filled" },
  ])(
    "prioritizes status-based icon mapping for status $navigationalStatus",
    ({ navigationalStatus, expectedTag }) => {
      const { container } = render(
        <DirectionalVesselIcon vessel={createVessel({ navigationalStatus, speedOverGround: 22 })} />
      );

      expect(container.querySelector(`${expectedTag}.dvi-vessel-icon-glyph`)).not.toBeNull();
    }
  );

  it("falls back to course over ground when true heading is missing", () => {
    const { container } = render(
      <DirectionalVesselIcon
        vessel={createVessel({
          courseOverGround: 132,
          trueHeading: null as unknown as number,
        })}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root.style.getPropertyValue("--dvi-heading-angle")).toBe("132deg");
    expect(root.style.getPropertyValue("--dvi-course-angle")).toBe("132deg");
  });

  it.each([
    { rateOfTurn: -128, expectedClass: "dvi-rot-unknown" },
    { rateOfTurn: 2, expectedClass: "dvi-rot-gentle" },
    { rateOfTurn: 10, expectedClass: "dvi-rot-moderate" },
    { rateOfTurn: 25, expectedClass: "dvi-rot-sharp" },
  ])("maps rate of turn $rateOfTurn to $expectedClass", ({ rateOfTurn, expectedClass }) => {
    const { container } = render(<DirectionalVesselIcon vessel={createVessel({ rateOfTurn })} />);

    expect((container.firstElementChild as HTMLElement).className).toContain(expectedClass);
  });
});
