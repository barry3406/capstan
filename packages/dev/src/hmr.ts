import path from "node:path";

import { invalidateModuleCache } from "./loader.js";
import { buildHmrClientScript } from "@zauso-ai/capstan-react/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HmrCoordinatorConfig {
  rootDir: string;
  routesDir: string;
  /** Hostname for WebSocket URLs. Default: "localhost" */
  hostname?: string;
  /** Enable Vite HMR when available. Default: true */
  enableViteHmr?: boolean;
  /** Custom handler for when Vite is not available */
  fallbackReload?: () => void;
}

export interface HmrUpdate {
  type:
    | "css"
    | "page"
    | "layout"
    | "api"
    | "middleware"
    | "loading"
    | "error"
    | "config"
    | "full-reload";
  filePath: string;
  timestamp: number;
}

export interface HmrCoordinator {
  /** Handle a file change event and determine what to do. */
  handleFileChange(filePath: string): HmrUpdate;

  /** Classify a file path into an HMR update type. */
  classifyChange(filePath: string): HmrUpdate["type"];

  /** Get the client script to inject (replaces LIVE_RELOAD_SCRIPT). */
  getClientScript(options: { port: number; protocol?: "ws" | "sse" }): string;

  /** Whether Vite HMR is active. */
  readonly viteActive: boolean;

  /** Dispose resources. */
  dispose(): void;
}

export interface HmrTransport {
  /** Broadcast an update to all connected clients. */
  broadcast(update: HmrUpdate): void;

  /** Number of connected clients. */
  readonly clientCount: number;

  /** Handle a new WebSocket-like connection. */
  handleConnection(ws: {
    send: (data: string) => void;
    close: () => void;
  }): void;

  /** Handle an SSE connection. Returns a dispose function to remove the client. */
  handleSSEConnection(response: {
    write: (data: string) => void;
    close: () => void;
  }): () => void;

  /** Remove a previously tracked client (e.g. on disconnect). */
  removeClient(tracked: { send: (data: string) => void; close: () => void }): void;

  /** Dispose all connections. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/** File types that require server-side module cache invalidation. */
const SERVER_SIDE_TYPES = new Set<HmrUpdate["type"]>([
  "api",
  "middleware",
  "config",
]);

/**
 * Normalise a file path to forward slashes so that classification works
 * identically on Windows and POSIX systems.
 */
function normalisePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Classify a file path into an {@link HmrUpdate} type.
 *
 * Classification is intentionally pure — it depends only on the path string
 * and the configured routes directory so it is trivially testable.
 */
function classifyFilePath(
  filePath: string,
  routesDir: string,
): HmrUpdate["type"] {
  if (!filePath) return "full-reload";

  const normalised = normalisePath(filePath);
  const normRoutesDir = normalisePath(routesDir);
  const basename = path.posix.basename(normalised);

  // Config file at any depth
  if (/^capstan\.config\.[a-z]+$/.test(basename)) return "config";

  // CSS files anywhere in the project
  if (normalised.endsWith(".css")) return "css";

  // Route-specific patterns — must live inside the routes directory.
  const inRoutes =
    normalised.startsWith(normRoutesDir + "/") ||
    normalised === normRoutesDir;

  if (inRoutes) {
    if (/\.page\.tsx?$/.test(basename)) return "page";
    if (basename === "_layout.tsx" || basename === "_layout.ts") return "layout";
    if (/\.api\.ts$/.test(basename)) return "api";
    if (basename === "_middleware.ts") return "middleware";
    if (basename === "_loading.tsx" || basename === "_loading.ts")
      return "loading";
    if (basename === "_error.tsx" || basename === "_error.ts") return "error";
  }

  return "full-reload";
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface TrackedClient {
  send: (data: string) => void;
  close: () => void;
  kind: "ws" | "sse";
}

export function createHmrTransport(): HmrTransport {
  const clients = new Set<TrackedClient>();
  let disposed = false;

  return {
    get clientCount(): number {
      return clients.size;
    },

    broadcast(update: HmrUpdate): void {
      if (disposed) return;
      const json = JSON.stringify(update);

      for (const client of clients) {
        try {
          if (client.kind === "sse") {
            client.send(`data: ${json}\n\n`);
          } else {
            client.send(json);
          }
        } catch {
          // Client probably disconnected; remove silently.
          clients.delete(client);
        }
      }
    },

    handleConnection(ws): void {
      if (disposed) return;
      const tracked: TrackedClient = { send: ws.send, close: ws.close, kind: "ws" };
      clients.add(tracked);
    },

    removeClient(tracked: { send: (data: string) => void; close: () => void }): void {
      clients.delete(tracked as TrackedClient);
    },

    handleSSEConnection(response) {
      if (disposed) return () => {};
      const tracked: TrackedClient = {
        send: response.write,
        close: response.close,
        kind: "sse",
      };
      clients.add(tracked);

      // Send an initial comment to flush headers / confirm connection.
      try {
        response.write(": connected\n\n");
      } catch {
        clients.delete(tracked);
      }

      // Return a dispose function that removes the exact tracked reference.
      return () => { clients.delete(tracked); };
    },

    dispose(): void {
      disposed = true;
      for (const client of clients) {
        try {
          client.close();
        } catch {
          /* already closed */
        }
      }
      clients.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export function createHmrCoordinator(
  config: HmrCoordinatorConfig,
): HmrCoordinator {
  if (!config.routesDir) {
    throw new Error("HmrCoordinatorConfig.routesDir is required");
  }

  let lastTimestamp = 0;
  let disposed = false;
  const viteActive = config.enableViteHmr !== false;

  return {
    get viteActive(): boolean {
      return viteActive;
    },

    classifyChange(filePath: string): HmrUpdate["type"] {
      return classifyFilePath(filePath, config.routesDir);
    },

    handleFileChange(filePath: string): HmrUpdate {
      const type = classifyFilePath(filePath, config.routesDir);

      // Guarantee monotonically increasing timestamps even when calls arrive
      // within the same millisecond.
      const now = Date.now();
      lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1;

      // Server-side types need the module cache cleared so the next request
      // picks up the new code.
      if (SERVER_SIDE_TYPES.has(type)) {
        invalidateModuleCache(filePath);
      }

      return { type, filePath, timestamp: lastTimestamp };
    },

    getClientScript(options): string {
      return buildHmrClientScript({
        port: options.port,
        hostname: config.hostname ?? "localhost",
        protocol: options.protocol ?? "sse",
      });
    },

    dispose(): void {
      disposed = true;
    },
  };
}
