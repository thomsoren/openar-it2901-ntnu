import { useCallback, useState } from "react";
import { ObcTabbedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tabbed-card/tabbed-card";
import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";
import "./AuthGate.css";

type AuthMode = "login" | "signup";

type AuthGateProps = {
  initialMode?: AuthMode;
  onAuthenticated: () => Promise<void> | void;
};

export default function AuthGate({ initialMode = "login", onAuthenticated }: AuthGateProps) {
  const [activeTab, setActiveTab] = useState(initialMode === "login" ? 0 : 1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleTabChange = useCallback((event: CustomEvent<{ tab: number }>) => {
    setActiveTab(event.detail.tab);
  }, []);

  return (
    <div className="auth-gate">
      <div className="auth-gate__card">
        <ObcTabbedCard nTabs={2} selectedTab={activeTab} onTabChange={handleTabChange}>
          <span slot="tab-title-0">Sign in</span>
          <span slot="tab-title-1">Register</span>

          <div slot="tab-content-0">
            <LoginForm
              isSubmitting={isSubmitting}
              setIsSubmitting={setIsSubmitting}
              onAuthenticated={onAuthenticated}
            />
          </div>

          <div slot="tab-content-1">
            <SignupForm
              isSubmitting={isSubmitting}
              setIsSubmitting={setIsSubmitting}
              onAuthenticated={onAuthenticated}
            />
          </div>
        </ObcTabbedCard>
      </div>
    </div>
  );
}
