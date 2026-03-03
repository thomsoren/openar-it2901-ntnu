import { ObcUserMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/user-menu/user-menu";
import { ObcUserMenuSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/user-menu/user-menu";
import AuthGate from "../auth/AuthGate";
import { useAuth } from "../../hooks/useAuth";

interface UserPanelProps {
  onSignedIn: () => Promise<void>;
}

export function UserPanel({ onSignedIn }: UserPanelProps) {
  const auth = useAuth();

  return (
    <div className={`user-panel${!auth.session ? " user-panel--auth" : ""}`}>
      {auth.session ? (
        <ObcUserMenu
          type={auth.userMenuState}
          size={ObcUserMenuSize.small}
          hasRecentlySignedIn={false}
          userInitials={auth.userInitials}
          userLabel={auth.userLabel}
          signedInActions={auth.signedInActions}
          onSignOutClick={() => void auth.handleSignOut()}
        />
      ) : (
        <AuthGate
          initialMode="login"
          onAuthenticated={async () => {
            await auth.handleAuthenticated();
            await onSignedIn();
          }}
        />
      )}
    </div>
  );
}
