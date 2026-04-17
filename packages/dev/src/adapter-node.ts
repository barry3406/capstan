import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";

import type { ServerAdapter } from "./adapter.js";
// WebSocket types are inlined here to avoid a build-order dependency on the
// core package's dist output. They mirror the interfaces exported from
// `@zauso-ai/capstan-core/websocket`.

/** @see WSClient in @zauso-ai/capstan-core */
interface WSClient {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

/** @see WebSocketHandler in @zauso-ai/capstan-core */
interface WSHandler {
  onOpen?: (ws: WSClient) => void;
  onMessage?: (ws: WSClient, message: string | ArrayBuffer) => void;
  onClose?: (ws: WSClient, code: number, reason: string) => void;
  onError?: (ws: WSClient, error: Error) => void;
}

/** @see WSRoute in @zauso-ai/capstan-core */
interface WSRoute {
  path: string;
  handler: WSHandler;
}

// ---------------------------------------------------------------------------
// Live Reload (SSE)
// ---------------------------------------------------------------------------

/**
 * Set of active SSE connections for live reload. When routes are rebuilt the
 * dev server sends an event to every connected client, which triggers a
 * browser page reload.
 */
const sseClients = new Set<ServerResponse>();

/**
 * Notify all connected live-reload clients that routes have changed and the
 * page should reload.
 */
export function notifyLiveReloadClients(): void {
  for (const res of sseClients) {
    try {
      res.write("data: reload\n\n");
    } catch {
      // Client disconnected — remove it.
      sseClients.delete(res);
    }
  }
}

/**
 * Close all open SSE connections. Used during graceful shutdown.
 */
export function closeLiveReloadClients(): void {
  for (const client of sseClients) {
    try { client.end(); } catch { /* already closed */ }
  }
  sseClients.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default maximum request body size: 1 MB */
const DEFAULT_MAX_BODY_SIZE = 1_048_576;

/**
 * Read the full request body from an IncomingMessage and return it
 * as a parsed JSON value (or raw string if JSON parsing fails).
 *
 * If the accumulated body exceeds {@link maxBytes} the request stream is
 * destroyed and the promise rejects with an error whose `statusCode`
 * property is `413`.
 */
function readBody(req: IncomingMessage, maxBytes: number = DEFAULT_MAX_BODY_SIZE): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        const err: Error & { statusCode?: number } = new Error(
          `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
        );
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Node.js adapter
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WebSocket route registry
// ---------------------------------------------------------------------------

const wsRoutes: WSRoute[] = [];

/**
 * Register a {@link WSRoute} so the Node adapter upgrades matching
 * requests to WebSocket connections.
 */
export function registerWSRoute(route: WSRoute): void {
  wsRoutes.push(route);
}

/**
 * Clear all registered WebSocket routes (useful in tests / hot reload).
 */
export function clearWSRoutes(): void {
  wsRoutes.length = 0;
}

export interface NodeAdapterOptions {
  /** Maximum request body size in bytes (default: 1 MB). */
  maxBodySize?: number | undefined;
}

/**
 * Create a {@link ServerAdapter} backed by Node.js `node:http`.
 *
 * Handles SSE live-reload, request body reading, streaming responses via
 * `Readable.fromWeb`, and graceful connection tracking.
 */
export function createNodeAdapter(options?: NodeAdapterOptions): ServerAdapter {
  const maxBodySize = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  return {
    async listen(app, port, host) {
      /** Track active connections so we can drain them during graceful shutdown. */
      const activeConnections = new Set<Socket>();

      /** Whether the server is shutting down (stop accepting new work). */
      let shuttingDown = false;

      const server: Server = createServer(async (req, res) => {
        // Track the underlying socket for graceful shutdown.
        if (req.socket && !activeConnections.has(req.socket)) {
          activeConnections.add(req.socket);
          req.socket.once("close", () => {
            activeConnections.delete(req.socket);
          });
        }

        // Reject new requests while shutting down.
        if (shuttingDown) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Server is shutting down" }));
          return;
        }

        try {
          const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

          // --- HMR SSE endpoint ---------------------------------------------------
          // The new `/__capstan_hmr` endpoint delivers granular HMR updates
          // (CSS hot-swap, page re-fetch, etc.) via Server-Sent Events.
          // The legacy `/__capstan_livereload` endpoint is kept for backward
          // compatibility.
          if (url.pathname === "/__capstan_hmr" || url.pathname === "/__capstan_livereload") {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            });

            // Attempt to register with the HMR transport for granular updates.
            let registeredWithHmr = false;
            let disposeHmrClient: (() => void) | null = null;
            try {
              const { getHmrTransport } = await import("./server.js");
              const transport = getHmrTransport();
              if (transport) {
                disposeHmrClient = transport.handleSSEConnection({
                  write: (data: string) => { res.write(data); },
                  close: () => { try { res.end(); } catch { /* already closed */ } },
                });
                registeredWithHmr = true;
              }
            } catch {
              // HMR transport not available — fall through to legacy.
            }

            if (!registeredWithHmr) {
              // Legacy fallback: plain SSE reload stream.
              res.write(": connected\n\n");
              sseClients.add(res);
            }

            req.on("close", () => {
              sseClients.delete(res);
              // Remove from HMR transport using the exact tracked reference.
              if (disposeHmrClient) disposeHmrClient();
            });
            return;
          }

          // Build a Web API Request from the Node.js IncomingMessage.
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) {
                headers.append(key, v);
              }
            } else {
              headers.set(key, value);
            }
          }

          const hasBody = req.method !== "GET" && req.method !== "HEAD";
          let body: string | undefined;
          if (hasBody) {
            const raw = await readBody(req, maxBodySize);
            body = raw !== undefined ? (typeof raw === "string" ? raw : JSON.stringify(raw)) : undefined;
          }

          const init: RequestInit = {
            method: req.method ?? "GET",
            headers,
          };

          if (body !== undefined) {
            init.body = body;
          }

          const request = new Request(url.toString(), init);
          const response = await app.fetch(request);

          // Stream the Hono response back through the Node.js response.
          res.writeHead(
            response.status,
            Object.fromEntries(response.headers.entries()),
          );
          if (response.body) {
            const readable = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
            readable.on("error", (err) => {
              // eslint-disable-next-line no-console
              console.error("[capstan] Response stream error:", err);
              if (!res.writableEnded) {
                res.end();
              }
            });
            readable.pipe(res);
          } else {
            res.end();
          }
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 413) {
            if (!res.headersSent) {
              res.writeHead(413, { "Content-Type": "application/json" });
            }
            res.end(JSON.stringify({ error: "Payload Too Large" }));
            return;
          }
          // eslint-disable-next-line no-console
          console.error("[capstan] Unhandled request error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
          }
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      });

      // -----------------------------------------------------------------
      // WebSocket upgrade handling (uses `ws` package when available)
      // -----------------------------------------------------------------
      server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
        const matched = wsRoutes.find((r) => r.path === url.pathname);
        if (!matched) {
          socket.destroy();
          return;
        }

        try {
          // Dynamically import `ws` so it remains an optional dependency.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wsMod: any = await (import("ws" as string) as Promise<any>);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wss = new wsMod.WebSocketServer({ noServer: true }) as any;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wss.handleUpgrade(req, socket, head, (rawWs: any) => {
            const client: WSClient = {
              send: (data: string | ArrayBuffer) => {
                if (rawWs.readyState === 1) { // WebSocket.OPEN
                  rawWs.send(data);
                }
              },
              close: (code?: number, reason?: string) => {
                rawWs.close(code, reason);
              },
              get readyState() {
                return rawWs.readyState as number;
              },
            };

            if (matched.handler.onOpen) matched.handler.onOpen(client);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rawWs.on("message", (data: any) => {
              if (matched.handler.onMessage) {
                const msg = typeof data === "string" ? data : data.toString();
                matched.handler.onMessage(client, msg);
              }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rawWs.on("close", (code: any, reason: any) => {
              if (matched.handler.onClose) {
                matched.handler.onClose(client, code, reason.toString());
              }
            });

            rawWs.on("error", (err: Error) => {
              if (matched.handler.onError) {
                matched.handler.onError(client, err);
              }
            });
          });
        } catch {
          // `ws` package not installed — reject the upgrade.
          socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
          socket.destroy();
        }
      });

      return new Promise((resolve, reject) => {
        server.on("error", (err) => {
          reject(err);
        });

        server.listen(port, host, () => {
          resolve({
            close: () => {
              shuttingDown = true;

              return new Promise<void>((closeResolve) => {
                // Close all open SSE connections so they don't keep the server alive.
                closeLiveReloadClients();

                // Stop accepting new connections.
                server.close(() => {
                  closeResolve();
                });

                // Wait for active connections to drain (with a 5 s timeout).
                const SHUTDOWN_TIMEOUT = 5_000;
                const timer = setTimeout(() => {
                  // Force-close remaining connections after timeout.
                  for (const socket of activeConnections) {
                    try { socket.destroy(); } catch { /* already closed */ }
                  }
                  activeConnections.clear();
                }, SHUTDOWN_TIMEOUT);

                // Don't let the timer keep the process alive if all connections
                // close before the timeout fires.
                if (typeof timer === "object" && "unref" in timer) {
                  timer.unref();
                }
              });
            },
          });
        });
      });
    },
  };
}
