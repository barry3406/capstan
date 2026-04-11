import type { MiddlewareDefinition, PolicyDefinition } from "./types.js";

/**
 * Context object passed to every plugin's `setup()` function.
 *
 * Plugins use this to register routes, policies, and middleware on the host
 * application without coupling to Capstan internals.
 */
export interface CapstanPluginContext {
  /** Register an API route handler at the given HTTP method + path. */
  addRoute(method: string, path: string, handler: unknown): void;
  /** Register a policy that can be referenced by API routes. */
  addPolicy(policy: PolicyDefinition): void;
  /** Register middleware that runs before requests matching `path`. */
  addMiddleware(path: string, middleware: MiddlewareDefinition): void;
  /** Read-only snapshot of the application configuration. */
  config: Record<string, unknown>;
}

/** A Capstan plugin definition. */
export interface CapstanPlugin {
  name: string;
  version?: string;
  setup(ctx: CapstanPluginContext): void | Promise<void>;
}

/**
 * Define a Capstan plugin.
 *
 * This is a simple identity function that provides type checking and
 * editor auto-complete for plugin authors.
 *
 * ```ts
 * export default definePlugin({
 *   name: "my-plugin",
 *   version: "1.0.0",
 *   setup(ctx) {
 *     ctx.addRoute("GET", "/my-plugin/health", myHandler);
 *   },
 * });
 * ```
 */
export function definePlugin(plugin: CapstanPlugin): CapstanPlugin {
  return plugin;
}
