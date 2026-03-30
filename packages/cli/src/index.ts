#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// Known commands for fuzzy matching
// ---------------------------------------------------------------------------

const KNOWN_COMMANDS = [
  "dev", "build", "start",
  "add",
  "db:migrate", "db:push", "db:status",
  "verify",
  "mcp",
  "agent:manifest", "agent:openapi",
] as const;

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= an; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bn; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,       // deletion
        matrix[i]![j - 1]! + 1,       // insertion
        matrix[i - 1]![j - 1]! + cost // substitution
      );
    }
  }

  return matrix[an]![bn]!;
}

/**
 * Find the closest matching command using Levenshtein distance.
 * Returns the match only if it's within a reasonable edit distance.
 */
function findClosestCommand(input: string, commands: readonly string[] = KNOWN_COMMANDS): string | undefined {
  let bestMatch: string | undefined;
  let bestDistance = Infinity;

  for (const cmd of commands) {
    const dist = levenshtein(input, cmd);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = cmd;
    }
  }

  // Only suggest if the edit distance is at most 3 or the input is a prefix
  const maxAllowed = Math.max(2, Math.floor((bestMatch?.length ?? 0) / 2));
  if (bestDistance <= Math.min(3, maxAllowed)) {
    return bestMatch;
  }

  return undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "dev":
      await runDev(args);
      return;
    case "build":
      await runBuild();
      return;
    case "start":
      await runStart(args);
      return;
    case "verify":
      await runVerify(args, args.includes("--json"));
      return;
    case "db:migrate":
      await runDbMigrate(args);
      return;
    case "db:push":
      await runDbPush();
      return;
    case "db:status":
      await runDbStatus();
      return;
    case "mcp":
      await runMcp();
      return;
    case "agent:manifest":
      await runAgentManifest();
      return;
    case "agent:openapi":
      await runAgentOpenapi();
      return;
    case "add":
      await runAdd(args);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default: {
      console.error(pc.red(`Unknown command: "${command}"`));
      const suggestion = findClosestCommand(command);
      if (suggestion) {
        console.error(`\n  Did you mean ${pc.cyan(suggestion)}?\n`);
      } else {
        console.error(`\n  Run ${pc.cyan("capstan help")} to see available commands.\n`);
      }
      process.exitCode = 1;
    }
  }
}

async function runVerify(args: string[], asJson: boolean): Promise<void> {
  // Strip --json from args to get the positional target
  const positional = args.filter((a) => a !== "--json");
  const target = positional[0];

  // Target is optional (defaults to cwd)
  const appRoot = target ? resolve(process.cwd(), target) : process.cwd();

  const hasAppRoutes = existsSync(join(appRoot, "app", "routes"));

  if (hasAppRoutes) {
    const { verifyCapstanApp, renderRuntimeVerifyText } = await import("@zauso-ai/capstan-core");
    const report = await verifyCapstanApp(appRoot);

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(renderRuntimeVerifyText(report));
    }

    if (report.status === "failed") {
      process.exitCode = 1;
    }
    return;
  }

  console.error(pc.red("Could not detect project type."));
  console.error(pc.dim("  - Ensure app/routes/ directory exists."));
  if (target) {
    console.error(pc.dim(`  Looked in: ${appRoot}`));
  } else {
    console.error(pc.dim(`  Looked in: ${process.cwd()}`));
    console.error(pc.yellow("  Tip: run from your project root, or pass the directory as an argument."));
  }
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Dev / Build / Start
// ---------------------------------------------------------------------------

async function runDev(args: string[]): Promise<void> {
  // Spawn a child process with --import tsx so that dynamic import() of .ts
  // and .tsx route files works. Node.js cannot natively handle .tsx, and
  // register("tsx/esm") was deprecated in Node v20.6+.
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { resolve: resolvePath } = await import("node:path");

  // Locate the tsx package entry for --import
  let tsxImportSpecifier: string;
  try {
    const tsxPkgPath = await import("node:module").then(m =>
      m.createRequire(import.meta.url).resolve("tsx/esm"),
    );
    // --import requires a file:// URL or bare specifier
    tsxImportSpecifier = "tsx";
  } catch {
    tsxImportSpecifier = "tsx";
  }

  // Build an inline script that starts the dev server
  const port = readFlagValue(args, "--port") ?? "3000";
  const host = readFlagValue(args, "--host") ?? "localhost";

  const devScript = `
    import { createDevServer } from "@zauso-ai/capstan-dev";
    import { pathToFileURL } from "node:url";
    import { existsSync } from "node:fs";
    import { resolve } from "node:path";

    const port = ${parseInt(port, 10)};
    const host = "${host}";
    const cwd = process.cwd();

    let appName = "capstan-app";
    let appDescription;
    for (const name of ["capstan.config.ts", "capstan.config.js"]) {
      const p = resolve(cwd, name);
      if (existsSync(p)) {
        try {
          const mod = await import(pathToFileURL(p).href);
          if (mod.default?.app?.name) appName = mod.default.app.name;
          if (mod.default?.app?.description) appDescription = mod.default.app.description;
        } catch {}
        break;
      }
    }

    const server = await createDevServer({ rootDir: cwd, port, host, appName, ...(appDescription ? { appDescription } : {}) });
    await server.start();
  `;

  const child = spawn(
    process.execPath,
    ["--import", tsxImportSpecifier, "--input-type=module", "-e", devScript],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env },
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Forward SIGINT / SIGTERM to child
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

async function runBuild(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const { mkdir, writeFile, cp, access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { generateAgentManifest, generateOpenApiSpec } = await import("@zauso-ai/capstan-agent");

  const cwd = process.cwd();
  const distDir = join(cwd, "dist");

  // Step 1: TypeScript compilation
  console.log(pc.dim("[capstan]") + " Compiling TypeScript...");
  try {
    await exec("npx", ["tsc", "-p", "tsconfig.json"], { cwd });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`[capstan] TypeScript compilation failed:\n${message}`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.dim("[capstan]") + pc.green(" TypeScript compilation complete."));

  // Step 2: Load app config
  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string; app?: { name?: string; description?: string } };
      };
      if (mod.default?.app?.name) appName = mod.default.app.name;
      else if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.app?.description) appDescription = mod.default.app.description;
      else if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  // Step 3: Scan routes and build manifest with compiled paths
  const routesDir = join(cwd, "app", "routes");
  console.log(pc.dim("[capstan]") + " Scanning routes...");
  const manifest = await scanRoutes(routesDir);

  // Rewrite file paths from source .ts/.tsx to compiled .js/.jsx
  // and make them relative to the dist directory
  const rewrittenManifest = {
    ...manifest,
    rootDir: join(distDir, "app", "routes"),
    routes: manifest.routes.map((route) => ({
      ...route,
      filePath: route.filePath
        .replace(cwd, distDir)
        .replace(/\.tsx$/, ".jsx")
        .replace(/\.ts$/, ".js"),
      layouts: route.layouts.map((l) =>
        l.replace(cwd, distDir).replace(/\.tsx$/, ".jsx").replace(/\.ts$/, ".js"),
      ),
      middlewares: route.middlewares.map((m) =>
        m.replace(cwd, distDir).replace(/\.tsx$/, ".jsx").replace(/\.ts$/, ".js"),
      ),
    })),
  };

  await mkdir(distDir, { recursive: true });
  await writeFile(
    join(distDir, "_capstan_manifest.json"),
    JSON.stringify(rewrittenManifest, null, 2),
  );
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/_capstan_manifest.json"));

  // Step 4: Generate agent-manifest.json and openapi.json
  const registryEntries = manifest.routes
    .filter((r) => r.type === "api")
    .flatMap((r) => {
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      return methods.map((m) => ({
        method: m,
        path: r.urlPattern,
      }));
    });

  const agentConfig = { name: appName, ...(appDescription ? { description: appDescription } : {}) };
  const agentManifest = generateAgentManifest(agentConfig, registryEntries);
  const openApiSpec = generateOpenApiSpec(agentConfig, registryEntries);

  await writeFile(join(distDir, "agent-manifest.json"), JSON.stringify(agentManifest, null, 2));
  await writeFile(join(distDir, "openapi.json"), JSON.stringify(openApiSpec, null, 2));
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/agent-manifest.json"));
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/openapi.json"));

  // Step 5: Copy public/ assets to dist/public/ (if the directory exists)
  const publicDir = join(cwd, "app", "public");
  try {
    await access(publicDir);
    await cp(publicDir, join(distDir, "public"), { recursive: true });
    console.log(pc.dim("[capstan]") + pc.green(" Copied app/public/ to dist/public/"));
  } catch {
    // No public directory — skip.
  }

  // Step 6: Generate the production server entry file
  const serverEntry = `import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { createRequestLogger, csrfProtection } from "@zauso-ai/capstan-core";

const cwd = process.cwd();
const distDir = resolve(cwd, "dist");

// Read the pre-built route manifest
const manifestPath = join(distDir, "_capstan_manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

const port = parseInt(process.env.CAPSTAN_PORT ?? process.env.PORT ?? "3000", 10);
const host = process.env.CAPSTAN_HOST ?? "0.0.0.0";
const MAX_BODY_SIZE = parseInt(process.env.CAPSTAN_MAX_BODY_SIZE ?? "1048576", 10);

async function main() {
  const app = new Hono();
  app.use("*", createRequestLogger());

  // --- CORS configuration ---------------------------------------------------
  // Production CORS is restricted by default.  Set CAPSTAN_CORS_ORIGIN to
  // control allowed origins:
  //   "*"             — allow all origins (explicit opt-in)
  //   "https://a.com" — allow only that origin
  //   not set         — same-origin only (Origin must match the server host)
  const corsOriginEnv = process.env.CAPSTAN_CORS_ORIGIN;

  if (corsOriginEnv === "*") {
    // Explicit opt-in to allow all origins.
    app.use("*", cors());
  } else {
    app.use("*", cors({
      origin: (origin, c) => {
        if (corsOriginEnv) {
          // Explicit allowed origin configured.
          return origin === corsOriginEnv ? origin : null;
        }
        // No env var — restrict to same-origin: only allow the Origin if it
        // matches the server's own host (scheme + host + port).
        try {
          const reqHost = c.req.header("host") ?? "";
          const originUrl = new URL(origin);
          const originHost = originUrl.host; // includes port
          if (originHost === reqHost) {
            return origin;
          }
        } catch {
          // Malformed origin — deny.
        }
        return null;
      },
    }));
  }

  // --- Auth middleware -------------------------------------------------------
  // Load config from the compiled capstan.config.js to obtain auth settings.
  // If auth config exists, create a real auth resolver via @zauso-ai/capstan-auth
  // so that session cookies and API keys are verified on every request.

  let resolveAuth = null;
  let appConfig = null;

  const configCandidates = [
    join(distDir, "capstan.config.js"),
    join(cwd, "capstan.config.js"),
  ];

  for (const candidate of configCandidates) {
    if (existsSync(candidate)) {
      try {
        const configUrl = pathToFileURL(candidate).href;
        const configMod = await import(configUrl);
        appConfig = configMod.default ?? configMod;
        break;
      } catch (err) {
        console.warn("[capstan] Failed to load config from " + candidate + ":", err?.message ?? err);
      }
    }
  }

  // Derive auth config: support both CapstanConfig shape (auth.session) and
  // the flat AuthConfig shape ({ session: { secret } }).
  const authCfg = appConfig?.auth ?? null;
  const authSessionConfig = authCfg?.session ?? null;

  if (authSessionConfig && authSessionConfig.secret) {
    try {
      const authPkg = await import("@zauso-ai/capstan-auth");
      resolveAuth = authPkg.createAuthMiddleware(
        {
          session: {
            secret: authSessionConfig.secret,
            maxAge: authSessionConfig.maxAge,
          },
          apiKeys: authCfg.apiKeys ?? undefined,
        },
        {
          findAgentByKeyPrefix: appConfig?.findAgentByKeyPrefix ?? undefined,
        },
      );
      console.log(pc.dim("[capstan]") + " Auth middleware enabled (session + API key verification).");
    } catch (err) {
      console.warn("[capstan] @zauso-ai/capstan-auth not available. Auth middleware disabled.", err?.message ?? "");
    }
  } else {
    console.warn("[capstan] No auth config found. All requests will be treated as anonymous.");
  }

  // Hono middleware: resolve auth for every request and store on context.
  app.use("*", async (c, next) => {
    if (resolveAuth) {
      try {
        const authCtx = await resolveAuth(c.req.raw);
        c.set("capstanAuth", authCtx);
      } catch (err) {
        console.error(pc.red("[capstan] Auth resolution error:"), err?.message ?? err);
        c.set("capstanAuth", { isAuthenticated: false, type: "anonymous", permissions: [] });
      }
    }
    await next();
  });

  // --- CSRF middleware -------------------------------------------------------
  // Only enable CSRF protection when cookie-based session auth is configured.
  if (authSessionConfig && authSessionConfig.secret) {
    app.use("*", csrfProtection());
  }

  // Helper: build a CapstanContext from Hono context, using resolved auth.
  function buildCtx(c) {
    const authFromMiddleware = c.get("capstanAuth");
    return {
      auth: authFromMiddleware ?? { isAuthenticated: false, type: "anonymous", permissions: [] },
      request: c.req.raw,
      env: process.env,
      honoCtx: c,
    };
  }

  // --- Policy loading --------------------------------------------------------
  // Load user-defined policies from dist/app/policies/index.js (if present).
  // This mirrors enforcePolicies from @zauso-ai/capstan-core so that custom
  // policies (beyond "requireAuth") are enforced in production.

  const policyRegistry = new Map();
  let enforcePoliciesFn = null;

  try {
    const corePkg = await import("@zauso-ai/capstan-core");
    if (typeof corePkg.enforcePolicies === "function") {
      enforcePoliciesFn = corePkg.enforcePolicies;
    }
  } catch {
    // @zauso-ai/capstan-core not available.
  }

  const policiesIndexPath = join(distDir, "app", "policies", "index.js");
  if (existsSync(policiesIndexPath)) {
    try {
      const policiesMod = await import(pathToFileURL(policiesIndexPath).href);
      const exports = policiesMod.default ?? policiesMod;
      if (exports && typeof exports === "object") {
        for (const [key, value] of Object.entries(exports)) {
          if (value && typeof value === "object" && "check" in value) {
            policyRegistry.set(value.key ?? key, value);
          }
        }
      }
      if (policyRegistry.size > 0) {
        console.log(pc.dim("[capstan]") + " Loaded " + policyRegistry.size + " custom policies from app/policies/index.js");
      }
    } catch (err) {
      console.warn("[capstan] Failed to load policies from " + policiesIndexPath + ":", err?.message ?? err);
    }
  }

  // Built-in requireAuth policy used when no custom override exists.
  const builtinRequireAuth = {
    key: "requireAuth",
    title: "Require Authentication",
    effect: "deny",
    check: async ({ ctx }) => {
      if (ctx.auth.isAuthenticated) return { effect: "allow" };
      return { effect: "deny", reason: "Authentication required" };
    },
  };

  // Enforce all policies for a handler. Returns null if allowed, or a Response
  // if the request should be blocked/deferred.
  async function enforceHandlerPolicy(c, ctx, handler, input) {
    if (!handler.policy) return null;

    const policyName = handler.policy;
    const policyDef = policyRegistry.get(policyName)
      ?? (policyName === "requireAuth" ? builtinRequireAuth : null);

    if (!policyDef) {
      // Unknown policy in production: deny by default (fail closed).
      console.warn("[capstan] Unknown policy: " + policyName + ". Denying request (fail closed).");
      return c.json({ error: "Forbidden", reason: "Unknown policy: " + policyName }, 403);
    }

    let result;
    if (enforcePoliciesFn) {
      result = await enforcePoliciesFn([policyDef], ctx, input);
    } else {
      result = await policyDef.check({ ctx, input });
    }

    if (result.effect === "deny") {
      return c.json(
        { error: "Forbidden", reason: result.reason ?? "Policy denied", policy: policyName },
        403,
      );
    }

    if (result.effect === "approve") {
      try {
        const corePkg = await import("@zauso-ai/capstan-core");
        if (typeof corePkg.createApproval === "function") {
          const approval = corePkg.createApproval({
            method: c.req.method,
            path: c.req.path,
            input,
            policy: policyName,
            reason: result.reason ?? "This action requires approval",
          });
          return c.json(
            {
              status: "approval_required",
              approvalId: approval.id,
              reason: result.reason ?? "This action requires approval",
              pollUrl: "/capstan/approvals/" + approval.id,
            },
            202,
          );
        }
      } catch {}
      return c.json(
        { error: "Forbidden", reason: "Approval required but approval system unavailable", policy: policyName },
        403,
      );
    }

    return null;
  }

  // Serve static assets from dist/public/ if present
  try {
    app.use("/public/*", serveStatic({ root: distDir }));
  } catch {
    // serveStatic not available or dist/public/ does not exist
  }

  // Route metadata for framework endpoints
  const routeRegistry = [];

  let apiRouteCount = 0;
  let pageRouteCount = 0;

  // Register API routes from the manifest
  for (const route of manifest.routes) {
    if (route.type !== "api") continue;

    let handlers;
    try {
      const moduleUrl = pathToFileURL(route.filePath).href;
      handlers = await import(moduleUrl);
    } catch (err) {
      console.error(pc.red("[capstan] Failed to load API route " + route.filePath + ":"), err?.message ?? err);
      continue;
    }

    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    for (const method of methods) {
      const handler = handlers[method];
      if (handler === undefined) continue;

      apiRouteCount++;

      const isApiDef = handler !== null && typeof handler === "object" && "handler" in handler && typeof handler.handler === "function";
      const meta = { method, path: route.urlPattern };
      if (isApiDef && handler.description) meta.description = handler.description;
      if (isApiDef && handler.capability) meta.capability = handler.capability;
      routeRegistry.push(meta);

      const honoMethod = method.toLowerCase();
      app[honoMethod](route.urlPattern, async (c) => {
        let input;
        try {
          if (method === "GET") {
            input = Object.fromEntries(new URL(c.req.url).searchParams);
          } else {
            const ct = c.req.header("content-type") ?? "";
            if (ct.includes("application/json")) {
              input = await c.req.json();
            } else {
              input = {};
            }
          }
        } catch {
          input = {};
        }

        const ctx = buildCtx(c);

        try {
          if (isApiDef) {
            // Policy enforcement using auth-resolved ctx and loaded policies.
            const policyResponse = await enforceHandlerPolicy(c, ctx, handler, input);
            if (policyResponse !== null) return policyResponse;

            const result = await handler.handler({ input, ctx });
            return c.json(result);
          }
          if (typeof handler === "function") {
            const result = await handler({ input, ctx });
            return c.json(result);
          }
          return c.json({ error: "Invalid handler export" }, 500);
        } catch (err) {
          if (err && typeof err === "object" && "issues" in err && Array.isArray(err.issues)) {
            return c.json({ error: "Validation Error", issues: err.issues }, 400);
          }
          console.error(pc.red("[capstan] Request error:"), err);
          const message = "Internal Server Error";
          return c.json({ error: message }, 500);
        }
      });
    }
  }

  // Register page routes from the manifest
  for (const route of manifest.routes) {
    if (route.type !== "page") continue;

    let pageModule;
    try {
      const moduleUrl = pathToFileURL(route.filePath).href;
      pageModule = await import(moduleUrl);
    } catch (err) {
      console.error(pc.red("[capstan] Failed to load page " + route.filePath + ":"), err?.message ?? err);
      continue;
    }

    if (!pageModule.default) continue;
    pageRouteCount++;

    app.get(route.urlPattern, async (c) => {
      const params = {};
      for (const name of route.params) {
        const value = c.req.param(name);
        if (value !== undefined) params[name] = value;
      }

      const ctx = buildCtx(c);

      let loaderData = null;
      if (typeof pageModule.loader === "function") {
        try {
          loaderData = await pageModule.loader({
            params,
            request: c.req.raw,
            ctx: { auth: ctx.auth },
            fetch: { get: async () => null, post: async () => null, put: async () => null, delete: async () => null },
          });
        } catch (err) {
          console.error(pc.red("[capstan] Loader error in " + route.filePath + ":"), err?.message ?? err);
        }
      }

      // Attempt SSR via @zauso-ai/capstan-react
      try {
        const reactPkg = await import("@zauso-ai/capstan-react");
        const result = await reactPkg.renderPage({
          pageModule: { default: pageModule.default, loader: pageModule.loader },
          layouts: [],
          params,
          request: c.req.raw,
          loaderArgs: {
            params,
            request: c.req.raw,
            ctx: { auth: ctx.auth },
            fetch: { get: async () => null, post: async () => null, put: async () => null, delete: async () => null },
          },
        });
        return c.html(result.html, result.statusCode);
      } catch {
        // Fallback minimal HTML
        const html = \`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${appName.replace(/"/g, "&quot;")}</title></head>
<body>
  <div id="capstan-root"><p>Page: \${route.urlPattern}</p></div>
  <script>window.__CAPSTAN_DATA__ = \${JSON.stringify({ loaderData, params }).replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')}</script>
</body>
</html>\`;
        return c.html(html);
      }
    });
  }

  // Read pre-built agent-manifest.json and openapi.json
  let agentManifestJson = null;
  let openApiJson = null;
  try { agentManifestJson = JSON.parse(readFileSync(join(distDir, "agent-manifest.json"), "utf-8")); } catch {}
  try { openApiJson = JSON.parse(readFileSync(join(distDir, "openapi.json"), "utf-8")); } catch {}

  // Framework endpoints
  app.get("/.well-known/capstan.json", (c) => {
    if (agentManifestJson) return c.json(agentManifestJson);
    return c.json({ error: "Agent manifest not found" }, 404);
  });
  app.get("/openapi.json", (c) => {
    if (openApiJson) return c.json(openApiJson);
    return c.json({ error: "OpenAPI spec not found" }, 404);
  });
  app.get("/health", (c) => {
    return c.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Approval management endpoints (if @zauso-ai/capstan-core is available)
  // All approval endpoints require authentication and either the "admin" role
  // or the "approval:manage" permission.  Fail closed if auth is unavailable.
  function requireApprovalAuth(c) {
    const auth = c.get("capstanAuth");
    if (!auth || !auth.isAuthenticated) {
      return c.json({ error: "Authentication required to manage approvals" }, 401);
    }
    const perms = auth.permissions ?? [];
    const isAdmin = auth.role === "admin";
    const hasPermission = perms.includes("approval:manage");
    if (!isAdmin && !hasPermission) {
      return c.json({ error: "Forbidden: approval:manage permission required" }, 403);
    }
    return null;
  }

  try {
    const corePkg = await import("@zauso-ai/capstan-core");
    if (typeof corePkg.listApprovals === "function") {
      app.get("/capstan/approvals", (c) => {
        const authErr = requireApprovalAuth(c);
        if (authErr) return authErr;
        const status = new URL(c.req.url).searchParams.get("status") ?? undefined;
        const approvals = corePkg.listApprovals(status);
        return c.json({ approvals });
      });
      app.get("/capstan/approvals/:id", (c) => {
        const authErr = requireApprovalAuth(c);
        if (authErr) return authErr;
        const approval = corePkg.getApproval(c.req.param("id"));
        if (!approval) return c.json({ error: "Approval not found" }, 404);
        return c.json(approval);
      });
      app.post("/capstan/approvals/:id/resolve", async (c) => {
        const authErr = requireApprovalAuth(c);
        if (authErr) return authErr;
        let body;
        try { body = await c.req.json(); } catch { body = {}; }
        const decision = body.decision === "approved" ? "approved" : "denied";
        const approval = corePkg.resolveApproval(c.req.param("id"), decision, body.resolvedBy);
        if (!approval) return c.json({ error: "Approval not found" }, 404);
        return c.json(approval);
      });
    }
  } catch {
    // Approval endpoints not available.
  }

  // Start HTTP server
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://" + (req.headers.host ?? host + ":" + port));
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) { for (const v of value) headers.append(key, v); }
        else headers.set(key, value);
      }

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      let body;
      if (hasBody) {
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          let received = 0;
          req.on("data", (c) => {
            received += c.length;
            if (received > MAX_BODY_SIZE) {
              req.destroy();
              const err = new Error("Request body exceeds maximum allowed size of " + MAX_BODY_SIZE + " bytes");
              err.statusCode = 413;
              reject(err);
              return;
            }
            chunks.push(c);
          });
          req.on("error", reject);
          req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            resolve(raw.length > 0 ? raw : undefined);
          });
        });
      }

      const init = { method: req.method ?? "GET", headers };
      if (body !== undefined) init.body = body;

      const request = new Request(url.toString(), init);
      const response = await app.fetch(request);

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      const responseBody = await response.text();
      res.end(responseBody);
    } catch (err) {
      if (err && err.statusCode === 413) {
        if (!res.headersSent) res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload Too Large" }));
        return;
      }
      console.error(pc.red("[capstan] Unhandled request error:"), err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  // Track active connections for graceful shutdown.
  const activeConnections = new Set();

  server.on("connection", (socket) => {
    activeConnections.add(socket);
    socket.once("close", () => activeConnections.delete(socket));
  });

  server.listen(port, host, () => {
    console.log("");
    console.log(pc.bold("  Capstan production server running"));
    console.log("  Local:  " + pc.cyan("http://" + (host === "0.0.0.0" ? "localhost" : host) + ":" + port));
    console.log(pc.dim("  Routes: " + (apiRouteCount + pageRouteCount) + " total (" + apiRouteCount + " API, " + pageRouteCount + " pages)"));
    if (resolveAuth) console.log(pc.green("  Auth:   enabled"));
    else console.log(pc.dim("  Auth:   disabled (no auth config)"));
    if (policyRegistry.size > 0) console.log(pc.dim("  Policies: " + policyRegistry.size + " custom policies loaded"));
    console.log("");
  });

  // --- Graceful shutdown ---------------------------------------------------
  let shuttingDown = false;

  function gracefulShutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down gracefully...");

    // Stop accepting new connections.
    server.close(() => {
      process.exit(0);
    });

    // Force-close remaining connections after 5 seconds.
    const timer = setTimeout(() => {
      for (const socket of activeConnections) {
        try { socket.destroy(); } catch {}
      }
      process.exit(0);
    }, 5000);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  }

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}

main().catch((err) => {
  console.error(pc.red("[capstan] Fatal error starting production server:"), err);
  process.exit(1);
});
`;

  await writeFile(join(distDir, "_capstan_server.js"), serverEntry);
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/_capstan_server.js"));
  console.log(pc.dim("[capstan]") + pc.green(" Build complete."));
}

async function runStart(args: string[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { access } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const cwd = process.cwd();
  const serverEntry = join(cwd, "dist", "_capstan_server.js");

  // Verify the production build exists
  try {
    await access(serverEntry);
  } catch {
    console.error(pc.red("[capstan] dist/_capstan_server.js not found."));
    console.error(pc.yellow("[capstan] Run `capstan build` first to compile the project."));
    process.exitCode = 1;
    return;
  }

  const port = readFlagValue(args, "--port") ?? "3000";
  const host = readFlagValue(args, "--host") ?? "0.0.0.0";

  const child = spawn(
    process.execPath,
    [serverEntry],
    {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        CAPSTAN_PORT: port,
        CAPSTAN_HOST: host,
      },
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Forward SIGINT / SIGTERM to child
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

// ---------------------------------------------------------------------------
// Database commands
// ---------------------------------------------------------------------------

async function runDbMigrate(args: string[]): Promise<void> {
  const name = readFlagValue(args, "--name");
  if (!name) {
    console.error(pc.red("Usage: capstan db:migrate --name <migration-name>"));
    process.exitCode = 1;
    return;
  }

  const { mkdir, readdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { generateMigration } = await import("@zauso-ai/capstan-db");

  const migrationsDir = join(process.cwd(), "app", "migrations");
  await mkdir(migrationsDir, { recursive: true });

  // Collect existing model definitions from app/models/ if present
  const modelsDir = join(process.cwd(), "app", "models");
  let toModels: Array<{ name: string; fields: Record<string, unknown>; indexes: unknown[] }> = [];
  try {
    const modelFiles = await readdir(modelsDir);
    for (const file of modelFiles) {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        const moduleUrl = pathToFileURL(join(modelsDir, file)).href;
        const mod = (await import(moduleUrl)) as Record<string, unknown>;
        // Look for exported model definitions
        for (const value of Object.values(mod)) {
          if (
            value &&
            typeof value === "object" &&
            "name" in value &&
            "fields" in value
          ) {
            toModels.push(value as typeof toModels[number]);
          }
        }
      }
    }
  } catch {
    // No models directory — generate an empty migration.
  }

  const statements = generateMigration([], toModels as never[]);
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const filename = `${timestamp}_${name}.sql`;
  const content = statements.length > 0
    ? statements.join(";\n") + ";\n"
    : "-- empty migration\n";

  await writeFile(join(migrationsDir, filename), content);
  console.log(pc.green(`Created migration: app/migrations/${filename}`));
}

async function loadDbConfig(): Promise<{ provider: "sqlite" | "postgres" | "mysql"; url: string }> {
  let provider: "sqlite" | "postgres" | "mysql" = "sqlite";
  let url: string = join(process.cwd(), "app", "data", "app.db");

  const configPath = await resolveConfig();
  if (configPath) {
    try {
      const configUrl = pathToFileURL(configPath).href;
      const configMod = (await import(configUrl)) as {
        default?: { database?: { provider?: string; url?: string } };
      };
      if (configMod.default?.database?.provider) {
        provider = configMod.default.database.provider as typeof provider;
      }
      if (configMod.default?.database?.url) {
        url = configMod.default.database.url;
      }
    } catch {
      // Config load failed — use defaults.
    }
  }

  return { provider, url };
}

async function runDbPush(): Promise<void> {
  const { readdir, readFile: readMigrationFile, mkdir: mkdirFs } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { createDatabase, applyTrackedMigrations } = await import("@zauso-ai/capstan-db");

  const migrationsDir = join(process.cwd(), "app", "migrations");
  let files: string[];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.log("No migrations directory found at app/migrations/.");
    return;
  }

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const { provider, url } = await loadDbConfig();

  // Ensure directory exists for SQLite file-based databases
  if (provider === "sqlite" && url !== ":memory:") {
    await mkdirFs(dirname(url), { recursive: true });
  }

  const dbInstance = createDatabase({ provider, url });
  // Access the underlying driver client from the Drizzle instance
  const client = (dbInstance.db as { $client: unknown }).$client as {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      all: (...params: unknown[]) => unknown[];
      run: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => unknown;
    };
  };

  // Load all migration file contents
  const migrations: Array<{ name: string; sql: string }> = [];
  for (const file of files) {
    const sql = await readMigrationFile(join(migrationsDir, file), "utf8");
    migrations.push({ name: file, sql });
  }

  const executed = applyTrackedMigrations(client, migrations, provider);

  if (executed.length === 0) {
    console.log(pc.green("No pending migrations. Database is up to date."));
  } else {
    for (const name of executed) {
      console.log(pc.green(`Applied: ${name}`));
    }
    console.log(pc.dim(`\n${executed.length} migration(s) applied.`));
  }
}

async function runDbStatus(): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const { createDatabase, getMigrationStatus } = await import("@zauso-ai/capstan-db");

  const migrationsDir = join(process.cwd(), "app", "migrations");
  let files: string[];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.log("No migrations directory found at app/migrations/.");
    return;
  }

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const { provider, url } = await loadDbConfig();

  let status: { applied: Array<{ name: string; appliedAt: string }>; pending: string[] };
  try {
    const dbInstance = createDatabase({ provider, url });
    const client = (dbInstance.db as { $client: unknown }).$client as {
      exec: (sql: string) => void;
      prepare: (sql: string) => {
        all: (...params: unknown[]) => unknown[];
        run: (...params: unknown[]) => unknown;
        get: (...params: unknown[]) => unknown;
      };
    };

    status = getMigrationStatus(client, files, provider);
  } catch {
    // Database may not exist yet — treat everything as pending
    status = {
      applied: [],
      pending: files,
    };
  }

  console.log(`Migration status ${pc.dim(`(${provider})`)}:\n`);

  if (status.applied.length > 0) {
    console.log(`Applied ${pc.dim(`(${status.applied.length})`)}:`);
    for (const m of status.applied) {
      console.log(pc.green(`  \u2713 ${m.name}`) + pc.dim(`  (${m.appliedAt})`));
    }
  }

  if (status.pending.length > 0) {
    if (status.applied.length > 0) console.log("");
    console.log(`Pending ${pc.dim(`(${status.pending.length})`)}:`);
    for (const name of status.pending) {
      console.log(pc.yellow(`  \u2022 ${name}`));
    }
  }

  if (status.applied.length > 0 && status.pending.length === 0) {
    console.log(pc.green("\nDatabase is up to date."));
  }
}

// ---------------------------------------------------------------------------
// Agent / MCP commands
// ---------------------------------------------------------------------------

async function runMcp(): Promise<void> {
  const { createMcpServer, serveMcpStdio } = await import("@zauso-ai/capstan-agent");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { join } = await import("node:path");

  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string };
      };
      if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  const routesDir = join(process.cwd(), "app", "routes");
  const manifest = await scanRoutes(routesDir);

  // Build an executeRoute callback that loads handlers from disk and invokes
  // them directly, so MCP tool calls actually run the real route logic.
  const { loadApiHandlers } = await import("@zauso-ai/capstan-dev");

  // Build registry entries with full schema information so MCP tools,
  // OpenAPI specs, and A2A skills expose real parameter types.
  const { toJSONSchema } = await import("zod");
  const apiRoutes = manifest.routes.filter((r) => r.type === "api");
  const registryEntries: Array<{
    method: string;
    path: string;
    description?: string;
    capability?: "read" | "write" | "external";
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }> = [];

  for (const r of apiRoutes) {
    let handlers: Awaited<ReturnType<typeof loadApiHandlers>>;
    try {
      handlers = await loadApiHandlers(r.filePath);
    } catch {
      // If a route fails to load, fall back to bare method+path entries.
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      for (const m of methods) {
        registryEntries.push({ method: m, path: r.urlPattern });
      }
      continue;
    }

    const methodExports: Array<[string, unknown]> = [
      ["GET", handlers.GET],
      ["POST", handlers.POST],
      ["PUT", handlers.PUT],
      ["DELETE", handlers.DELETE],
      ["PATCH", handlers.PATCH],
    ];

    for (const [m, handler] of methodExports) {
      if (handler === undefined) continue;

      const entry: (typeof registryEntries)[number] = {
        method: m,
        path: r.urlPattern,
      };

      // Extract metadata from APIDefinition objects produced by defineAPI().
      if (
        handler !== null &&
        typeof handler === "object" &&
        "handler" in handler &&
        typeof (handler as { handler: unknown }).handler === "function"
      ) {
        const apiDef = handler as {
          handler: Function;
          description?: string;
          capability?: string;
          input?: unknown;
          output?: unknown;
        };
        if (apiDef.description !== undefined) entry.description = apiDef.description;
        if (apiDef.capability !== undefined) entry.capability = apiDef.capability as "read" | "write" | "external";

        try {
          if (apiDef.input) {
            entry.inputSchema = toJSONSchema(apiDef.input as Parameters<typeof toJSONSchema>[0]) as Record<string, unknown>;
          }
        } catch {
          // Schema conversion is best-effort.
        }

        try {
          if (apiDef.output) {
            entry.outputSchema = toJSONSchema(apiDef.output as Parameters<typeof toJSONSchema>[0]) as Record<string, unknown>;
          }
        } catch {
          // Best-effort.
        }
      }

      // Merge metadata from the route file's `meta` export.
      if (handlers.meta) {
        if (entry.description === undefined && typeof handlers.meta["description"] === "string") {
          entry.description = handlers.meta["description"];
        }
        if (entry.capability === undefined && typeof handlers.meta["capability"] === "string") {
          entry.capability = handlers.meta["capability"] as "read" | "write" | "external";
        }
      }

      registryEntries.push(entry);
    }
  }

  const executeRoute = async (
    method: string,
    urlPath: string,
    input: unknown,
  ): Promise<unknown> => {
    try {
      // Find the matching route file from the manifest.
      const matchingRoutes = manifest.routes.filter(
        (r) => r.type === "api" && r.urlPattern === urlPath,
      );
      if (matchingRoutes.length === 0) {
        return { error: `No route found for ${method} ${urlPath}` };
      }

      const route = matchingRoutes[0]!;
      const handlers = await loadApiHandlers(route.filePath);
      const handler = handlers[method as keyof typeof handlers];

      if (!handler || typeof handler !== "object" || !("handler" in handler)) {
        return { error: `No ${method} handler found at ${urlPath}` };
      }

      const apiDef = handler as {
        handler: (args: { input: unknown; ctx: unknown }) => Promise<unknown>;
      };
      const result = await apiDef.handler({
        input: input ?? {},
        ctx: {
          auth: {
            isAuthenticated: false,
            type: "anonymous" as const,
            permissions: [],
          },
          request: new Request(`http://localhost${urlPath}`),
          env: process.env,
          honoCtx: {},
        },
      });
      return result;
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Route execution failed",
      };
    }
  };

  const agentConfig = {
    name: appName,
    ...(appDescription ? { description: appDescription } : {}),
  };
  const { server } = createMcpServer(
    agentConfig,
    registryEntries,
    executeRoute,
  );

  await serveMcpStdio(server);
}

async function runAgentManifest(): Promise<void> {
  const { generateAgentManifest } = await import("@zauso-ai/capstan-agent");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { join } = await import("node:path");

  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string };
      };
      if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  const routesDir = join(process.cwd(), "app", "routes");
  const manifest = await scanRoutes(routesDir);
  const registryEntries = manifest.routes
    .filter((r) => r.type === "api")
    .flatMap((r) => {
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      return methods.map((m) => ({
        method: m,
        path: r.urlPattern,
      }));
    });

  const agentConfig = { name: appName, ...(appDescription ? { description: appDescription } : {}) };
  const agentManifest = generateAgentManifest(agentConfig, registryEntries);
  console.log(JSON.stringify(agentManifest, null, 2));
}

async function runAgentOpenapi(): Promise<void> {
  const { generateOpenApiSpec } = await import("@zauso-ai/capstan-agent");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { join } = await import("node:path");

  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string };
      };
      if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  const routesDir = join(process.cwd(), "app", "routes");
  const manifest = await scanRoutes(routesDir);
  const registryEntries = manifest.routes
    .filter((r) => r.type === "api")
    .flatMap((r) => {
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      return methods.map((m) => ({
        method: m,
        path: r.urlPattern,
      }));
    });

  const agentConfig = { name: appName, ...(appDescription ? { description: appDescription } : {}) };
  const spec = generateOpenApiSpec(agentConfig, registryEntries);
  console.log(JSON.stringify(spec, null, 2));
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

async function resolveConfig(): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  const candidates = [
    resolve(process.cwd(), "capstan.config.ts"),
    resolve(process.cwd(), "capstan.config.js"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Existing helpers
// ---------------------------------------------------------------------------

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

// ---------------------------------------------------------------------------
// capstan add
// ---------------------------------------------------------------------------

async function runAdd(args: string[]): Promise<void> {
  const subcommand = args[0];
  const name = args[1];

  if (!subcommand || !name) {
    console.error(pc.red("Usage: capstan add <model|api|page|policy> <name>"));
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case "model": {
      const filePath = join(process.cwd(), "app/models", `${name}.model.ts`);
      if (existsSync(filePath)) {
        console.error(pc.red(`File already exists: app/models/${name}.model.ts`));
        process.exitCode = 1;
        return;
      }
      const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
      const content = `import { defineModel, field } from "@zauso-ai/capstan-db";

export const ${pascalName} = defineModel("${name}", {
  fields: {
    id: field.id(),
    title: field.string({ required: true }),
    description: field.text(),
    createdAt: field.datetime({ default: "now" }),
    updatedAt: field.datetime({ updatedAt: true }),
  },
});
`;
      await mkdir(join(process.cwd(), "app/models"), { recursive: true });
      await writeFile(filePath, content, "utf-8");
      console.log(pc.green(`\u2713 Created app/models/${name}.model.ts`));
      break;
    }
    case "api": {
      const dirPath = join(process.cwd(), "app/routes", name);
      const filePath = join(dirPath, "index.api.ts");
      if (existsSync(filePath)) {
        console.error(pc.red(`File already exists: app/routes/${name}/index.api.ts`));
        process.exitCode = 1;
        return;
      }
      const content = `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = {
  resource: "${name}",
  description: "Manage ${name}",
};

export const GET = defineAPI({
  output: z.object({
    items: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  description: "List ${name}",
  capability: "read",
  resource: "${name}",
  async handler({ input, ctx }) {
    // TODO: Replace with real database query
    return { items: [] };
  },
});

export const POST = defineAPI({
  input: z.object({
    title: z.string().min(1),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
  }),
  description: "Create a ${name}",
  capability: "write",
  resource: "${name}",
  policy: "requireAuth",
  async handler({ input, ctx }) {
    // TODO: Replace with real database insert
    return {
      id: crypto.randomUUID(),
      title: input.title,
    };
  },
});
`;
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, content, "utf-8");
      console.log(pc.green(`\u2713 Created app/routes/${name}/index.api.ts`));
      break;
    }
    case "page": {
      const dirPath = join(process.cwd(), "app/routes", name);
      const filePath = join(dirPath, "index.page.tsx");
      if (existsSync(filePath)) {
        console.error(pc.red(`File already exists: app/routes/${name}/index.page.tsx`));
        process.exitCode = 1;
        return;
      }
      const titleName = name.charAt(0).toUpperCase() + name.slice(1);
      const content = `export default function ${titleName}Page() {
  return (
    <main>
      <h1>${titleName}</h1>
      <p>This is the ${name} page.</p>
    </main>
  );
}
`;
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, content, "utf-8");
      console.log(pc.green(`\u2713 Created app/routes/${name}/index.page.tsx`));
      break;
    }
    case "policy": {
      const policiesDir = join(process.cwd(), "app/policies");
      const policiesFile = join(policiesDir, "index.ts");
      const camelName = name.charAt(0).toLowerCase() + name.slice(1);
      const titleName = name.charAt(0).toUpperCase() + name.slice(1);
      const policySnippet = `
export const ${camelName} = definePolicy({
  key: "${camelName}",
  title: "${titleName}",
  effect: "deny",
  async check({ ctx }) {
    // TODO: Implement policy logic
    return { effect: "allow" };
  },
});
`;
      if (existsSync(policiesFile)) {
        // Append to existing policies file
        const existing = await readFile(policiesFile, "utf-8");
        await writeFile(policiesFile, existing + policySnippet, "utf-8");
        console.log(pc.green(`\u2713 Appended policy "${camelName}" to app/policies/index.ts`));
      } else {
        // Create new policies file with import
        const content = `import { definePolicy } from "@zauso-ai/capstan-core";
${policySnippet}`;
        await mkdir(policiesDir, { recursive: true });
        await writeFile(policiesFile, content, "utf-8");
        console.log(pc.green(`\u2713 Created app/policies/index.ts with policy "${camelName}"`));
      }
      break;
    }
    default:
      console.error(pc.red(`Unknown add subcommand: ${subcommand}`));
      console.error(pc.red("Usage: capstan add <model|api|page|policy> <name>"));
      process.exitCode = 1;
  }
}

function printHelp(): void {
  console.log(`\n${pc.bold("Capstan")} ${pc.dim("v1.0.0-beta.5")}\n`);

  const group = (title: string, cmds: [string, string][]) => {
    console.log(`  ${pc.bold(title)}`);
    for (const [name, desc] of cmds) {
      console.log(`    ${pc.cyan(name.padEnd(15))}${desc}`);
    }
    console.log();
  };

  group("Development", [
    ["dev",   "Start dev server with live reload"],
    ["build", "Build for production"],
    ["start", "Start production server"],
  ]);

  group("Scaffolding", [
    ["add model",  "Add a data model"],
    ["add api",    "Add API routes"],
    ["add page",   "Add a page component"],
    ["add policy", "Add a permission policy"],
  ]);

  group("Database", [
    ["db:migrate", "Generate migration SQL"],
    ["db:push",    "Apply pending migrations"],
    ["db:status",  "Show migration status"],
  ]);

  group("Verification", [
    ["verify", "Run 8-step verification cascade"],
  ]);

  group("Agent Protocols", [
    ["mcp",            "Start MCP server (stdio)"],
    ["agent:manifest", "Print agent manifest JSON"],
    ["agent:openapi",  "Print OpenAPI spec JSON"],
  ]);

  console.log(`  Run ${pc.cyan("capstan <command> --help")} for details.\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = 1;
});
