/**
 * Fly.io adapter for Capstan.
 * Wraps the Node adapter with Fly-specific write replay support, routing
 * mutating requests to the primary region when running on read replicas.
 */
import { createNodeAdapter } from "./adapter-node.js";
import type { ServerAdapter } from "./adapter.js";

export interface FlyConfig {
  /** The primary Fly.io region where writes should be handled. */
  primaryRegion?: string;
  /** When true, mutating requests from non-primary regions are replayed to the primary. */
  replayWrites?: boolean;
}

/**
 * Create a {@link ServerAdapter} for Fly.io deployments.
 *
 * When `replayWrites` is enabled and a mutating request (POST, PUT, DELETE,
 * PATCH) arrives at a non-primary region, the adapter responds with a `409`
 * and a `fly-replay` header so Fly's proxy routes the request to the primary.
 */
export function createFlyAdapter(config?: FlyConfig): ServerAdapter {
  const node = createNodeAdapter();
  return {
    async listen(app, port, host) {
      const wrapped = {
        fetch: async (req: Request) => {
          if (config?.replayWrites && config?.primaryRegion) {
            const region = process.env["FLY_REGION"];
            const method = req.method;
            if (region && region !== config.primaryRegion && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
              return new Response(null, {
                status: 409,
                headers: { "fly-replay": `region=${config.primaryRegion}` },
              });
            }
          }
          return app.fetch(req);
        },
      };
      return node.listen(wrapped, port, host);
    },
  };
}
