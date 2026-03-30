import type { ReactNode, ReactElement } from "react";

export interface LoaderArgs {
  params: Record<string, string>;
  request: Request;
  ctx: {
    auth: {
      isAuthenticated: boolean;
      type: "human" | "agent" | "anonymous" | "workload";
      userId?: string;
      role?: string;
      email?: string;
    };
  };
  /** In-process fetch to call API routes without HTTP round-trip */
  fetch: {
    get: <T = unknown>(path: string, params?: Record<string, string>) => Promise<T>;
    post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
    put: <T = unknown>(path: string, body?: unknown) => Promise<T>;
    delete: <T = unknown>(path: string) => Promise<T>;
  };
}

export type LoaderFunction<T = unknown> = (args: LoaderArgs) => Promise<T>;

export type HydrationMode = "full" | "visible" | "none";

export interface PageModule {
  default: (props: Record<string, unknown>) => ReactElement;
  loader?: LoaderFunction;
  /** Page-level hydration strategy export */
  hydration?: HydrationMode;
  /** Whether the component is a server or client component */
  componentType?: "server" | "client";
}

export interface LayoutModule {
  default: (props: { children?: ReactNode }) => ReactElement;
}

export interface RenderPageOptions {
  pageModule: PageModule;
  layouts: LayoutModule[];
  params: Record<string, string>;
  request: Request;
  loaderArgs: LoaderArgs;
  /** Hydration strategy (default: "full") */
  hydration?: HydrationMode;
  /** Whether the component is a server or client component */
  componentType?: "server" | "client";
}

export interface RenderResult {
  html: string;
  loaderData: unknown;
  statusCode: number;
}

export interface RenderStreamResult {
  stream: ReadableStream<Uint8Array>;
  /** Resolves when the entire document has been emitted (useful for bots/crawlers). */
  allReady: Promise<void>;
  loaderData: unknown;
  statusCode: number;
}

export interface CapstanPageContext {
  loaderData: unknown;
  params: Record<string, string>;
  auth: LoaderArgs["ctx"]["auth"];
}
