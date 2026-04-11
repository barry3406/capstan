import { createElement, Component } from "react";
import type { ReactNode, ReactElement, ErrorInfo } from "react";

// ---------------------------------------------------------------------------
// Error boundary props
// ---------------------------------------------------------------------------

export interface ErrorBoundaryProps {
  fallback: ReactElement | ((error: Error, reset: () => void) => ReactElement);
  children?: ReactNode;
  /** Called when an error is caught. Useful for error reporting services. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Maximum number of automatic retries before showing the fallback permanently. */
  maxRetries?: number;
  /** When provided, the error boundary resets whenever this key changes (e.g. the current URL). */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  retryCount: number;
  prevResetKey: string | undefined;
}

/**
 * Error boundary component for catching render errors.
 * Provides reset functionality, automatic retry, and reset-on-navigation.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      error: null,
      retryCount: 0,
      prevResetKey: props.resetKey,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    // Auto-reset when the resetKey changes (e.g. navigation)
    if (props.resetKey !== undefined && props.resetKey !== state.prevResetKey) {
      return {
        error: null,
        retryCount: 0,
        prevResetKey: props.resetKey,
      };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);

    // In development mode, log detailed information
    if (typeof process !== "undefined" && process.env?.["NODE_ENV"] === "development") {
      console.error("[Capstan ErrorBoundary] Caught error:", error);
      if (errorInfo.componentStack) {
        console.error("[Capstan ErrorBoundary] Component stack:", errorInfo.componentStack);
      }
    }
  }

  reset = (): void => {
    this.setState({ error: null, retryCount: 0 });
  };

  retry = (): void => {
    const maxRetries = this.props.maxRetries ?? 0;
    const nextCount = this.state.retryCount + 1;

    if (maxRetries > 0 && nextCount <= maxRetries) {
      this.setState({ error: null, retryCount: nextCount });
    } else {
      // No more retries -- just reset (will show children, which may error again)
      this.setState({ error: null });
    }
  };

  render(): ReactNode {
    if (this.state.error) {
      // Check if we should auto-retry
      const maxRetries = this.props.maxRetries ?? 0;
      if (maxRetries > 0 && this.state.retryCount < maxRetries) {
        // Schedule a retry on the next tick
        setTimeout(() => this.retry(), 0);
        // While retrying, render children (optimistic)
        return this.props.children;
      }

      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error, this.reset);
      }
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Development error details component
// ---------------------------------------------------------------------------

export interface DevErrorDetailsProps {
  error: Error;
  componentStack?: string;
  reset?: () => void;
}

/**
 * Development-mode error details component. Shows the error message,
 * stack trace, and component stack in a readable format.
 * Only intended for use in development -- production should use custom fallbacks.
 */
export function DevErrorDetails(props: DevErrorDetailsProps): ReactElement {
  const { error, componentStack, reset } = props;

  return createElement(
    "div",
    {
      style: {
        fontFamily: "monospace",
        padding: "20px",
        margin: "20px",
        backgroundColor: "#fff0f0",
        border: "2px solid #cc0000",
        borderRadius: "8px",
        maxWidth: "800px",
      },
    },
    createElement("h2", { style: { color: "#cc0000", margin: "0 0 10px 0" } }, "Unhandled Error"),
    createElement(
      "pre",
      {
        style: {
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          backgroundColor: "#fff5f5",
          padding: "12px",
          borderRadius: "4px",
          overflow: "auto",
          maxHeight: "200px",
        },
      },
      error.message,
    ),
    error.stack
      ? createElement(
          "details",
          { style: { marginTop: "10px" } },
          createElement("summary", { style: { cursor: "pointer", fontWeight: "bold" } }, "Stack Trace"),
          createElement(
            "pre",
            {
              style: {
                whiteSpace: "pre-wrap",
                fontSize: "12px",
                backgroundColor: "#f8f8f8",
                padding: "8px",
                borderRadius: "4px",
                overflow: "auto",
                maxHeight: "300px",
              },
            },
            error.stack,
          ),
        )
      : null,
    componentStack
      ? createElement(
          "details",
          { style: { marginTop: "10px" } },
          createElement("summary", { style: { cursor: "pointer", fontWeight: "bold" } }, "Component Stack"),
          createElement(
            "pre",
            {
              style: {
                whiteSpace: "pre-wrap",
                fontSize: "12px",
                backgroundColor: "#f8f8f8",
                padding: "8px",
                borderRadius: "4px",
                overflow: "auto",
                maxHeight: "300px",
              },
            },
            componentStack,
          ),
        )
      : null,
    reset
      ? createElement(
          "button",
          {
            onClick: reset,
            style: {
              marginTop: "12px",
              padding: "8px 16px",
              backgroundColor: "#cc0000",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "monospace",
            },
          },
          "Retry",
        )
      : null,
  );
}

// ---------------------------------------------------------------------------
// Not Found
// ---------------------------------------------------------------------------

/**
 * Not Found component for 404 pages.
 */
export function NotFound({ message }: { message?: string }): ReactElement {
  return createElement("div", { className: "capstan-not-found" },
    createElement("h1", null, "404"),
    createElement("p", null, message ?? "Page not found"),
  );
}
