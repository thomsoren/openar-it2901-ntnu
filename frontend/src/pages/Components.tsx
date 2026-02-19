import { API_CONFIG } from "../config/video";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-group/poi-group";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";
import { ObcPoiType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/building-blocks/poi/poi";

function Components() {
  const backgroundUrl = `${API_CONFIG.BASE_URL}/api/assets/oceanbackground`;

  const sampleValues = [
    { value: "145", label: "BRG", unit: "°" },
    { value: "2.4", label: "RNG", unit: "nm" },
    { value: "12:30", label: "TTG", unit: "" },
  ];

  return (
    <section
      className="page page--background"
      style={{
        backgroundImage: `url(${backgroundUrl})`,
        backgroundAttachment: "fixed",
        backgroundSize: "cover",
        backgroundPosition: "center",
        overflowY: "auto",
        display: "block",
        padding: "2rem",
        minHeight: "100vh",
      }}
    >
      <h2 className="page-title" style={{ marginBottom: "0.5rem" }}>
        AR Components
      </h2>
      <p className="page-subtitle" style={{ marginBottom: "2rem" }}>
        Sandbox for OpenBridge AR components and building blocks.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(450px, 1fr))",
          gap: "4rem",
          justifyContent: "center",
        }}
      >
        {/* POI Group Section */}
        <section
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h3 style={{ marginTop: "150px" }}>POI Group</h3>
          <div
            style={{
              height: "400px",
              width: "100%",
              position: "relative",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              paddingBottom: "20px",
            }}
          >
            <div style={{ position: "relative", width: "400px", height: "300px" }}>
              <obc-poi-group
                style={{ position: "absolute", top: 0, left: 0 }}
                expand={false}
                positionVertical="200px"
              >
                <obc-poi-data style={{ position: "absolute" }} x={150} y={100} buttonY={200} />
                <obc-poi-data style={{ position: "absolute" }} x={170} y={100} buttonY={200} />
                <obc-poi-data style={{ position: "absolute" }} x={190} y={100} buttonY={200} />
              </obc-poi-group>
            </div>
          </div>
        </section>

        {/* POI Data Section */}
        <section
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h3 style={{ marginTop: "150px" }}>POI Data</h3>
          <div
            style={{
              display: "flex",
              gap: "4rem",
              flexWrap: "wrap",
              alignItems: "flex-end",
              justifyContent: "center",
              height: "400px",
              paddingBottom: "40px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ position: "relative", width: "100px", height: "100px" }}>
                <obc-poi-data
                  type={ObcPoiType.Point}
                  x={50}
                  y={50}
                  buttonY={50}
                  value={PoiDataValue.Unchecked}
                />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ position: "relative", width: "150px", height: "100px" }}>
                <obc-poi-data
                  type={ObcPoiType.Point}
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
        <section
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h3 style={{ marginTop: "150px" }}>POI Data with Line</h3>
          <div
            style={{
              height: "400px",
              width: "100%",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                display: "flex",
                justifyContent: "space-around",
                alignItems: "center",
                paddingBottom: "20px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ position: "relative", width: "100px", height: "150px" }}>
                  <obc-poi-data
                    type={ObcPoiType.Line}
                    x={50}
                    y={75}
                    buttonY={150}
                    value={PoiDataValue.Unchecked}
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ position: "relative", width: "100px", height: "150px" }}>
                  <obc-poi-data
                    type={ObcPoiType.Line}
                    x={50}
                    y={75}
                    buttonY={150}
                    value={PoiDataValue.Checked}
                  />
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
