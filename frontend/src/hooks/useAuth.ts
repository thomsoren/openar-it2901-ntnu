import { useContext } from "react";
import { AuthContext } from "../contexts/auth-context";

export type { UserMenuState } from "../contexts/auth-context";

/**
 * Hook for accessing authenticated user/session state from AuthContext.
 * Must be used inside `AuthProvider`.
 *
 * @example
 * ```tsx
 * const auth = useAuth();
 * ```
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
