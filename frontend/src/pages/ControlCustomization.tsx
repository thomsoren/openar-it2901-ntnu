import { ObcToggleSwitch } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-switch/toggle-switch";
import { ARControlProvider } from "../components/ar-control-panel/ARControlProvider";
import { ARControlPanel } from "../components/ar-control-panel/ARControlPanel";
import { AR_PANEL_CONTROL_DEFINITIONS } from "../components/ar-control-panel/panel-controls";
import { useARControls } from "../components/ar-control-panel/useARControls";
import "./ControlCustomization.css";

function ControlCustomizationInner() {
  const { panelVisibility, setPanelControlVisibility } = useARControls();
  const hasVisibleControls = Object.values(panelVisibility).some(Boolean);

  return (
    <section className="page control-customization-page">
      <div className="control-customization-page__content">
        <div className="control-customization-page__hero">
          <p className="page-subtitle control-customization-page__eyebrow">AR Panel</p>
          <h2 className="page-title control-customization-page__title">Control Customization</h2>
          <p className="page-subtitle control-customization-page__subtitle">
            Choose which controls are shown in the AR panel. Changes are saved automatically.
          </p>
        </div>

        <section className="control-customization-preview">
          <div className="control-customization-preview__header">
            <h3 className="control-customization-preview__title">Preview</h3>
          </div>

          <div className="control-customization-preview__frame">
            <div className="control-customization-preview__panel" inert={true}>
              {hasVisibleControls ? (
                <ARControlPanel interactive={false} />
              ) : (
                <div className="control-customization-preview__empty">No controls visible</div>
              )}
            </div>
          </div>
        </section>

        <section className="control-customization-table" aria-label="AR panel control visibility">
          <div className="control-customization-table__header" aria-hidden="true">
            <div className="control-customization-table__heading">Control</div>
            <div className="control-customization-table__heading">Type</div>
            <div className="control-customization-table__heading control-customization-table__heading--state">
              Visibility
            </div>
          </div>

          {AR_PANEL_CONTROL_DEFINITIONS.map((item) => (
            <section key={item.key} className="control-customization-row">
              <div className="control-customization-row__title-wrap">
                <h3 className="control-customization-row__title">{item.label}</h3>
              </div>
              <p className="control-customization-row__description">{item.description}</p>
              <div className="control-customization-row__toggle">
                <span className="control-customization-row__state">
                  {panelVisibility[item.key] ? "Visible" : "Hidden"}
                </span>
                <ObcToggleSwitch
                  label={panelVisibility[item.key] ? "On" : "Off"}
                  checked={panelVisibility[item.key]}
                  onInput={() => setPanelControlVisibility(item.key, !panelVisibility[item.key])}
                />
              </div>
            </section>
          ))}
        </section>
      </div>
    </section>
  );
}

function ControlCustomization() {
  return (
    <ARControlProvider>
      <ControlCustomizationInner />
    </ARControlProvider>
  );
}

export default ControlCustomization;
