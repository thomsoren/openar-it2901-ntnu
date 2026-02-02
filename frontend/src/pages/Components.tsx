import { API_CONFIG } from "../config/video";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import { ObcPoiTargetButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target-button/poi-target-button";
import { ObcPoiTargetButtonGroup } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target-button-group/poi-target-button-group";
import { ObcPoiTargetButtonType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-target-button/poi-target-button";

function Components() {
  const backgroundUrl = `${API_CONFIG.BASE_URL}/api/assets/oceanbackground`;

  const sampleValues = [
    { label: "BRG", value: "145", unit: "°" },
    { label: "RNG", value: "2.4", unit: "nm" },
    { label: "TTG", value: "12:30", unit: "" },
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
        {/* POI Target Button Group Section */}
        <section
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h3 style={{ marginTop: "150px" }}>POI Target Button Group</h3>
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
            <div style={{ position: "relative" }}>
              <ObcPoiTargetButtonGroup expand>
                <ObcPoiTarget type={ObcPoiTargetButtonType.Button} />
                <ObcPoiTarget type={ObcPoiTargetButtonType.Button} />
                <ObcPoiTarget type={ObcPoiTargetButtonType.Button} />
              </ObcPoiTargetButtonGroup>
            </div>
          </div>
        </section>

        {/* POI Target Button Section */}
        <section
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h3 style={{ marginTop: "150px" }}>POI Target Button</h3>
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
              <ObcPoiTargetButton type={ObcPoiTargetButtonType.Button} />
              <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "1rem" }}>Normal</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <ObcPoiTargetButton type={ObcPoiTargetButtonType.Enhanced} values={sampleValues} />
              <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "1rem" }}>Enhanced</p>
            </div>
          </div>
        </section>

        {/* POI Target Section */}
        <section
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h3 style={{ marginTop: "150px" }}>POI Target</h3>
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
                <ObcPoiTarget type={ObcPoiTargetButtonType.Button} values={sampleValues} />
                <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "1rem" }}>Normal</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <ObcPoiTarget type={ObcPoiTargetButtonType.Enhanced} values={sampleValues} />
                <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "1rem" }}>Enhanced</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export default Components;
