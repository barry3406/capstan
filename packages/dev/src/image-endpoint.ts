import {
  createImageOptimizer,
  parseImageQuery,
  ImageOptimizerError,
} from "@zauso-ai/capstan-core";
import type { ImageOptimizerConfig } from "@zauso-ai/capstan-core";

export type { ImageOptimizerConfig };

/**
 * Creates a request handler for the `GET /_capstan/image` endpoint.
 *
 * Transforms images on-demand using sharp (when available) with
 * content-addressable caching and content negotiation.
 */
export function createImageEndpointHandler(
  rootDir: string,
  config?: ImageOptimizerConfig,
): (request: Request) => Promise<Response> {
  const optimizer = createImageOptimizer(rootDir, config);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const parsed = parseImageQuery(url);

    if ("error" in parsed) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { src, options } = parsed;
    const accept = request.headers.get("Accept") ?? undefined;

    try {
      const result = await optimizer.transform(src, options, accept);

      const isAutoFormat =
        options.format === "auto" || options.format === undefined;
      const cacheHeader = optimizer.available
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate";

      const headers: Record<string, string> = {
        "Content-Type": result.contentType,
        "Content-Length": String(result.data.byteLength),
        "Cache-Control": cacheHeader,
        "X-Capstan-Image-Cache":
          result.originalSize === result.optimizedSize && !optimizer.available
            ? "BYPASS"
            : "MISS",
      };

      if (isAutoFormat) {
        headers["Vary"] = "Accept";
      }

      return new Response(result.data as unknown as BodyInit, { status: 200, headers });
    } catch (err: unknown) {
      if (err instanceof ImageOptimizerError) {
        switch (err.code) {
          case "FORBIDDEN":
            return new Response(JSON.stringify({ error: err.message }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          case "NOT_FOUND":
            return new Response(JSON.stringify({ error: err.message }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          case "UNSUPPORTED_FORMAT":
            return new Response(JSON.stringify({ error: err.message }), {
              status: 415,
              headers: { "Content-Type": "application/json" },
            });
          case "INVALID_DIMENSIONS":
            return new Response(JSON.stringify({ error: err.message }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          default:
            return new Response(JSON.stringify({ error: err.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
        }
      }

      const message =
        err instanceof Error ? err.message : "Internal server error";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
