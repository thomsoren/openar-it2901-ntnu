import { createContext } from "react";
import type {
  ObcUserMenuType,
  ObcUserMenuSignedInAction,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/user-menu/user-menu.js";

export type UserMenuState = ObcUserMenuType;

export interface AuthContextType {
  session: { user: { id: string; name?: string | null; email?: string | null } } | null;
  isSessionPending: boolean;
  authBridgeStatus: "idle" | "loading" | "ready" | "error";
  authBridgeError: string;
  isSigningOut: boolean;
  userMenuState: UserMenuState;
  userLabel: string;
  userInitials: string;
  signedInActions: ObcUserMenuSignedInAction[];
  handleAuthenticated: () => Promise<void>;
  retryAuthBridge: () => void;
  handleSignOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
