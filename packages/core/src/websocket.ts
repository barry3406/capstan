/**
 * WebSocket support for Capstan.
 *
 * Provides `defineWebSocket()` for declaring WebSocket route handlers and
 * `WebSocketRoom` for pub/sub messaging across connected clients.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Callbacks for handling WebSocket lifecycle events. */
export interface WebSocketHandler {
  /** Called when a client connects. */
  onOpen?: (ws: WebSocketClient) => void;
  /** Called when a message is received. */
  onMessage?: (ws: WebSocketClient, message: string | ArrayBuffer) => void;
  /** Called when the connection closes. */
  onClose?: (ws: WebSocketClient, code: number, reason: string) => void;
  /** Called on error. */
  onError?: (ws: WebSocketClient, error: Error) => void;
}

/** Minimal interface representing a connected WebSocket client. */
export interface WebSocketClient {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

/** A registered WebSocket route returned by {@link defineWebSocket}. */
export interface WebSocketRoute {
  path: string;
  handler: WebSocketHandler;
}

// ---------------------------------------------------------------------------
// defineWebSocket
// ---------------------------------------------------------------------------

/**
 * Define a WebSocket route handler.
 *
 * ```ts
 * const chat = defineWebSocket("/ws/chat", {
 *   onOpen(ws) { console.log("connected"); },
 *   onMessage(ws, msg) { ws.send(`echo: ${msg}`); },
 * });
 * ```
 */
export function defineWebSocket(
  path: string,
  handler: WebSocketHandler,
): WebSocketRoute {
  return { path, handler };
}

// ---------------------------------------------------------------------------
// WebSocketRoom
// ---------------------------------------------------------------------------

/**
 * A room that tracks a set of {@link WebSocketClient}s and provides
 * `broadcast()` for pub/sub messaging.
 */
export class WebSocketRoom {
  private clients = new Set<WebSocketClient>();

  /** Add a client to this room. */
  join(client: WebSocketClient): void {
    this.clients.add(client);
  }

  /** Remove a client from this room. */
  leave(client: WebSocketClient): void {
    this.clients.delete(client);
  }

  /**
   * Send a message to every client in the room whose connection is open
   * (`readyState === 1`).
   *
   * @param message  The string payload to send.
   * @param exclude  An optional client to skip (e.g. the sender).
   */
  broadcast(message: string, exclude?: WebSocketClient): void {
    for (const client of this.clients) {
      if (client !== exclude && client.readyState === 1) {
        client.send(message);
      }
    }
  }

  /** Number of clients currently in the room. */
  get size(): number {
    return this.clients.size;
  }

  /** Close every client connection and empty the room. */
  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
  }
}
