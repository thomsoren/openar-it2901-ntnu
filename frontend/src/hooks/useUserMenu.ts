import { useEffect, useRef } from "react";
import type { UserMenuState, UserMenuAction, UserMenuSignInDetail } from "./useAuth";

interface UseUserMenuOptions {
  showUserPanel: boolean;
  userMenuState: UserMenuState;
  userInitials: string;
  userLabel: string;
  signedInActions: UserMenuAction[];
  profileUsername: string;
  profilePassword: string;
  handleProfileSignIn: (username: string, password: string) => Promise<void>;
  handleSignOut: () => Promise<void>;
}

export function useUserMenu(options: UseUserMenuOptions) {
  const {
    showUserPanel,
    userMenuState,
    userInitials,
    userLabel,
    signedInActions,
    profileUsername,
    profilePassword,
    handleProfileSignIn,
    handleSignOut,
  } = options;

  const profileMenuRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const menu = profileMenuRef.current;
    if (!menu || !showUserPanel) {
      return;
    }

    const typedMenu = menu as HTMLElement & {
      type?: UserMenuState;
      size?: "small" | "regular";
      hasRecentlySignedIn?: boolean;
      userInitials?: string;
      userLabel?: string;
      recentUsers?: Array<{ initials: string; label: string }>;
      signedInActions?: UserMenuAction[];
    };

    typedMenu.type = userMenuState;
    typedMenu.size = "small";
    typedMenu.hasRecentlySignedIn = false;
    typedMenu.userInitials = userInitials;
    typedMenu.userLabel = userLabel;
    typedMenu.recentUsers = [{ initials: userInitials, label: userLabel }];
    typedMenu.signedInActions = signedInActions;

    const onSignInClick = (event: Event) => {
      const detail = (event as CustomEvent<UserMenuSignInDetail>).detail;
      const username = detail?.username ?? profileUsername;
      const password = detail?.password ?? profilePassword;
      void handleProfileSignIn(username, password);
    };

    const onSignOutClick = () => {
      void handleSignOut();
    };

    const onSignedInActionClick = () => {
      // Intentionally ignored in this sprint; signed-in menu should only expose sign-out.
    };

    menu.addEventListener("sign-in-click", onSignInClick as EventListener);
    menu.addEventListener("sign-out-click", onSignOutClick as EventListener);
    menu.addEventListener("signed-in-action-click", onSignedInActionClick as EventListener);

    return () => {
      menu.removeEventListener("sign-in-click", onSignInClick as EventListener);
      menu.removeEventListener("sign-out-click", onSignOutClick as EventListener);
      menu.removeEventListener("signed-in-action-click", onSignedInActionClick as EventListener);
    };
  }, [
    handleProfileSignIn,
    handleSignOut,
    profilePassword,
    profileUsername,
    signedInActions,
    userInitials,
    userLabel,
    userMenuState,
    showUserPanel,
  ]);

  return { profileMenuRef };
}
