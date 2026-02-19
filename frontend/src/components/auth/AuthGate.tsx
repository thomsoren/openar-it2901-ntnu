import { useCallback, useEffect, useRef, useState } from "react";
import { ObcTabbedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tabbed-card/tabbed-card";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/text-input-field/text-input-field";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { authClient } from "../../lib/auth-client";
import "./AuthGate.css";

type AuthMode = "login" | "signup";

type AuthGateProps = {
  initialMode?: AuthMode;
  onAuthenticated: () => Promise<void> | void;
};

type TextInputElement = HTMLElement & {
  value: string;
  label: string;
  placeholder: string;
  type: string;
  error: boolean;
  errorText: string;
  helperText: string;
  disabled: boolean;
  required: boolean;
};

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const syntheticEmailFromUsername = (username: string) => `${username}@openar.local`;

const mapAuthErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();

  if (
    lower.includes("username") &&
    (lower.includes("exists") || lower.includes("taken") || lower.includes("already"))
  ) {
    return "Username already taken";
  }

  if (lower.includes("invalid username or password") || lower.includes("invalid credentials")) {
    return "Invalid username or password";
  }

  if (lower.includes("unprocessable_entity")) {
    return "Invalid input. Check username and password format.";
  }

  return message;
};

const getInputValue = (ref: React.RefObject<TextInputElement | null>): string => {
  return ref.current?.value || "";
};

const setInputError = (ref: React.RefObject<TextInputElement | null>, errorText: string) => {
  if (!ref.current) return;
  ref.current.error = Boolean(errorText);
  ref.current.errorText = errorText;
};

const clearInputError = (ref: React.RefObject<TextInputElement | null>) => {
  setInputError(ref, "");
};

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" style={{ display: "block" }}>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

export default function AuthGate({ initialMode = "login", onAuthenticated }: AuthGateProps) {
  const [activeTab, setActiveTab] = useState(initialMode === "login" ? 0 : 1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loginEmailRef = useRef<TextInputElement | null>(null);
  const loginPasswordRef = useRef<TextInputElement | null>(null);
  const signupEmailRef = useRef<TextInputElement | null>(null);
  const signupPasswordRef = useRef<TextInputElement | null>(null);
  const signupConfirmRef = useRef<TextInputElement | null>(null);

  useEffect(() => {
    setActiveTab(initialMode === "login" ? 0 : 1);
  }, [initialMode]);

  // Configure text-input-field properties imperatively (camelCase properties
  // don't map to attributes properly in React 18 with web components).
  useEffect(() => {
    const configure = (
      el: TextInputElement | null,
      config: Partial<Pick<TextInputElement, "label" | "placeholder" | "type" | "helperText">>
    ) => {
      if (!el) return;
      if (config.label !== undefined) el.label = config.label;
      if (config.placeholder !== undefined) el.placeholder = config.placeholder;
      if (config.type !== undefined) el.type = config.type;
      if (config.helperText !== undefined) el.helperText = config.helperText;
    };

    configure(loginEmailRef.current, { label: "Email", placeholder: "your@email.com" });
    configure(loginPasswordRef.current, {
      label: "Password",
      placeholder: "Password",
      type: "password",
      helperText:
        "Passwords should contain 12 characters, include uppercase, lowercase, numbers, and symbols.",
    });
    configure(signupEmailRef.current, { label: "Email", placeholder: "your@email.com" });
    configure(signupPasswordRef.current, {
      label: "Password",
      placeholder: "Password",
      type: "password",
    });
    configure(signupConfirmRef.current, {
      label: "Confirm password",
      placeholder: "Password",
      type: "password",
    });
  }, []);

  // Disable inputs while submitting
  useEffect(() => {
    const refs = [
      loginEmailRef,
      loginPasswordRef,
      signupEmailRef,
      signupPasswordRef,
      signupConfirmRef,
    ];
    for (const ref of refs) {
      if (ref.current) ref.current.disabled = isSubmitting;
    }
  }, [isSubmitting]);

  const handleTabChange = useCallback((event: Event) => {
    const tab = (event as CustomEvent<{ tab: number }>).detail.tab;
    setActiveTab(tab);

    clearInputError(loginEmailRef);
    clearInputError(loginPasswordRef);
    clearInputError(signupEmailRef);
    clearInputError(signupPasswordRef);
    clearInputError(signupConfirmRef);
  }, []);

  const handleSignIn = useCallback(async () => {
    clearInputError(loginEmailRef);
    clearInputError(loginPasswordRef);

    const email = getInputValue(loginEmailRef).trim();
    const password = getInputValue(loginPasswordRef);

    let hasError = false;
    if (!email) {
      setInputError(loginEmailRef, "Email is required");
      hasError = true;
    }
    if (!password) {
      setInputError(loginPasswordRef, "Password is required");
      hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      const normalizedUsername = normalizeUsername(email);
      const signInResponse = await authClient.signIn.username({
        username: normalizedUsername,
        password,
      });

      if (signInResponse.error) {
        throw new Error(signInResponse.error.message || "Invalid username or password");
      }

      await onAuthenticated();
    } catch (error) {
      setInputError(loginPasswordRef, mapAuthErrorMessage(error, "Authentication failed"));
    } finally {
      setIsSubmitting(false);
    }
  }, [onAuthenticated]);

  const handleSignUp = useCallback(async () => {
    clearInputError(signupEmailRef);
    clearInputError(signupPasswordRef);
    clearInputError(signupConfirmRef);

    const email = getInputValue(signupEmailRef).trim();
    const password = getInputValue(signupPasswordRef);
    const confirmPassword = getInputValue(signupConfirmRef);

    let hasError = false;
    if (!email) {
      setInputError(signupEmailRef, "Email is required");
      hasError = true;
    }
    if (!password) {
      setInputError(signupPasswordRef, "Password is required");
      hasError = true;
    } else if (password.length < 8) {
      setInputError(signupPasswordRef, "Password must be at least 8 characters");
      hasError = true;
    }
    if (!confirmPassword) {
      setInputError(signupConfirmRef, "Confirm your password");
      hasError = true;
    } else if (password !== confirmPassword) {
      setInputError(signupConfirmRef, "Passwords do not match");
      hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      const normalizedUsername = normalizeUsername(email);
      const signUpResponse = await authClient.signUp.email({
        name: normalizedUsername,
        username: normalizedUsername,
        email: syntheticEmailFromUsername(normalizedUsername),
        password,
      });

      if (signUpResponse.error) {
        throw new Error(signUpResponse.error.message || "Sign up failed");
      }

      await onAuthenticated();
    } catch (error) {
      setInputError(signupPasswordRef, mapAuthErrorMessage(error, "Sign up failed"));
    } finally {
      setIsSubmitting(false);
    }
  }, [onAuthenticated]);

  return (
    <div className="auth-gate">
      <div className="auth-gate__card">
        <ObcTabbedCard nTabs={2} selectedTab={activeTab} onTabChange={handleTabChange}>
          <span slot="tab-title-0">Sign in</span>
          <span slot="tab-title-1">Register</span>

          <div slot="tab-content-0" className="auth-gate__form">
            <div className="auth-gate__inputs">
              <obc-text-input-field ref={loginEmailRef} />
              <obc-text-input-field ref={loginPasswordRef} />
            </div>
            <div className="auth-gate__actions">
              <ObcButton
                variant={ButtonVariant.raised}
                fullWidth
                disabled={isSubmitting}
                onClick={() => void handleSignIn()}
              >
                Sign in
              </ObcButton>
              <ObcButton variant={ButtonVariant.normal} fullWidth showLeadingIcon>
                <span slot="leading-icon">
                  <GoogleIcon />
                </span>
                Continue with Google
              </ObcButton>
              <ObcButton variant={ButtonVariant.flat} fullWidth>
                Forgot password?
              </ObcButton>
            </div>
          </div>

          <div slot="tab-content-1" className="auth-gate__form">
            <div className="auth-gate__inputs">
              <obc-text-input-field ref={signupEmailRef} />
              <obc-text-input-field ref={signupPasswordRef} />
              <obc-text-input-field ref={signupConfirmRef} />
            </div>
            <div className="auth-gate__actions">
              <ObcButton
                variant={ButtonVariant.raised}
                fullWidth
                disabled={isSubmitting}
                onClick={() => void handleSignUp()}
              >
                Create account
              </ObcButton>
              <ObcButton variant={ButtonVariant.normal} fullWidth showLeadingIcon>
                <span slot="leading-icon">
                  <GoogleIcon />
                </span>
                Continue with Google
              </ObcButton>
            </div>
          </div>
        </ObcTabbedCard>
      </div>
    </div>
  );
}
