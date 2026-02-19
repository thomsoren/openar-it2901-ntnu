import "react";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";

declare module "react" {
  namespace JSX {
    type ObcUserMenuUser = {
      initials: string;
      label: string;
    };

    type ObcUserMenuSignedInAction = {
      id: string;
      label: string;
    };

    interface IntrinsicElements {
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
      "obc-user-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: "sign-in" | "user-sign-in" | "loading-sign-in" | "signed-in";
          size?: "regular" | "small";
          hasRecentlySignedIn?: boolean;
          username?: string;
          password?: string;
          usernameError?: string;
          passwordError?: string;
          userInitials?: string;
          userLabel?: string;
          recentUsers?: ObcUserMenuUser[];
          signedInActions?: ObcUserMenuSignedInAction[];
        },
        HTMLElement
      >;
    }
  }
}
