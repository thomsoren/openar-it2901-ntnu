import { ObcAlertFrame } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-frame/alert-frame";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import {
  ObcAlertFrameStatus,
  ObcAlertFrameType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-frame/alert-frame";
import { ObcElevatedCardSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/elevated-card/elevated-card";

type AccessDeniedProps = {
  message?: string;
};

export default function AccessDenied({
  message = "You are authenticated, but your account does not have upload access.",
}: AccessDeniedProps) {
  return (
    <div style={{ width: "min(720px, 100%)", margin: "2rem auto", padding: "0 1rem" }}>
      <ObcElevatedCard notClickable size={ObcElevatedCardSize.MultiLine}>
        <div slot="label">Access denied</div>
        <div slot="description">Upload requires admin privileges (`isAdmin = true`).</div>

        <ObcAlertFrame type={ObcAlertFrameType.Regular} status={ObcAlertFrameStatus.Warning}>
          <div style={{ padding: "0.75rem" }}>{message}</div>
        </ObcAlertFrame>
      </ObcElevatedCard>
    </div>
  );
}
