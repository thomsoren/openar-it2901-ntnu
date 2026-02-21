import { useCallback, useState } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcTextInputField } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/text-input-field/text-input-field";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { HTMLInputTypeAttribute } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/text-input-field/text-input-field";
import { authClient } from "../../lib/auth-client";
import { mapAuthErrorMessage, GoogleIcon } from "./utils";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handleSignIn = useCallback(async () => {
    setEmailError("");
    setPasswordError("");

    const trimmedEmail = email.trim();

    let hasError = false;
    if (!trimmedEmail) {
      setEmailError("Email is required");
      hasError = true;
    }
    if (!password) {
      setPasswordError("Password is required");
      hasError = true;
    } else if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      const normalizedEmail = trimmedEmail.toLowerCase();
      const signInResponse = await authClient.signIn.email({
        email: normalizedEmail,
        password,
      });

      if (signInResponse.error) {
        setPasswordError(mapAuthErrorMessage(signInResponse.error, "Authentication failed"));
        return;
      }

      await onAuthenticated();
    } catch (error) {
      setPasswordError(mapAuthErrorMessage(error, "Authentication failed"));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, onAuthenticated, setIsSubmitting]);

  return (
    <div className="auth-gate__form">
      <div className="auth-gate__inputs">
        <ObcTextInputField
          label="Email"
          placeholder="your@email.com"
          value={email}
          disabled={isSubmitting}
          error={Boolean(emailError)}
          errorText={emailError}
          onInput={(e) => {
            const target = e.target as HTMLInputElement;
            setEmail(target.value);
          }}
        />
        <ObcTextInputField
          label="Password"
          placeholder="Password"
          type={HTMLInputTypeAttribute.Password}
          value={password}
          disabled={isSubmitting}
          error={Boolean(passwordError)}
          errorText={passwordError}
          helperText="Passwords should contain 8 characters, include uppercase, lowercase, numbers, and symbols."
          onInput={(e) => {
            const target = e.target as HTMLInputElement;
            setPassword(target.value);
          }}
        />
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
