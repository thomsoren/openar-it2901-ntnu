import { AISGeographicalDataDisplay } from "../components/AISGeographicalDataDisplay";
import { AISProjectedCoordinates } from "../components/AISProjectedCoordinates";
import "./Ais.css";

function Ais() {
  return (
    <div className="ais-page">
      <AISGeographicalDataDisplay />
      <AISProjectedCoordinates />
    </div>
  );
}

export default Ais;
