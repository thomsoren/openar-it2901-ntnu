import { API_CONFIG } from "../config/video";
import { ObcPoiData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-data/poi-data";
import { ObcPoiGroup } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-group/poi-group";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";
import "./Components.css";

function Components() {
  const backgroundUrl = `${API_CONFIG.BASE_URL}/api/assets/oceanbackground`;

  const sampleValues = [
    { value: "145", label: "BRG", unit: "°" },
    { value: "2.4", label: "RNG", unit: "nm" },
    { value: "12:30", label: "TTG", unit: "" },
  ];

  return (
    <section
      className="page page--background components-page"
      style={{
        backgroundImage: `url(${backgroundUrl})`,
      }}
    >
      <h2 className="page-title components-page__title">AR Components</h2>
      <p className="page-subtitle components-page__subtitle">
        Sandbox for OpenBridge AR components and building blocks.
      </p>

      <div className="components-grid">
        {/* POI Group Section */}
        <section className="components-section">
          <h3 className="components-section__title">POI Group</h3>
          <div className="components-poi-group-container">
            <div className="components-poi-group-canvas">
              <ObcPoiGroup className="components-poi-group" expand={false} positionVertical="200px">
                <ObcPoiData className="components-absolute" x={150} y={100} buttonY={200} />
                <ObcPoiData className="components-absolute" x={170} y={100} buttonY={200} />
                <ObcPoiData className="components-absolute" x={190} y={100} buttonY={200} />
              </ObcPoiGroup>
            </div>
          </div>
        </section>

        {/* POI Data Section */}
        <section className="components-section">
          <h3 className="components-section__title">POI Data</h3>
          <div className="components-poi-data-container">
            <div className="components-center-column">
              <div className="components-canvas-100x100">
                <ObcPoiData x={50} y={50} buttonY={50} value={PoiDataValue.Unchecked} />
              </div>
            </div>
            <div className="components-center-column">
              <div className="components-canvas-150x100">
                <ObcPoiData
                  x={75}
                  y={50}
                  buttonY={50}
                  value={PoiDataValue.Unchecked}
                  data={sampleValues}
                />
              </div>
            </div>
          </div>
        </section>

        {/* POI Data with Line Section */}
        <section className="components-section">
          <h3 className="components-section__title">POI Data with Line</h3>
          <div className="components-line-container">
            <div className="components-line-row">
              <div className="components-center-column">
                <div className="components-canvas-100x150">
                  <ObcPoiData x={50} y={75} buttonY={150} value={PoiDataValue.Unchecked} />
                </div>
              </div>
              <div className="components-center-column">
                <div className="components-canvas-100x150">
                  <ObcPoiData x={50} y={75} buttonY={150} value={PoiDataValue.Checked} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export default Components;
