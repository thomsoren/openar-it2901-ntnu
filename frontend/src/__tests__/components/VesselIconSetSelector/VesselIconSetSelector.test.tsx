import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockToggleButtonOptionProps {
  children?: React.ReactNode;
  onClick?: () => void;
  value?: string;
}

interface MockToggleButtonGroupProps {
  children?: React.ReactNode;
  value?: string;
  type?: string;
  onValue?: (event: { detail: { value: string } }) => void;
}

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-option/toggle-button-option",
  () => ({
    ObcToggleButtonOption: ({ children, onClick, value }: MockToggleButtonOptionProps) => (
      <button type="button" data-value={value} onClick={onClick}>
        {children}
      </button>
    ),
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-group/toggle-button-group",
  async () => {
    const ReactModule = await import("react");

    return {
      ObcToggleButtonGroup: ({ children, value, type, onValue }: MockToggleButtonGroupProps) => (
        <div data-testid="icon-set-group" data-selected={value} data-type={type}>
          {ReactModule.Children.map(children, (child) => {
            if (!ReactModule.isValidElement(child)) return child;

            const optionElement = child as React.ReactElement<MockToggleButtonOptionProps>;
            const optionValue = optionElement.props.value ?? "";

            return ReactModule.cloneElement(optionElement, {
              onClick: () => onValue?.({ detail: { value: optionValue } }),
            });
          })}

          <button
            type="button"
            onClick={() => onValue?.({ detail: { value: "not-a-valid-icon-set" } })}
          >
            Emit invalid option
          </button>
        </div>
      ),
    };
  }
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/toggle-button-option/toggle-button-option",
  () => ({
    ObcToggleButtonOptionType: {
      iconTextUnder: "iconTextUnder",
    },
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-sleeping-iec",
  () => ({
    ObiAisTargetSleepingIec: () => <span data-testid="icon-generic" />,
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-outlined",
  () => ({
    ObiVesselTypeGenericOutlined: () => <span data-testid="icon-detailed" />,
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-generic-medium-outlined",
  () => ({
    ObiVesselGenericMediumOutlined: () => <span data-testid="icon-directional" />,
  })
);

import { VesselIconSetSelector } from "../../../components/VesselIconSetSelector/VesselIconSetSelector";

describe("VesselIconSetSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all icon-set options and forwards selected value to toggle group", () => {
    render(<VesselIconSetSelector value="generic" onChange={vi.fn()} />);

    expect(screen.getByText("AIS")).toBeDefined();
    expect(screen.getByText("Vessel type")).toBeDefined();
    expect(screen.getByText("Speed")).toBeDefined();

    const group = screen.getByTestId("icon-set-group");
    expect(group.getAttribute("data-selected")).toBe("generic");
    expect(group.getAttribute("data-type")).toBe("iconTextUnder");
  });

  it("calls onChange for each valid option emitted by toggle group", () => {
    const onChange = vi.fn();

    render(<VesselIconSetSelector value="generic" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "AIS" }));
    fireEvent.click(screen.getByRole("button", { name: "Vessel type" }));
    fireEvent.click(screen.getByRole("button", { name: "Speed" }));

    expect(onChange).toHaveBeenNthCalledWith(1, "generic");
    expect(onChange).toHaveBeenNthCalledWith(2, "detailed");
    expect(onChange).toHaveBeenNthCalledWith(3, "directional");
  });

  it("ignores invalid emitted values", () => {
    const onChange = vi.fn();

    render(<VesselIconSetSelector value="generic" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Emit invalid option" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
