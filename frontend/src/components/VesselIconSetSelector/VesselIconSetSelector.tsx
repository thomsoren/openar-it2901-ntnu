import React from "react";
import { ObcToggleButtonGroup } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-group/toggle-button-group";
import { ObcToggleButtonOption } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-option/toggle-button-option";
import { ObcToggleButtonOptionType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/toggle-button-option/toggle-button-option";
import { ObiAisTargetSleepingIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-sleeping-iec";
import { ObiVesselTypeGenericOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-outlined";
import { ObiVesselGenericMediumOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-generic-medium-outlined";
import { type VesselIconSet } from "../../utils/vesselIconMapper";
import "./VesselIconSetSelector.css";

interface VesselIconSetSelectorProps {
  value: VesselIconSet;
  onChange: (value: VesselIconSet) => void;
}

// The options for vessel icon sets, along with their labels and icons.
const VESSEL_ICON_SET_OPTIONS: Array<{
  value: VesselIconSet;
  label: string;
  Icon: React.ComponentType<{ slot?: string }>;
}> = [
  { value: "generic", label: "AIS", Icon: ObiAisTargetSleepingIec },
  { value: "detailed", label: "Vessel type", Icon: ObiVesselTypeGenericOutlined },
  { value: "directional", label: "Speed", Icon: ObiVesselGenericMediumOutlined },
];

const isVesselIconSet = (value: string): value is VesselIconSet =>
  value === "generic" || value === "detailed" || value === "directional";

export const VesselIconSetSelector: React.FC<VesselIconSetSelectorProps> = ({
  value,
  onChange,
}) => (
  <div className="vessel-icon-set-selector">
    <ObcToggleButtonGroup
      value={value}
      type={ObcToggleButtonOptionType.iconTextUnder}
      onValue={(event) => {
        const nextValue = event.detail.value;
        if (isVesselIconSet(nextValue)) {
          onChange(nextValue);
        }
      }}
    >
      {VESSEL_ICON_SET_OPTIONS.map(({ value: optionValue, label, Icon }) => (
        <ObcToggleButtonOption key={optionValue} value={optionValue}>
          <Icon slot="icon" />
          {label}
        </ObcToggleButtonOption>
      ))}
    </ObcToggleButtonGroup>
  </div>
);
