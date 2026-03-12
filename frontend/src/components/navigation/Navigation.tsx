import { useEffect, useRef } from "react";
import { VideoTransform } from "../../hooks/useVideoTransform";

interface AIS {
  courseOverGround: number;
  latitude: number;
  longitude: number;
  trueHeading: number;
  rateOfTurn: number;
  speedOverGround: number;
  mmsi: number;
  name: string;
  msgtime: string;
}

interface Waypoint {
  id: string;
  lat: number;
  lon: number;
}

interface Route {
  id: string;
  waypoint: Waypoint[];
}

interface NavigationProps {
  videoTransform: VideoTransform;
  horizon: number;
  fov: number;
  ais: AIS;
  route: Route;
}

// calculate bearing from pos(lat1, lon1) to (lat2, lon2)
function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function Navigation({ videoTransform, horizon, fov, ais, route }: NavigationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef({ videoTransform, horizon, fov, ais, route });
  useEffect(() => {
    stateRef.current = { videoTransform, horizon, fov, ais, route };
  }, [videoTransform, horizon, fov, ais, route]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;

    function draw() {
      if (!canvas || !ctx) return;

      const { videoTransform: vt, horizon, fov, ais, route } = stateRef.current;

      const dpr = window.devicePixelRatio ?? 1;
      const containerWidth = (canvas.parentElement?.clientWidth ?? vt.videoWidth) * dpr;
      const containerHeight = (canvas.parentElement?.clientHeight ?? vt.videoHeight) * dpr;
      canvas.width = containerWidth;
      canvas.height = containerHeight;
      canvas.style.width = `${containerWidth / dpr}px`;
      canvas.style.height = `${containerHeight / dpr}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, containerWidth, containerHeight);

      const toScreenX = (x: number) => vt.offsetX + x * vt.scaleX;
      const toScreenY = (y: number) => vt.offsetY + y * vt.scaleY;

      const centerX = toScreenX(vt.sourceWidth / 2);
      const bottomY = toScreenY(vt.sourceHeight);
      const horizonY = toScreenY(vt.sourceHeight * horizon);

      const nextWp = route.waypoint[0] ?? null;
      let waypointOffsetPx = 0;
      if (nextWp) {
        const bearing = getBearing(ais.latitude, ais.longitude, nextWp.lat, nextWp.lon);
        const angleDiff = ((bearing - ais.trueHeading + 180) % 360) - 180;
        waypointOffsetPx = (angleDiff / (fov / 2)) * (vt.sourceWidth / 2) * vt.scaleX;
      }

      const bottomHalfWidth = vt.sourceWidth * 0.02 * vt.scaleX;
      const topHalfWidth = vt.sourceWidth * 0.0 * vt.scaleX;
      const videoLeft = toScreenX(0);
      const videoRight = toScreenX(vt.sourceWidth);
      const maxOffset = videoRight - topHalfWidth - centerX;
      const minOffset = videoLeft + topHalfWidth - centerX;
      waypointOffsetPx = Math.max(minOffset, Math.min(maxOffset, waypointOffsetPx));
      const topCenterX = centerX + waypointOffsetPx;

      const gradient = ctx.createLinearGradient(0, bottomY, 0, horizonY);
      gradient.addColorStop(0, "rgba(45, 84, 139, 0.8)");
      gradient.addColorStop(1, "rgba(45, 84, 139, 0.1)");

      const cp1X = centerX + waypointOffsetPx * 0.15;
      const cp2X = centerX + waypointOffsetPx * 0.7;
      const cp1Y = bottomY + (horizonY - bottomY) * 0.4;
      const cp2Y = bottomY + (horizonY - bottomY) * 0.75;

      ctx.beginPath();
      ctx.moveTo(centerX - bottomHalfWidth, bottomY);
      ctx.bezierCurveTo(
        cp1X - bottomHalfWidth,
        cp1Y,
        cp2X - topHalfWidth,
        cp2Y,
        topCenterX - topHalfWidth,
        horizonY
      );
      ctx.lineTo(topCenterX + topHalfWidth, horizonY);
      ctx.bezierCurveTo(
        cp2X + topHalfWidth,
        cp2Y,
        cp1X + bottomHalfWidth,
        cp1Y,
        centerX + bottomHalfWidth,
        bottomY
      );
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      animFrameId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animFrameId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    />
  );
}

export default Navigation;
