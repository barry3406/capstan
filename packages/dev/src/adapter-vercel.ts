/**
 * Vercel serverless adapter for Capstan.
 * Provides both edge (fetch-based) and Node.js (IncomingMessage/ServerResponse)
 * handlers, plus build configuration generation.
 */

/**
 * Create a Vercel Edge Function handler that delegates to the Hono app.
 */
export function createVercelHandler(app: { fetch: (req: Request) => Promise<Response> }) {
  return async (req: Request) => app.fetch(req);
}

/**
 * Create a Vercel Node.js serverless function handler.
 * Converts Node.js IncomingMessage/ServerResponse to Web API Request/Response.
 */
export function createVercelNodeHandler(app: { fetch: (req: Request) => Promise<Response> }) {
  return async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const init: RequestInit = { method, headers };
    if (hasBody) {
      const buf = await new Promise<Buffer>((resolve) => {
        const c: Buffer[] = [];
        req.on("data", (d: Buffer) => c.push(d));
        req.on("end", () => resolve(Buffer.concat(c)));
      });
      init.body = buf.toString("utf-8");
    }
    const request = new Request(url.toString(), init);
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

/**
 * Generate a `vercel.json`-compatible configuration object for deploying
 * a Capstan application on Vercel.
 */
export function generateVercelConfig(options?: {
  runtime?: "nodejs" | "edge";
  entry?: string;
  buildCommand?: string;
  outputDirectory?: string;
}): Record<string, unknown> {
  const runtime = options?.runtime ?? "nodejs";
  const entry = options?.entry ?? "api/index.js";

  return {
    version: 2,
    buildCommand: options?.buildCommand ?? "npx capstan build",
    outputDirectory: options?.outputDirectory ?? "dist",
    functions: {
      [entry]: runtime === "edge"
        ? {
            runtime: "edge",
          }
        : {
            runtime: "nodejs20.x",
          },
    },
    routes: [
      {
        src: "/(.*)",
        dest: `/${entry.replace(/\.js$/, "")}`,
      },
    ],
  };
}
