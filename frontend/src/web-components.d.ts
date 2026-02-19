import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "obc-poi-data": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "obc-poi-group": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
