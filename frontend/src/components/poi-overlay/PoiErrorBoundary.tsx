import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary to catch web component DOM conflicts.
 * Web components with Shadow DOM don't play nicely with React's reconciliation.
 */
class PoiErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    const isWebComponentError =
      error.message.includes("removeChild") ||
      error.message.includes("not a child") ||
      error.name === "NotFoundError";

    if (isWebComponentError) {
      return { hasError: false };
    }
    throw error;
  }

  public componentDidCatch(error: Error) {
    const isWebComponentError =
      error.message.includes("removeChild") ||
      error.message.includes("not a child") ||
      error.name === "NotFoundError";

    if (isWebComponentError) {
      return;
    }
  }

  public render() {
    return this.props.children;
  }
}

export default PoiErrorBoundary;
