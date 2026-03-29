import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentSurfaceHttpRequest } from "./agent-surface/http.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3333);

function parseUrl(url: string): { path: string; query: Record<string, string> } {
  const parsed = new URL(url, "http://localhost");
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => { query[k] = v; });
  return { path: parsed.pathname, query };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? "GET";
  const { path, query } = parseUrl(req.url ?? "/");

  // Serve human surface at root
  if (method === "GET" && (path === "/" || path === "/index.html")) {
    try {
      const html = await readFile(resolve(APP_ROOT, "human-surface.html"), "utf-8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Failed to load human-surface.html");
    }
    return;
  }

  // Serve agent-surface.json
  if (method === "GET" && path === "/agent-surface.json") {
    try {
      const json = await readFile(resolve(APP_ROOT, "agent-surface.json"), "utf-8");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(json);
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Failed to load agent-surface.json");
    }
    return;
  }

  // Serve capstan.app.json
  if (method === "GET" && path === "/capstan.app.json") {
    try {
      const json = await readFile(resolve(APP_ROOT, "capstan.app.json"), "utf-8");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(json);
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Failed to load capstan.app.json");
    }
    return;
  }

  // Route /api/* to agent surface HTTP transport
  if (path.startsWith("/api/") || path === "/api") {
    const agentPath = path.slice(4) || "/";
    let body: unknown = undefined;

    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const raw = await readBody(req);
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body", code: "invalid_json" }));
          return;
        }
      }
    }

    try {
      const agentResponse = await handleAgentSurfaceHttpRequest({
        method,
        path: agentPath,
        query,
        body
      });
      const headers: Record<string, string> = {
        ...agentResponse.headers,
        "access-control-allow-origin": "*"
      };
      res.writeHead(agentResponse.status, headers);
      res.end(agentResponse.body);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err), code: "server_error" }));
    }
    return;
  }

  // Serve static files from dist/ (compiled JS for human surface browser runtime)
  if (method === "GET" && path.startsWith("/dist/")) {
    const MIME: Record<string, string> = {
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".map": "application/json; charset=utf-8"
    };
    const safePath = path.replace(/\.\./g, "");
    const filePath = resolve(APP_ROOT, safePath.slice(1));
    try {
      await stat(filePath);
      const content = await readFile(filePath);
      const mime = MIME[extname(filePath)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(content);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }
    return;
  }

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization"
    });
    res.end();
    return;
  }

  // 404
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", code: "not_found" }));
});

server.listen(PORT, () => {
  console.log(`OrbitOps running on http://localhost:${PORT}`);
  console.log(`  Human surface:  http://localhost:${PORT}/`);
  console.log(`  Agent surface:  http://localhost:${PORT}/api/manifest`);
  console.log(`  Agent RPC:      POST http://localhost:${PORT}/api/rpc`);
  console.log(`  App graph:      http://localhost:${PORT}/capstan.app.json`);
});
