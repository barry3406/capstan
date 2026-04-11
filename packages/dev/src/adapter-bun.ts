import type { ServerAdapter } from "./adapter.js";

/**
 * Create a {@link ServerAdapter} backed by the Bun runtime's built-in HTTP
 * server (`Bun.serve`).
 *
 * This adapter requires the Bun runtime and will fail at invocation time if
 * `Bun` is not available. The dev server auto-detects the runtime and selects
 * this adapter only when running under Bun.
 */
export function createBunAdapter(): ServerAdapter {
  return {
    async listen(app, port, host) {
      // `Bun` is a global in the Bun runtime. TypeScript doesn't ship types
      // for it by default, so we access it dynamically.
      const BunGlobal = globalThis as unknown as {
        Bun: {
          serve: (opts: {
            port: number;
            hostname: string;
            fetch: (req: Request) => Response | Promise<Response>;
          }) => { stop: () => void };
        };
      };

      const server = BunGlobal.Bun.serve({
        port,
        hostname: host,
        fetch: (req) => app.fetch(req),
      });

      return {
        close: async () => {
          server.stop();
        },
      };
    },
  };
}
