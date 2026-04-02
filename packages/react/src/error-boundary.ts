import { createElement, Component } from "react";
import type { ReactNode, ReactElement, ErrorInfo } from "react";

export interface ErrorBoundaryProps {
  fallback: ReactElement | ((error: Error, reset: () => void) => ReactElement);
  children?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Error boundary component for catching render errors.
 * Provides reset functionality for retry.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error, this.reset);
      }
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Not Found component for 404 pages.
 */
export function NotFound({ message }: { message?: string }): ReactElement {
  return createElement("div", { className: "capstan-not-found" },
    createElement("h1", null, "404"),
    createElement("p", null, message ?? "Page not found"),
  );
}
