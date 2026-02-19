import "react";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      // Only lowercase attributes are declared here — they work reliably
      // as JSX attributes in React 18. CamelCase properties (helperText,
      // errorText, hasLeadingIcon, etc.) must be set imperatively via refs.
      "obc-text-input-field": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          value?: string;
          placeholder?: string;
          type?: string;
          label?: string;
          disabled?: boolean;
          error?: boolean;
          name?: string;
          required?: boolean;
          size?: "regular" | "large";
        },
        HTMLElement
      >;
      "obc-poi-data": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          x?: number;
          y?: number;
          buttonY?: number;
          value?: PoiDataValue;
          data?: Array<{ value: string; label: string; unit: string }>;
        },
        HTMLElement
      >;
      "obc-poi-group": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          expand?: boolean;
          positionVertical?: string;
        },
        HTMLElement
      >;
      // CamelCase properties (userInitials, userLabel, usernameError,
      // passwordError, hasRecentlySignedIn, recentUsers, signedInActions)
      // are set imperatively via refs in useUserMenu.ts.
      "obc-user-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: "sign-in" | "user-sign-in" | "loading-sign-in" | "signed-in";
          size?: "regular" | "small";
          username?: string;
          password?: string;
        },
        HTMLElement
      >;
    }
  }
}
