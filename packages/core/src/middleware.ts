import type { MiddlewareDefinition } from "./types.js";

/**
 * Define a Capstan middleware.
 *
 * Accepts either a full `MiddlewareDefinition` object (with optional `name`)
 * or a bare handler function, which is wrapped into a definition with no name.
 *
 * ```ts
 * const logging = defineMiddleware({
 *   name: "logging",
 *   handler: async ({ request, ctx, next }) => {
 *     console.log(request.method, request.url);
 *     return next();
 *   },
 * });
 *
 * // shorthand
 * const logging2 = defineMiddleware(async ({ request, ctx, next }) => {
 *   console.log(request.method, request.url);
 *   return next();
 * });
 * ```
 */
export function defineMiddleware(
  def: MiddlewareDefinition | MiddlewareDefinition["handler"],
): MiddlewareDefinition {
  if (typeof def === "function") {
    return { handler: def };
  }
  return def;
}
