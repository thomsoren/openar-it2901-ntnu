import { ObcToggleSwitch } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-switch/toggle-switch";
import { ObcRadio } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/radio/radio";
import { useSettings } from "../contexts/useSettings";
import "./Settings.css";

const getToggleChecked = (event: Event, fallback: boolean): boolean => {
  const custom = event as CustomEvent<{ checked?: boolean; value?: boolean | string | number }>;
  const detail = custom.detail;
  if (typeof detail?.checked === "boolean") {
    return detail.checked;
  }
  if (typeof detail?.value === "boolean") {
    return detail.value;
  }
  if (typeof detail?.value === "string") {
    const normalized = detail.value.trim().toLowerCase();
    if (normalized === "true" || normalized === "on" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "off" || normalized === "0") {
      return false;
    }
  }
  const currentTarget = event.currentTarget as { checked?: boolean } | null;
  if (currentTarget && typeof currentTarget.checked === "boolean") {
    return currentTarget.checked;
  }
  const target = event.target as { checked?: boolean } | null;
  if (target && typeof target.checked === "boolean") {
    return target.checked;
  }
  return fallback;
};

function Settings() {
  const {
    videoFitMode,
    setVideoFitMode,
    aisEnabled,
    setAisEnabled,
    overlayVisible,
    setOverlayVisible,
    detectionVisible,
    setDetectionVisible,
    multiStreamTestingEnabled,
    setMultiStreamTestingEnabled,
  } = useSettings();

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
            onInput={(e) => {
              setAisEnabled(getToggleChecked(e, aisEnabled));
            }}
          />

          <ObcToggleSwitch
            label="Show Overlay"
            checked={overlayVisible}
            description="Toggle overlay visibility on video feed"
            onInput={(e) => {
              setOverlayVisible(getToggleChecked(e, overlayVisible));
            }}
          />

          <ObcToggleSwitch
            label="Show Detections"
            checked={detectionVisible}
            description="Toggle detection boxes visibility"
            onInput={(e) => {
              setDetectionVisible(getToggleChecked(e, detectionVisible));
            }}
          />

          <ObcToggleSwitch
            label="Enable Multi-Stream Testing"
            checked={multiStreamTestingEnabled}
            description="Show stream control panel in Datavision for on-demand stream switching"
            onInput={(e) => {
              setMultiStreamTestingEnabled(getToggleChecked(e, multiStreamTestingEnabled));
            }}
          />
        </div>

        <div className="settings-section">
          <h3 className="section-title">Video Display Mode</h3>

          <div className="radio-group">
            <ObcRadio
              name="videoFit"
              value="contain"
              label="Fit to Screen (Letterbox)"
              checked={videoFitMode === "contain"}
              inputId="video-fit-contain"
              onChange={() => setVideoFitMode("contain")}
            />

            <ObcRadio
              name="videoFit"
              value="cover"
              label="Fill Screen (Crop)"
              checked={videoFitMode === "cover"}
              inputId="video-fit-cover"
              onChange={() => setVideoFitMode("cover")}
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
