/**
 * Cloudflare Workers adapter for Capstan.
 * Produces an ES module export compatible with the Workers runtime.
 */

/**
 * Create a Cloudflare Workers module-format handler.
 * Returns an object with a `fetch` method matching the Workers module API:
 * `export default { fetch(request, env, ctx) { ... } }`.
 */
export function createCloudflareHandler(app: { fetch: (req: Request) => Promise<Response> }) {
  return {
    async fetch(
      request: Request,
      _env: Record<string, unknown>,
      _ctx: { waitUntil: (p: Promise<unknown>) => void },
    ): Promise<Response> {
      return app.fetch(request);
    },
  };
}

/**
 * Generate a `wrangler.toml` configuration string for deploying a Capstan
 * application on Cloudflare Workers.
 */
export function generateWranglerConfig(name: string): string {
  return generateWranglerConfigWithOptions(name);
}

export function generateWranglerConfigWithOptions(
  name: string,
  options?: {
    main?: string;
    compatibilityDate?: string;
    nodejsCompat?: boolean;
  },
): string {
  const lines = [
    `name = "${name}"`,
    `main = "${options?.main ?? "dist/_worker.js"}"`,
    `compatibility_date = "${options?.compatibilityDate ?? "2026-03-01"}"`,
  ];

  if (options?.nodejsCompat !== false) {
    lines.push(`compatibility_flags = ["nodejs_compat"]`);
  }

  return `${lines.join("\n")}\n`;
}
