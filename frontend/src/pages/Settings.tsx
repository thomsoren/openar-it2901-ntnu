import { useState } from "react";
import { ObcToggleSwitch } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-switch/toggle-switch";
import { ObcRadio } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/radio/radio";
import "./Settings.css";

function Settings() {
  const [aisEnabled, setAisEnabled] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [detectionVisible, setDetectionVisible] = useState(true);
  const [themeMode, setThemeMode] = useState("auto");

  return (
    <div className="settings-container">
      <div className="settings-box">
        <h2 className="settings-title">UI Settings</h2>

        <div className="settings-section">
          <h3 className="section-title">Display Options</h3>

          <ObcToggleSwitch
            label="Enable AIS"
            checked={aisEnabled}
            showDescription={true}
            description="Toggle AIS (Automatic Identification System) display"
            bottomDivider={true}
            onObc-change={(e: CustomEvent) => setAisEnabled(e.detail.checked)}
          />

          <ObcToggleSwitch
            label="Show Overlay"
            checked={overlayVisible}
            showDescription={true}
            description="Toggle overlay visibility on video feed"
            bottomDivider={true}
            onObc-change={(e: CustomEvent) => setOverlayVisible(e.detail.checked)}
          />

          <ObcToggleSwitch
            label="Show Detections"
            checked={detectionVisible}
            showDescription={true}
            description="Toggle detection boxes visibility"
            bottomDivider={false}
            onObc-change={(e: CustomEvent) => setDetectionVisible(e.detail.checked)}
          />
        </div>

        <div className="settings-section">
          <h3 className="section-title">Theme Mode</h3>

          <div className="radio-group">
            <ObcRadio
              name="theme"
              value="auto"
              label="Auto"
              checked={themeMode === "auto"}
              inputId="theme-auto"
              onChange={(e: Event) => {
                const target = e.target as HTMLInputElement;
                if (target.checked) setThemeMode("auto");
              }}
            />

            <ObcRadio
              name="theme"
              value="light"
              label="Light Mode"
              checked={themeMode === "light"}
              inputId="theme-light"
              onChange={(e: Event) => {
                const target = e.target as HTMLInputElement;
                if (target.checked) setThemeMode("light");
              }}
            />

            <ObcRadio
              name="theme"
              value="dark"
              label="Dark Mode"
              checked={themeMode === "dark"}
              inputId="theme-dark"
              onChange={(e: Event) => {
                const target = e.target as HTMLInputElement;
                if (target.checked) setThemeMode("dark");
              }}
            />
          </div>
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
