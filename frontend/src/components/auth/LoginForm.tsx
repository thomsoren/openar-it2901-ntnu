import { useCallback, useEffect, useRef } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { authClient } from "../../lib/auth-client";
import type { TextInputElement } from "./types";
import {
  clearInputError,
  getInputValue,
  mapAuthErrorMessage,
  normalizeUsername,
  setInputError,
  GoogleIcon,
} from "./utils";

type LoginFormProps = {
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  onAuthenticated: () => Promise<void> | void;
};

export default function LoginForm({
  isSubmitting,
  setIsSubmitting,
  onAuthenticated,
}: LoginFormProps) {
  const emailRef = useRef<TextInputElement | null>(null);
  const passwordRef = useRef<TextInputElement | null>(null);

  useEffect(() => {
    const el = emailRef.current;
    if (el) {
      el.label = "Email";
      el.placeholder = "your@email.com";
    }

    const pw = passwordRef.current;
    if (pw) {
      pw.label = "Password";
      pw.placeholder = "Password";
      pw.type = "password";
      pw.helperText =
        "Passwords should contain 12 characters, include uppercase, lowercase, numbers, and symbols.";
    }
  }, []);

  useEffect(() => {
    if (emailRef.current) emailRef.current.disabled = isSubmitting;
    if (passwordRef.current) passwordRef.current.disabled = isSubmitting;
  }, [isSubmitting]);

  const handleSignIn = useCallback(async () => {
    clearInputError(emailRef);
    clearInputError(passwordRef);

    const email = getInputValue(emailRef).trim();
    const password = getInputValue(passwordRef);

    let hasError = false;
    if (!email) {
      setInputError(emailRef, "Email is required");
      hasError = true;
    }
    if (!password) {
      setInputError(passwordRef, "Password is required");
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
      setInputError(passwordRef, mapAuthErrorMessage(error, "Authentication failed"));
    } finally {
      setIsSubmitting(false);
    }
  }, [onAuthenticated, setIsSubmitting]);

  return (
    <div className="auth-gate__form">
      <div className="auth-gate__inputs">
        <obc-text-input-field ref={emailRef} />
        <obc-text-input-field ref={passwordRef} />
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
  );
}

export const clearLoginErrors = (refs: {
  emailRef: React.RefObject<TextInputElement | null>;
  passwordRef: React.RefObject<TextInputElement | null>;
}) => {
  clearInputError(refs.emailRef);
  clearInputError(refs.passwordRef);
};
