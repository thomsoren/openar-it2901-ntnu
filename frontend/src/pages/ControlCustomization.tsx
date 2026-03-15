import { ObcToggleSwitch } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-switch/toggle-switch";
import { ARControlProvider } from "../components/ar-control-panel/ARControlProvider";
import { ARControlPanel } from "../components/ar-control-panel/ARControlPanel";
import { AR_PANEL_CONTROL_DEFINITIONS } from "../components/ar-control-panel/panel-controls";
import { useARControls } from "../components/ar-control-panel/useARControls";
import "./ControlCustomization.css";

const CONTROL_CUSTOMIZATION_ITEMS = [...AR_PANEL_CONTROL_DEFINITIONS] as const;

function ControlCustomizationInner({ embedded = false }: { embedded?: boolean }) {
  const { panelVisibility, setPanelControlVisibility } = useARControls();
  const hasVisibleControls = AR_PANEL_CONTROL_DEFINITIONS.some((item) => panelVisibility[item.key]);
  const pageClassName = embedded
    ? "control-customization-page control-customization-page--embedded"
    : "page control-customization-page";

  return (
    <section className={pageClassName}>
      <div className="control-customization-page__content">
        {!embedded && (
          <div className="control-customization-page__hero">
            <h2 className="page-title control-customization-page__title">Configuration</h2>
            <p className="page-subtitle control-customization-page__subtitle">
              Choose which controls are shown in the AR panel. Changes are saved automatically.
            </p>
          </div>
        )}

        <section className="control-customization-preview">
          <div className="control-customization-preview__header">
            <h3 className="control-customization-preview__title">Preview</h3>
          </div>

          <div className="control-customization-preview__frame">
            <div className="control-customization-preview__panel" inert={true}>
              {hasVisibleControls ? (
                <ARControlPanel />
              ) : (
                <div className="control-customization-preview__empty">No controls visible</div>
              )}
            </div>
          </div>
        </section>

        <section className="control-customization-table" aria-label="AR panel control visibility">
          <div className="control-customization-table__header" aria-hidden="true">
            <div className="control-customization-table__heading">Control</div>
            <div className="control-customization-table__heading">Description</div>
            <div className="control-customization-table__heading control-customization-table__heading--state">
              Visibility
            </div>
          </div>

          {CONTROL_CUSTOMIZATION_ITEMS.map((item) => (
            <section key={item.key} className="control-customization-row">
              <div className="control-customization-row__title-wrap">
                <h3 className="control-customization-row__title">{item.label}</h3>
              </div>
              <p className="control-customization-row__description">{item.description}</p>
              <div className="control-customization-row__toggle">
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

export default function ControlCustomization({ embedded = false }: { embedded?: boolean }) {
  return (
    <ARControlProvider>
      <ControlCustomizationInner embedded={embedded} />
    </ARControlProvider>
  );
}
