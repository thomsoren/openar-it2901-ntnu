import { useState } from "react";
import { ObcToggleSwitch } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-switch/toggle-switch";
import { ObcRadio } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/radio/radio";
import "./Settings.css";

function Settings() {
  const [aisEnabled, setAisEnabled] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [detectionVisible, setDetectionVisible] = useState(true);

  return (
    <div className="settings-container">
      <div className="settings-box">
        <h2 className="settings-title">UI Settings</h2>

        <div className="settings-section">
          <h3 className="section-title">Display Options</h3>

          <ObcToggleSwitch
            label="Enable AIS"
            checked={aisEnabled}
            description="Toggle AIS (Automatic Identification System) display"
            onChange={(e) => {
              const target = e.target as HTMLInputElement;
              setAisEnabled(target.checked);
            }}
          />

          <ObcToggleSwitch
            label="Show Overlay"
            checked={overlayVisible}
            description="Toggle overlay visibility on video feed"
            onChange={(e) => {
              const target = e.target as HTMLInputElement;
              setOverlayVisible(target.checked);
            }}
          />

          <ObcToggleSwitch
            label="Show Detections"
            checked={detectionVisible}
            description="Toggle detection boxes visibility"
            onChange={(e) => {
              const target = e.target as HTMLInputElement;
              setDetectionVisible(target.checked);
            }}
          />
        </div>

        <div className="settings-section">
          <h3 className="section-title">UI Density</h3>

          <div className="radio-group">
            <ObcRadio
              name="density"
              value="comfortable"
              label="Comfortable"
              checked={true}
              inputId="density-comfortable"
            />

            <ObcRadio
              name="density"
              value="compact"
              label="Compact"
              checked={false}
              inputId="density-compact"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
