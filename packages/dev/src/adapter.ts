/**
 * Runtime-agnostic server adapter interface.
 *
 * Implementations translate between the Hono `fetch`-based request model and
 * the underlying runtime's HTTP server (Node.js, Bun, Deno, etc.).
 */
export interface ServerAdapter {
  /** Start listening on the given port and host. */
  listen(
    app: { fetch: (req: Request) => Response | Promise<Response> },
    port: number,
    host: string,
  ): Promise<{ close: () => Promise<void> }>;
}
