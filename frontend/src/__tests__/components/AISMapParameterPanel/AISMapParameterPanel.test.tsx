import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

interface MockInputProps {
  value?: string;
  disabled?: boolean;
  onInput?: (event: { target: { value: string } }) => void;
}

interface MockButtonProps {
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

interface MockToggleButtonOptionProps {
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  value?: string;
}

interface MockToggleButtonGroupProps {
  children?: React.ReactNode;
  disabled?: boolean;
  onValue?: (event: { detail: { value: string } }) => void;
}

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input",
  () => ({
    ObcInput: ({ value, disabled, onInput }: MockInputProps) => (
      <input
        value={value}
        disabled={disabled}
        onInput={(event) => {
          const target = event.target as HTMLInputElement;
          onInput?.({ target: { value: target.value } });
        }}
      />
    ),
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button",
  () => ({
    ObcButton: ({ children, disabled, onClick }: MockButtonProps) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-option/toggle-button-option",
  () => ({
    ObcToggleButtonOption: ({
      children,
      disabled,
      onClick,
      value,
    }: MockToggleButtonOptionProps) => (
      <button type="button" data-value={value} disabled={disabled} onClick={onClick}>
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
      ObcToggleButtonGroup: ({ children, disabled, onValue }: MockToggleButtonGroupProps) => (
        <div>
          {ReactModule.Children.map(children, (child) => {
            if (!ReactModule.isValidElement(child)) return child;

            const optionElement = child as React.ReactElement<MockToggleButtonOptionProps>;
            const value = optionElement.props.value ?? "";

            return ReactModule.cloneElement(optionElement, {
              disabled,
              onClick: () => onValue?.({ detail: { value } }),
            });
          })}
        </div>
      ),
    };
  }
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button",
  () => ({
    ButtonVariant: {
      normal: "normal",
      raised: "raised",
    },
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/input/input",
  () => ({
    HTMLInputTypeAttribute: {
      Number: "number",
    },
    ObcInputTextAlign: {
      Left: "left",
    },
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/toggle-button-option/toggle-button-option",
  () => ({
    ObcToggleButtonOptionType: {
      text: "text",
    },
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-content-collapse-google",
  () => ({
    ObiContentCollapseGoogle: () => <span>collapse-icon</span>,
  })
);

vi.mock(
  "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-content-expand-google",
  () => ({
    ObiContentExpandGoogle: () => <span>expand-icon</span>,
  })
);

vi.mock("../../../components/VesselIconSetSelector/VesselIconSetSelector", () => ({
  VesselIconSetSelector: ({ onChange }: { onChange: (value: "detailed") => void }) => (
    <button type="button" onClick={() => onChange("detailed")}>
      Select detailed icon
    </button>
  ),
}));

import {
  AISMapParameterPanel,
  type AISMapParameterSettings,
} from "../../../components/AISMapParameterPanel/AISMapParameterPanel";

const BASE_SETTINGS: AISMapParameterSettings = {
  shipLat: 63.4365,
  shipLon: 10.3835,
  heading: 0,
  offsetMeters: 1000,
  fovDegrees: 60,
  shapeMode: "wedge",
  rectLength: 1000,
  rectWidth: 600,
  editMode: false,
  iconSet: "generic",
};

describe("AISMapParameterPanel", () => {
  it("expands and collapses the panel", () => {
    const onSettingsChange = vi.fn();

    render(
      <AISMapParameterPanel
        settings={BASE_SETTINGS}
        isLoadingGPS={false}
        onUseGPSLocation={vi.fn()}
        onSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByText("Icon Type")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Minimize AIS controls" }));

    expect(screen.queryByText("Icon Type")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand AIS controls" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Expand AIS controls" }));

    expect(screen.getByText("Icon Type")).toBeDefined();
  });

  it("saves snapshot on start edit and restores snapshot on cancel", () => {
    const onSettingsChange = vi.fn();
    const { rerender } = render(
      <AISMapParameterPanel
        settings={BASE_SETTINGS}
        isLoadingGPS={false}
        onUseGPSLocation={vi.fn()}
        onSettingsChange={onSettingsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit area" }));

    expect(onSettingsChange).toHaveBeenNthCalledWith(1, { editMode: true });

    rerender(
      <AISMapParameterPanel
        settings={{
          ...BASE_SETTINGS,
          shipLat: 70,
          shipLon: 12,
          heading: 180,
          offsetMeters: 2000,
          fovDegrees: 90,
          rectLength: 2222,
          rectWidth: 444,
          shapeMode: "rect",
          editMode: true,
        }}
        isLoadingGPS={false}
        onUseGPSLocation={vi.fn()}
        onSettingsChange={onSettingsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSettingsChange).toHaveBeenNthCalledWith(2, {
      shipLat: BASE_SETTINGS.shipLat,
      shipLon: BASE_SETTINGS.shipLon,
      heading: BASE_SETTINGS.heading,
      offsetMeters: BASE_SETTINGS.offsetMeters,
      fovDegrees: BASE_SETTINGS.fovDegrees,
      shapeMode: BASE_SETTINGS.shapeMode,
      rectLength: BASE_SETTINGS.rectLength,
      rectWidth: BASE_SETTINGS.rectWidth,
      editMode: false,
    });
  });

  it("emits save action when editing", () => {
    const onSettingsChange = vi.fn();

    render(
      <AISMapParameterPanel
        settings={{ ...BASE_SETTINGS, editMode: true }}
        isLoadingGPS={false}
        onUseGPSLocation={vi.fn()}
        onSettingsChange={onSettingsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSettingsChange).toHaveBeenCalledWith({ editMode: false });
  });

  it("emits input, shape, and icon updates while honoring disabled and loading states", () => {
    const onUseGPSLocation = vi.fn();
    const onSettingsChange = vi.fn();
    const { rerender } = render(
      <AISMapParameterPanel
        settings={BASE_SETTINGS}
        isLoadingGPS={false}
        onUseGPSLocation={onUseGPSLocation}
        onSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByRole("button", { name: "Use current position" })).toHaveProperty(
      "disabled",
      true
    );

    rerender(
      <AISMapParameterPanel
        settings={{ ...BASE_SETTINGS, editMode: true }}
        isLoadingGPS={false}
        onUseGPSLocation={onUseGPSLocation}
        onSettingsChange={onSettingsChange}
      />
    );

    const longitudeInput = screen.getByLabelText("Longitude") as HTMLInputElement;
    fireEvent.input(longitudeInput, { target: { value: "11.25" } });

    expect(onSettingsChange).toHaveBeenCalledWith({ shipLon: 11.25 });

    fireEvent.input(longitudeInput, { target: { value: "abc" } });

    expect(onSettingsChange).toHaveBeenLastCalledWith({ shipLon: BASE_SETTINGS.shipLon });

    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ shapeMode: "rect" });

    fireEvent.click(screen.getByRole("button", { name: "Select detailed icon" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ iconSet: "detailed" });

    fireEvent.click(screen.getByRole("button", { name: "Use current position" }));
    expect(onUseGPSLocation).toHaveBeenCalledTimes(1);

    rerender(
      <AISMapParameterPanel
        settings={{ ...BASE_SETTINGS, editMode: true }}
        isLoadingGPS
        onUseGPSLocation={onUseGPSLocation}
        onSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByRole("button", { name: "Fetching..." })).toHaveProperty("disabled", true);
  });
});
