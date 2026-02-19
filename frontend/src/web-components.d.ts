import "react";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";

declare module "react" {
  namespace JSX {
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
    }
  }
}
