import { access, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRouteScanCache, matchRoute, scanRoutes } from "@zauso-ai/capstan-router";
import type { RouteManifest, RouteEntry } from "@zauso-ai/capstan-router";
import { toJSONSchema } from "zod";
import {
  createContext,
  createApproval,
  createRequestLogger,
  csrfProtection,
  enforcePolicies,
  mountApprovalRoutes,
  createCapstanOpsContext,
  ActionRedirectError,
  isActionDefinition as isActionDef,
} from "@zauso-ai/capstan-core";
import type {
  APIDefinition,
  ActionDefinition,
  ActionArgs,
  HttpMethod,
  CapstanContext,
  CapstanAuthContext,
  CapstanOpsContext,
  PolicyDefinition,
} from "@zauso-ai/capstan-core";

import { loadApiHandlers, loadLayoutModule, loadPageModule, loadActionHandler, loadLoadingModule, loadErrorModule, invalidateModuleCache } from "./loader.js";
import { createPageFetch } from "./page-fetch.js";
import { runPageRuntime } from "./page-runtime.js";
import type { PageRuntimeOptions } from "./page-runtime.js";
import { loadRouteMiddlewares, composeRouteMiddlewares } from "./route-middleware.js";
import { watchRoutes, watchStyles } from "./watcher.js";
import { printStartupBanner } from "./printer.js";
import { resolveProjectOpsConfig } from "./ops-sink.js";
import type {
  DevServerConfig,
  DevServerInstance,
  RuntimeAssetRecord,
  RuntimeAppBuild,
  RuntimeAppConfig,
  RuntimeRouteRegistryEntry,
} from "./types.js";
import type { ServerAdapter } from "./adapter.js";
import { createNodeAdapter, notifyLiveReloadClients } from "./adapter-node.js";
import { detectCSSMode, buildCSS, startTailwindWatch } from "./css.js";
import { createHmrCoordinator, createHmrTransport } from "./hmr.js";
import type { HmrCoordinator, HmrTransport } from "./hmr.js";

// ---------------------------------------------------------------------------
// Live Reload / HMR
// ---------------------------------------------------------------------------

/**
 * Inline `<script>` tag injected before `</body>` in HTML pages served
 * during development.  When the HMR coordinator is available the script
 * handles granular CSS hot-swap and page re-fetch; otherwise it falls
 * back to a full page reload via SSE (backward-compatible behavior).
 */
let _hmrCoordinator: HmrCoordinator | null = null;
let _hmrTransport: HmrTransport | null = null;
const DEV_SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REACT_SRC_DIR = path.resolve(DEV_SRC_DIR, "..", "..", "react", "src");
const REACT_BROWSER_ENTRY = path.join(REACT_SRC_DIR, "browser.ts");
const REACT_CLIENT_ENTRY = path.join(REACT_SRC_DIR, "client", "index.ts");
const SHARED_REACT_MODULE = "/_capstan/client/vendor/react.js";
const SHARED_REACT_DOM_MODULE = "/_capstan/client/vendor/react-dom.js";
const SHARED_REACT_DOM_CLIENT_MODULE = "/_capstan/client/vendor/react-dom-client.js";
const SHARED_REACT_JSX_RUNTIME_MODULE = "/_capstan/client/vendor/react-jsx-runtime.js";

function getHmrScript(port: number): string {
  if (_hmrCoordinator) {
    return _hmrCoordinator.getClientScript({ port, protocol: "sse" });
  }

  // Legacy fallback — identical to the old LIVE_RELOAD_SCRIPT.
  return `<script>
(function(){
  var es = new EventSource('/__capstan_livereload');
  es.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
  es.onerror = function() { setTimeout(function(){ es.close(); es = new EventSource('/__capstan_livereload'); }, 1000); };
})();
</script>`;
}

/** Expose the active transport so the adapter layer can feed SSE clients. */
export function getHmrTransport(): HmrTransport | null {
  return _hmrTransport;
}

/**
 * Escape a string for safe embedding in HTML text content.
 * Prevents XSS when interpolating user-controlled or config values into
 * the fallback HTML shell.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toCapabilityMode(
  value: unknown,
): "read" | "write" | "external" | undefined {
  return value === "read" || value === "write" || value === "external"
    ? value
    : undefined;
}

/**
 * Inject the HMR (or legacy live-reload) `<script>` into an HTML string by
 * placing it immediately before `</body>`. If `</body>` is not found the
 * script is appended at the end as a best-effort fallback.
 */
function injectLiveReload(html: string, port: number = 3000): string {
  const script = getHmrScript(port);
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) {
    return html.slice(0, idx) + script + "\n" + html.slice(idx);
  }
  return html + script;
}

/**
 * Inject the client route manifest into an HTML page as a script tag
 * before `</body>`.  The client router reads this at bootstrap to know
 * which routes exist and their component types.
 */
function injectManifest(html: string, manifest: RouteManifest): string {
  const needsHydration = (route: RouteEntry): boolean => {
    if (route.componentType === "client") return true;
    return route.layouts.some((layoutPath) => {
      try {
        const firstLine = readFileSync(layoutPath, "utf-8").split(/\r?\n/, 1)[0]?.trim() ?? "";
        return (
          firstLine === '"use client"' ||
          firstLine === "'use client'" ||
          firstLine === '"use client";' ||
          firstLine === "'use client';"
        );
      } catch {
        return false;
      }
    });
  };

  const clientRoutes = manifest.routes
    .filter((r) => r.type === "page")
    .map((r) => ({
      urlPattern: r.urlPattern,
      componentType: r.componentType ?? "server",
      needsHydration: needsHydration(r),
      layouts: r.layouts,
    }));

  const script = `<script>window.__CAPSTAN_MANIFEST__=${JSON.stringify({ routes: clientRoutes }).replace(/</g, "\\u003c")}</script>`;
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) {
    return html.slice(0, idx) + script + "\n" + html.slice(idx);
  }
  return html + script;
}

async function buildHydrationModule(
  route: RouteEntry,
  appRoot: string,
): Promise<string> {
  const esbuild = await import("esbuild");
  const relativeImport = (filePath: string): string => {
    const rel = path.relative(appRoot, filePath).replace(/\\/g, "/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };
  const reactClientEntryImport = relativeImport(path.join(REACT_SRC_DIR, "client", "entry.ts"));
  const reactHydrateImport = relativeImport(path.join(REACT_SRC_DIR, "hydrate.ts"));
  const layoutImports = route.layouts.map((layoutPath, index) => ({
    name: `Layout${index}`,
    importPath: relativeImport(layoutPath),
  }));
  const contents = [
    `import * as SharedReact from "react";`,
    `import * as SharedReactDom from "react-dom";`,
    `import * as SharedReactDomClient from "react-dom/client";`,
    `import * as SharedJsxRuntime from "react/jsx-runtime";`,
    `import { bootstrapClient } from ${JSON.stringify(reactClientEntryImport)};`,
    `import { hydrateCapstanPage } from ${JSON.stringify(reactHydrateImport)};`,
    `import Page from ${JSON.stringify(relativeImport(route.filePath))};`,
    ...layoutImports.map(({ name, importPath }) => `import ${name} from ${JSON.stringify(importPath)};`),
    `bootstrapClient();`,
    `window.__CAPSTAN_SHARED_REACT__ ??= SharedReact;`,
    `window.__CAPSTAN_SHARED_REACT_DOM__ ??= SharedReactDom;`,
    `window.__CAPSTAN_SHARED_REACT_DOM_CLIENT__ ??= SharedReactDomClient;`,
    `window.__CAPSTAN_SHARED_JSX_RUNTIME__ ??= SharedJsxRuntime;`,
    `const root = document.getElementById("capstan-root") ?? (document.querySelector("[data-capstan-layout], [data-capstan-outlet]") ? document : null);`,
    `const data = window.__CAPSTAN_DATA__;`,
    `if (root && data) hydrateCapstanPage(root, Page, [${layoutImports.map(({ name }) => name).join(", ")}], data);`,
  ].join("\n");

  const jsExtensionResolver: import("esbuild").Plugin = {
    name: "capstan-js-extension-resolver",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({
        path: FRAMEWORK_BROWSER_REACT_ENTRY,
      }));

      build.onResolve({ filter: /^react-dom$/ }, () => ({
        path: FRAMEWORK_BROWSER_REACT_DOM_ENTRY,
      }));

      build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
        path: FRAMEWORK_BROWSER_REACT_DOM_CLIENT_ENTRY,
      }));

      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        path: FRAMEWORK_BROWSER_REACT_JSX_RUNTIME_ENTRY,
      }));

      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
        path: FRAMEWORK_BROWSER_REACT_JSX_DEV_RUNTIME_ENTRY,
      }));

      build.onResolve({ filter: /^@zauso-ai\/capstan-react$/ }, () => ({
        path: REACT_BROWSER_ENTRY,
      }));

      build.onResolve({ filter: /^@zauso-ai\/capstan-react\/client$/ }, () => ({
        path: REACT_CLIENT_ENTRY,
      }));

      build.onResolve({ filter: /^(\.|\.\.\/|\/).*\.js$/ }, (args) => {
        const resolved = path.isAbsolute(args.path)
          ? args.path
          : path.resolve(args.resolveDir, args.path);
        if (existsSync(resolved)) return { path: resolved };

        for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
          const candidate = resolved.slice(0, -3) + ext;
          if (existsSync(candidate)) {
            return { path: candidate };
          }
        }

        return null;
      });
    },
  };

  const result = await esbuild.build({
    stdin: {
      contents,
      resolveDir: appRoot,
      sourcefile: "__capstan_hydrate_entry__.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    sourcemap: "inline",
    plugins: [jsExtensionResolver],
  });

  return result.outputFiles[0]?.text ?? "";
}

async function buildRouteModule(
  route: RouteEntry,
  appRoot: string,
): Promise<string> {
  const esbuild = await import("esbuild");
  const relativeImport = (filePath: string): string => {
    const rel = path.relative(appRoot, filePath).replace(/\\/g, "/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };

  const jsExtensionResolver: import("esbuild").Plugin = {
    name: "capstan-route-module-resolver",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({
        path: SHARED_REACT_MODULE,
        external: true,
      }));

      build.onResolve({ filter: /^react-dom$/ }, () => ({
        path: SHARED_REACT_DOM_MODULE,
        external: true,
      }));

      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        path: SHARED_REACT_JSX_RUNTIME_MODULE,
        external: true,
      }));

      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
        path: SHARED_REACT_JSX_RUNTIME_MODULE,
        external: true,
      }));

      build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
        path: SHARED_REACT_DOM_CLIENT_MODULE,
        external: true,
      }));

      build.onResolve({ filter: /^@zauso-ai\/capstan-react$/ }, () => ({
        path: REACT_BROWSER_ENTRY,
      }));

      build.onResolve({ filter: /^@zauso-ai\/capstan-react\/client$/ }, () => ({
        path: REACT_CLIENT_ENTRY,
      }));

      build.onResolve({ filter: /^(\.|\.\.\/|\/).*\.js$/ }, (args) => {
        const resolved = path.isAbsolute(args.path)
          ? args.path
          : path.resolve(args.resolveDir, args.path);
        if (existsSync(resolved)) return { path: resolved };

        for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
          const candidate = resolved.slice(0, -3) + ext;
          if (existsSync(candidate)) {
            return { path: candidate };
          }
        }

        return null;
      });
    },
  };

  const result = await esbuild.build({
    stdin: {
      contents: [
        `import Page from ${JSON.stringify(relativeImport(route.filePath))};`,
        `export default Page;`,
      ].join("\n"),
      resolveDir: appRoot,
      sourcefile: "__capstan_route_entry__.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    sourcemap: "inline",
    plugins: [jsExtensionResolver],
  });

  return result.outputFiles[0]?.text ?? "";
}

async function buildSharedReactModule(): Promise<string> {
  return [
    `const React = window.__CAPSTAN_SHARED_REACT__;`,
    `if (!React) throw new Error("Capstan shared React runtime is unavailable.");`,
    `export default React;`,
    `export const {`,
    `  Activity,`,
    `  Children,`,
    `  Component,`,
    `  Fragment,`,
    `  Profiler,`,
    `  PureComponent,`,
    `  StrictMode,`,
    `  Suspense,`,
    `  cloneElement,`,
    `  createContext,`,
    `  createElement,`,
    `  createRef,`,
    `  forwardRef,`,
    `  isValidElement,`,
    `  lazy,`,
    `  memo,`,
    `  startTransition,`,
    `  use,`,
    `  useActionState,`,
    `  useCallback,`,
    `  useContext,`,
    `  useDebugValue,`,
    `  useDeferredValue,`,
    `  useEffect,`,
    `  useId,`,
    `  useImperativeHandle,`,
    `  useInsertionEffect,`,
    `  useLayoutEffect,`,
    `  useMemo,`,
    `  useOptimistic,`,
    `  useReducer,`,
    `  useRef,`,
    `  useState,`,
    `  useSyncExternalStore,`,
    `  useTransition,`,
    `  version,`,
    `} = React;`,
  ].join("\n");
}

async function buildSharedReactDomModule(): Promise<string> {
  return [
    `const reactDom = window.__CAPSTAN_SHARED_REACT_DOM__;`,
    `if (!reactDom) throw new Error("Capstan shared React DOM runtime is unavailable.");`,
    `export default reactDom;`,
    `export const { preload, preconnect, prefetchDNS, preinit, preinitModule, version } = reactDom;`,
  ].join("\n");
}

async function buildSharedReactDomClientModule(): Promise<string> {
  return [
    `const reactDomClient = window.__CAPSTAN_SHARED_REACT_DOM_CLIENT__;`,
    `if (!reactDomClient) throw new Error("Capstan shared React DOM client runtime is unavailable.");`,
    `export default reactDomClient;`,
    `export const { createRoot, hydrateRoot } = reactDomClient;`,
  ].join("\n");
}

async function buildSharedReactJsxRuntimeModule(): Promise<string> {
  return [
    `const jsxRuntime = window.__CAPSTAN_SHARED_JSX_RUNTIME__;`,
    `if (!jsxRuntime) throw new Error("Capstan shared JSX runtime is unavailable.");`,
    `export const { Fragment, jsx, jsxs } = jsxRuntime;`,
  ].join("\n");
}

async function collectStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }

  html += decoder.decode();
  return html;
}

function decoratePageHtml(
  html: string,
  manifest: RouteManifest,
  liveReloadEnabled: boolean,
  port?: number,
): string {
  const withManifest = injectManifest(html, manifest);
  return liveReloadEnabled ? injectLiveReload(withManifest, port) : withManifest;
}

function shouldRenderNotFoundPage(request: Request): boolean {
  if (request.headers.get("X-Capstan-Nav") === "1") {
    return true;
  }

  if (request.headers.get("sec-fetch-dest") === "document") {
    return true;
  }

  if (request.headers.get("sec-fetch-mode") === "navigate") {
    return true;
  }

  const accept = request.headers.get("accept") ?? "";
  return (
    accept.includes("text/html") ||
    accept.includes("application/xhtml+xml")
  );
}

/**
 * Determine if an exported handler value looks like an APIDefinition
 * produced by `defineAPI()` from @zauso-ai/capstan-core.
 */
function isAPIDefinition(value: unknown): value is APIDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    "handler" in value &&
    typeof (value as APIDefinition).handler === "function"
  );
}

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".map": "application/json",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
};

const CAPSTAN_CLIENT_BOOTSTRAP = [
  `import { bootstrapClient } from "/_capstan/client/entry.js";`,
  `bootstrapClient();`,
].join("\n");
const frameworkRequire = createRequire(import.meta.url);
const FRAMEWORK_BROWSER_REACT_ENTRY = frameworkRequire.resolve("react");
const FRAMEWORK_BROWSER_REACT_DOM_ENTRY = frameworkRequire.resolve("react-dom");
const FRAMEWORK_BROWSER_REACT_DOM_CLIENT_ENTRY = frameworkRequire.resolve("react-dom/client");
const FRAMEWORK_BROWSER_REACT_JSX_RUNTIME_ENTRY = frameworkRequire.resolve("react/jsx-runtime");
const FRAMEWORK_BROWSER_REACT_JSX_DEV_RUNTIME_ENTRY = frameworkRequire.resolve("react/jsx-dev-runtime");

let _reactClientDir: string | null = null;

function toFilesystemPath(value: string): string {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}

function resolveRuntimePath(rootDir: string, candidatePath: string): string {
  return path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(rootDir, candidatePath);
}

function collectReactClientDirCandidates(): string[] {
  const candidates = new Set<string>();
  const importMetaResolver = (import.meta as ImportMeta & {
    resolve?: (specifier: string) => string;
  }).resolve;

  if (typeof importMetaResolver === "function") {
    try {
      candidates.add(
        path.dirname(
          toFilesystemPath(importMetaResolver("@zauso-ai/capstan-react/client")),
        ),
      );
    } catch {
      // Fall through to filesystem-based candidate discovery.
    }
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  candidates.add(path.resolve(moduleDir, "..", "..", "react", "dist", "client"));
  candidates.add(
    path.resolve(
      moduleDir,
      "..",
      "..",
      "..",
      "..",
      "@zauso-ai",
      "capstan-react",
      "dist",
      "client",
    ),
  );

  let currentDir = moduleDir;
  for (;;) {
    candidates.add(
      path.join(
        currentDir,
        "node_modules",
        "@zauso-ai",
        "capstan-react",
        "dist",
        "client",
      ),
    );

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return [...candidates];
}

async function getReactClientDir(): Promise<string> {
  if (_reactClientDir !== null) {
    return _reactClientDir;
  }

  for (const candidate of collectReactClientDirCandidates()) {
    try {
      await access(candidate);
      _reactClientDir = candidate;
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Capstan React client runtime could not be resolved.");
}

function urlPathToStaticHtmlFile(urlPath: string, staticDir: string): string {
  const segments = urlPath.replace(/^\/+|\/+$/g, "");
  return segments === ""
    ? path.join(staticDir, "index.html")
    : path.join(staticDir, segments, "index.html");
}

async function tryReadStaticHtml(
  urlPath: string,
  staticDir?: string,
  assetProvider?: RuntimeAppConfig["assetProvider"],
): Promise<string | null> {
  if (assetProvider?.readStaticHtml) {
    const provided = await assetProvider.readStaticHtml(urlPath);
    if (provided !== null) {
      return provided;
    }
  }

  if (!staticDir) {
    return null;
  }

  try {
    return await readFile(urlPathToStaticHtmlFile(urlPath, staticDir), "utf-8");
  } catch {
    return null;
  }
}

async function serveReactClientAsset(assetPath: string): Promise<Response> {
  return serveReactClientAssetFromConfig(assetPath, {});
}

async function materializeAsset(
  asset: RuntimeAssetRecord,
): Promise<Uint8Array> {
  if (asset.encoding === "base64") {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(asset.body, "base64"));
    }

    if (typeof atob === "function") {
      const decoded = atob(asset.body);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    }
  }

  return new TextEncoder().encode(asset.body);
}

function cloneBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function serveReactClientAssetFromConfig(
  assetPath: string,
  config: Pick<RuntimeAppConfig, "assetProvider" | "clientDir">,
): Promise<Response> {
  if (config.assetProvider?.readClientAsset) {
    const provided = await config.assetProvider.readClientAsset(assetPath);
    if (provided) {
      return new Response(cloneBufferSource(await materializeAsset(provided)), {
        status: 200,
        headers: {
          "Content-Type": provided.contentType ?? "application/octet-stream",
          "Cache-Control": "no-cache",
        },
      });
    }
  }

  const normalizedPath = assetPath.replace(/^\/+/, "");
  let clientDir: string;
  try {
    clientDir = config.clientDir ?? await getReactClientDir();
  } catch {
    return new Response("Capstan React client runtime is unavailable", {
      status: 503,
    });
  }
  const resolved = path.resolve(clientDir, normalizedPath);
  const relativePath = path.relative(clientDir, resolved);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const content = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

interface PolicyEnforcementArgs {
  handler: APIDefinition | { policy?: string };
  input: unknown;
  ctx: CapstanContext;
  method: string;
  path: string;
  policyRegistry?: ReadonlyMap<string, PolicyDefinition>;
  unknownPolicyMode?: "approve" | "deny";
}

async function enforceRoutePolicy(
  args: PolicyEnforcementArgs,
): Promise<Response | null> {
  const policyName = args.handler.policy;
  if (!policyName) {
    return null;
  }

  if (policyName === "requireAuth" && !args.policyRegistry?.has(policyName)) {
    if (!args.ctx.auth.isAuthenticated) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", policy: policyName }),
        {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    return null;
  }

  const policyDefinition = args.policyRegistry?.get(policyName);
  if (!policyDefinition) {
    if ((args.unknownPolicyMode ?? "approve") === "approve") {
      const reason = `Policy "${policyName}" requires approval`;
      const approval = await createApproval({
        method: args.method,
        path: args.path,
        input: args.input,
        policy: policyName,
        reason,
        ctx: args.ctx,
      });

      return new Response(
        JSON.stringify({
          status: "approval_required",
          approvalId: approval.id,
          reason,
          pollUrl: `/capstan/approvals/${approval.id}`,
        }),
        {
          status: 202,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: "Forbidden",
        reason: `Unknown policy: ${policyName}`,
        policy: policyName,
      }),
      {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  const result = await enforcePolicies([policyDefinition], args.ctx, args.input);

  if (result.effect === "deny") {
    return new Response(
      JSON.stringify({
        error: "Forbidden",
        reason: result.reason ?? "Policy denied",
        policy: policyName,
      }),
      {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  if (result.effect === "approve") {
    const approval = await createApproval({
      method: args.method,
      path: args.path,
      input: args.input,
      policy: policyName,
      reason: result.reason ?? "This action requires approval",
      ctx: args.ctx,
    });

    return new Response(
      JSON.stringify({
        status: "approval_required",
        approvalId: approval.id,
        reason: result.reason ?? "This action requires approval",
        pollUrl: `/capstan/approvals/${approval.id}`,
      }),
      {
        status: 202,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/** Hono env type that declares runtime-attached Capstan variables. */
type HonoEnv = {
  Variables: {
    capstanAuth: CapstanAuthContext;
    capstanOps?: CapstanOpsContext;
    capstanRequestId?: string;
    capstanTraceId?: string;
  };
};

let _agentPkg: {
  generateA2AAgentCard: (
    cfg: { name: string; description?: string; baseUrl?: string },
    routes: Array<{ method: string; path: string; description?: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }>,
  ) => unknown;
  createA2AHandler: (
    cfg: { name: string; description?: string; baseUrl?: string },
    routes: Array<{ method: string; path: string; description?: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }>,
    executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,
  ) => {
    handleRequest: (body: unknown) => Promise<unknown>;
  };
  routeToToolName: (method: string, path: string) => string;
  createMcpServer: (
    cfg: { name: string; description?: string },
    routes: Array<{ method: string; path: string; description?: string; inputSchema?: Record<string, unknown> }>,
    executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,
  ) => { server: unknown; getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }> };
} | null = null;

async function getAgentPkg(): Promise<NonNullable<typeof _agentPkg>> {
  if (!_agentPkg) {
    const agentModuleName = "@zauso-ai/capstan-agent";
    _agentPkg = (await import(agentModuleName)) as NonNullable<typeof _agentPkg>;
  }
  return _agentPkg;
}

/**
 * Given a scanned route manifest, build a fresh Hono application with all
 * routes registered. Returns the Hono app plus metadata used by the
 * framework endpoints (manifest, openapi, health).
 */
export async function buildRuntimeApp(
  config: RuntimeAppConfig,
): Promise<RuntimeAppBuild> {
  const manifest = config.manifest;
  const opsConfig = resolveProjectOpsConfig(config.ops, {
    rootDir: config.rootDir,
    ...(config.appName ? { appName: config.appName } : {}),
    environment: config.mode ?? "development",
    source: config.mode === "production" ? "runtime:prod" : "runtime:dev",
  });
  const ops = createCapstanOpsContext(opsConfig);

  const app = new Hono<HonoEnv>();

  // Global middleware ---------------------------------------------------------
  if (ops) {
    app.use("*", async (c, next) => {
      c.set("capstanOps", ops);
      await next();
    });
  }
  app.use("*", createRequestLogger({ ops }));
  if (config.corsOptions !== false) {
    app.use("*", cors(config.corsOptions));
  }

  // --- Auth middleware -------------------------------------------------------
  // If the config includes auth settings, create the auth resolver from
  // @zauso-ai/capstan-auth. Otherwise, fall back to anonymous and warn once.

  let resolveAuth: ((request: Request) => Promise<CapstanAuthContext>) | null =
    null;

  if (config.auth) {
    try {
      const authModuleName = "@zauso-ai/capstan-auth";
      const authPkg = (await import(authModuleName)) as {
        createAuthMiddleware: (
          cfg: typeof config.auth,
          deps: { findAgentByKeyPrefix?: (prefix: string) => Promise<unknown> },
        ) => (request: Request) => Promise<CapstanAuthContext>;
      };
      resolveAuth = authPkg.createAuthMiddleware(config.auth, {
        ...(config.findAgentByKeyPrefix
          ? { findAgentByKeyPrefix: config.findAgentByKeyPrefix }
          : {}),
      });
    } catch {
      // @zauso-ai/capstan-auth is not installed or failed to load — continue without it.
      // eslint-disable-next-line no-console
      console.warn(
        "[capstan] @zauso-ai/capstan-auth not available. Auth middleware disabled.",
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[capstan] No auth config provided. All requests treated as anonymous.",
    );
  }

  // Hono middleware that resolves auth and attaches it to the context so that
  // `createContext(c)` picks it up via `c.get("capstanAuth")`.
  app.use("*", async (c, next) => {
    if (resolveAuth) {
      const authCtx = await resolveAuth(c.req.raw);
      c.set("capstanAuth", authCtx);
    }
    await next();
  });

  // --- CSRF middleware -------------------------------------------------------
  // Only enable CSRF protection when cookie-based session auth is configured.
  // API-key-only setups don't need CSRF because Bearer tokens are not sent
  // automatically by browsers.
  if (config.auth?.session) {
    app.use("*", csrfProtection());
  }

  // Route metadata accumulated for the agent manifest / OpenAPI spec.
  const routeRegistry: RuntimeRouteRegistryEntry[] = [];

  /**
   * Handler registry keyed by "METHOD /path" so approved requests can
   * re-execute the original handler without going through the HTTP stack.
   */
  const handlerRegistry = new Map<
    string,
    (input: unknown, ctx: CapstanContext) => Promise<unknown>
  >();
  const unknownPolicyMode =
    config.unknownPolicyMode ?? (config.mode === "production" ? "deny" : "approve");

  let apiRouteCount = 0;
  let pageRouteCount = 0;

  // Separate API and page routes from the manifest.
  const apiRoutes: RouteEntry[] = [];
  const pageRoutes: RouteEntry[] = [];
  const notFoundRoutes: RouteEntry[] = [];

  for (const route of manifest.routes) {
    if (route.type === "api") apiRoutes.push(route);
    if (route.type === "page") pageRoutes.push(route);
    if (route.type === "not-found") notFoundRoutes.push(route);
  }

  // --- Register API routes --------------------------------------------------

  for (const route of apiRoutes) {
    let handlers: Awaited<ReturnType<typeof loadApiHandlers>>;
    const routeFilePath = resolveRuntimePath(config.rootDir, route.filePath);
    const resolvedMiddlewares = route.middlewares.map((middlewarePath) =>
      resolveRuntimePath(config.rootDir, middlewarePath),
    );

    try {
      handlers = await loadApiHandlers(routeFilePath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[capstan] Failed to load API route ${route.filePath}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    const methodEntries: Array<[HttpMethod, unknown]> = [
      ["GET", handlers.GET],
      ["POST", handlers.POST],
      ["PUT", handlers.PUT],
      ["DELETE", handlers.DELETE],
      ["PATCH", handlers.PATCH],
    ];

    for (const [method, handler] of methodEntries) {
      if (handler === undefined) continue;

      apiRouteCount++;

      // Record metadata for agent manifest / OpenAPI.
      const entry: (typeof routeRegistry)[number] = {
        method,
        path: route.urlPattern,
      };

      if (isAPIDefinition(handler)) {
        if (handler.description !== undefined) {
          entry.description = handler.description;
        }
        if (handler.capability !== undefined) {
          entry.capability = handler.capability;
        }

        // Extract JSON Schema from Zod input/output schemas so that MCP
        // tools, OpenAPI specs, and A2A skills see real parameters.
        try {
          if (handler.input) {
            entry.inputSchema = toJSONSchema(handler.input) as Record<string, unknown>;
          }
        } catch {
          // Schema conversion is best-effort; silently ignore failures.
        }

        try {
          if (handler.output) {
            entry.outputSchema = toJSONSchema(handler.output) as Record<string, unknown>;
          }
        } catch {
          // Best-effort.
        }
      }

      // Merge additional metadata from the route file's `meta` export
      // (e.g. description, resource) when the handler itself doesn't
      // already provide those fields.
      if (handlers.meta) {
        if (entry.description === undefined && typeof handlers.meta["description"] === "string") {
          entry.description = handlers.meta["description"];
        }
        if (entry.capability === undefined) {
          const capability = toCapabilityMode(handlers.meta["capability"]);
          if (capability) {
            entry.capability = capability;
          }
        }
      }

      routeRegistry.push(entry);

      const middlewareDefinitionsPromise = loadRouteMiddlewares(resolvedMiddlewares)
        .then((loaded) => loaded.map((middleware) => middleware.definition));

      // Store the handler for approval re-execution.
      if (isAPIDefinition(handler)) {
        const routeKey = `${method} ${route.urlPattern}`;
        const apiHandler = handler;
        handlerRegistry.set(routeKey, async (input: unknown, ctx: CapstanContext) => {
          return apiHandler.handler({ input, ctx, params: {} });
        });
      }

      // Mount the handler on the Hono app.
      const honoMethod = method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "delete"
        | "patch";

      app[honoMethod](route.urlPattern, async (c) => {
        const ctx = createContext(c);
        const startTime = Date.now();
        const executeHandler = async (): Promise<Response> => {
          // Parse input from query string (GET) or request body (others).
          let input: unknown;
          try {
            if (method === "GET") {
              input = Object.fromEntries(new URL(c.req.url).searchParams);
            } else {
              const contentType = c.req.header("content-type") ?? "";
              if (contentType.includes("application/json")) {
                input = await c.req.json();
              } else {
                input = {};
              }
            }
          } catch {
            input = {};
          }

          if (isAPIDefinition(handler)) {
            const policyResponse = await enforceRoutePolicy({
              handler,
              input,
              ctx,
              method,
              path: route.urlPattern,
              unknownPolicyMode,
              ...(config.policyRegistry
                ? { policyRegistry: config.policyRegistry }
                : {}),
            });
            if (policyResponse) {
              return policyResponse;
            }
          }

          const params = c.req.param() as Record<string, string>;

          if (ops && isAPIDefinition(handler)) {
            await ops.recordCapabilityInvocation({
              ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
              ...(ctx.traceId !== undefined ? { traceId: ctx.traceId } : {}),
              phase: "start",
              data: {
                method,
                path: route.urlPattern,
                ...(handler.capability !== undefined
                  ? { capability: handler.capability }
                  : {}),
                ...(handler.resource !== undefined
                  ? { resource: handler.resource }
                  : {}),
              },
            });
          }

          try {
            if (isAPIDefinition(handler)) {
              const result = await handler.handler({ input, ctx, params });
              if (ops) {
                await ops.recordCapabilityInvocation({
                  ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
                  ...(ctx.traceId !== undefined ? { traceId: ctx.traceId } : {}),
                  phase: "end",
                  data: {
                    method,
                    path: route.urlPattern,
                    ...(handler.capability !== undefined
                      ? { capability: handler.capability }
                      : {}),
                    ...(handler.resource !== undefined
                      ? { resource: handler.resource }
                      : {}),
                    status: 200,
                    durationMs: Date.now() - startTime,
                    outcome: "success",
                  },
                });
              }
              return c.json(result as object);
            }

            // If the export is a plain function rather than an APIDefinition,
            // invoke it directly with a similar signature.
            if (typeof handler === "function") {
              const result = await (
                handler as (args: { input: unknown; ctx: CapstanContext; params: Record<string, string> }) => Promise<unknown>
              )({ input, ctx, params });
              return c.json(result as object);
            }

            return c.json({ error: "Invalid handler export" }, 500);
          } catch (err) {
            if (ops && isAPIDefinition(handler)) {
              await ops.recordCapabilityInvocation({
                ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
                ...(ctx.traceId !== undefined ? { traceId: ctx.traceId } : {}),
                phase: "end",
                incidentFingerprint: `capability:${method}:${route.urlPattern}:5xx`,
                data: {
                  method,
                  path: route.urlPattern,
                  ...(handler.capability !== undefined
                    ? { capability: handler.capability }
                    : {}),
                  ...(handler.resource !== undefined
                    ? { resource: handler.resource }
                    : {}),
                  status: 500,
                  durationMs: Date.now() - startTime,
                  outcome: "failure",
                },
              });
            }

            throw err;
          }
        };

        try {
          const middlewareDefinitions = await middlewareDefinitionsPromise;
          return await composeRouteMiddlewares(
            middlewareDefinitions,
            async () => executeHandler(),
          )({
            request: c.req.raw,
            ctx,
          });
        } catch (err: unknown) {
          // Zod validation errors
          if (
            err !== null &&
            typeof err === "object" &&
            "issues" in (err as object) &&
            Array.isArray((err as { issues: unknown[] }).issues)
          ) {
            return c.json(
              {
                error: "Validation Error",
                issues: (err as { issues: unknown[] }).issues,
              },
              400,
            );
          }

          const message =
            err instanceof Error ? err.message : "Internal Server Error";
          // eslint-disable-next-line no-console
          console.error(`[capstan] Error in ${method} ${route.urlPattern}:`, message);
          return c.json({ error: message }, 500);
        }
      });
    }
  }

  // --- Register page routes -------------------------------------------------
  interface ExecutePageRouteArgs {
    request: Request;
    params: Record<string, string>;
    ctx: CapstanContext;
    isNavRequest: boolean;
    isStaticBuildRequest: boolean;
    liveReloadEnabled: boolean;
    /** Action result to inject into ActionContext during SSR (after form POST) */
    actionResult?: unknown;
    /** Submitted form data to inject into ActionContext during SSR */
    actionFormData?: Record<string, unknown>;
  }

  const pageRouteExecutors = new Map<
    string,
    (args: ExecutePageRouteArgs) => Promise<Response>
  >();

  const createPageRouteExecutor = async (
    route: RouteEntry,
  ): Promise<((args: ExecutePageRouteArgs) => Promise<Response>) | null> => {
    let pageModule: Awaited<ReturnType<typeof loadPageModule>>;
    const routeFilePath = resolveRuntimePath(config.rootDir, route.filePath);
    const resolvedLayouts = route.layouts.map((layoutPath) =>
      resolveRuntimePath(config.rootDir, layoutPath),
    );
    const resolvedMiddlewares = route.middlewares.map((middlewarePath) =>
      resolveRuntimePath(config.rootDir, middlewarePath),
    );
    const resolvedLoading = route.loading
      ? resolveRuntimePath(config.rootDir, route.loading)
      : undefined;
    const resolvedError = route.error
      ? resolveRuntimePath(config.rootDir, route.error)
      : undefined;

    try {
      pageModule = await loadPageModule(routeFilePath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[capstan] Failed to load page ${route.filePath}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }

    if (!pageModule.default) {
      // eslint-disable-next-line no-console
      console.warn(
        `[capstan] Page ${route.filePath} has no default export, skipping.`,
      );
      return null;
    }

    if (route.type === "page" && pageModule.renderMode === "ssg") {
      // eslint-disable-next-line no-console
      console.log(`[capstan] SSG page ${route.urlPattern} (will be pre-rendered at build)`);
    }

    const loadedLayoutsPromise = Promise.all(
      resolvedLayouts.map(async (layoutPath) => {
        const layoutMod = await loadLayoutModule(layoutPath);
        if (!layoutMod.default) {
          throw new Error(`Layout ${layoutPath} has no default export.`);
        }
        return {
          default: layoutMod.default as never,
          ...(layoutMod.metadata !== undefined ? { metadata: layoutMod.metadata } : {}),
        };
      }),
    );
    const middlewareDefinitionsPromise = loadRouteMiddlewares(resolvedMiddlewares)
      .then((loaded) => loaded.map((middleware) => middleware.definition));
    const loadingComponentPromise = resolvedLoading
      ? loadLoadingModule(resolvedLoading).then((loadingMod) => loadingMod.default)
      : Promise.resolve(undefined);
    const errorComponentPromise = resolvedError
      ? loadErrorModule(resolvedError).then((errorMod) => errorMod.default)
      : Promise.resolve(undefined);

    return async ({
      request,
      params,
      ctx,
      isNavRequest,
      isStaticBuildRequest,
      liveReloadEnabled,
      actionResult,
      actionFormData,
    }: ExecutePageRouteArgs): Promise<Response> => {
      const executePageRequest = async (): Promise<Response> => {
        if (
          route.type === "page" &&
          !isNavRequest &&
          !isStaticBuildRequest &&
          pageModule.renderMode === "ssg"
        ) {
          const staticHtml = await tryReadStaticHtml(
            new URL(request.url).pathname,
            config.staticDir,
            config.assetProvider,
          );
          if (staticHtml !== null) {
            return new Response(staticHtml, {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
              },
            });
          }
        }

        const [loadedLayouts, loadingComponent, errorComponent] = await Promise.all([
          loadedLayoutsPromise,
          loadingComponentPromise,
          errorComponentPromise,
        ]);
        const metadataChain = loadedLayouts
          .map((layout) => layout.metadata)
          .filter((metadata): metadata is NonNullable<typeof metadata> => metadata !== undefined);

        const loaderArgs = {
          params,
          request,
          ctx: { auth: ctx.auth },
          fetch: createPageFetch(request, {
            fetchImpl: async (internalRequest) => await app.fetch(internalRequest),
          }),
        };

        const pageRuntimeOptions = {
          pageModule: {
            default: pageModule.default as never,
            loader: pageModule.loader as never,
            hydration: pageModule.hydration as never,
            renderMode: pageModule.renderMode as never,
            revalidate: pageModule.revalidate as never,
            cacheTags: pageModule.cacheTags as never,
            componentType: route.componentType ?? "server",
            ...(pageModule.metadata !== undefined ? { metadata: pageModule.metadata } : {}),
          } as PageRuntimeOptions["pageModule"],
          layouts: loadedLayouts as PageRuntimeOptions["layouts"],
          params,
          request,
          loaderArgs,
          ...(route.type === "not-found" ? { statusCode: 404 } : {}),
          ...(metadataChain.length > 0 ? { metadataChain } : {}),
          componentType: route.componentType ?? "server",
          layoutKeys: route.layouts,
          renderMode: (
            isStaticBuildRequest && pageModule.renderMode === "ssg"
              ? "ssr"
              : pageModule.renderMode
          ) as "ssr" | "ssg" | "isr" | "streaming" | undefined,
          strategyOptions: {
            staticDir: config.staticDir ?? path.join(config.rootDir, "dist", "static"),
          },
          transport: pageModule.renderMode === "streaming" ? "stream" : "html",
          ...(pageModule.hydration !== undefined
            ? { hydration: pageModule.hydration as PageRuntimeOptions["hydration"] }
            : {}),
          ...(loadingComponent !== undefined
            ? { loadingComponent: loadingComponent as PageRuntimeOptions["loadingComponent"] }
            : {}),
          ...(errorComponent !== undefined
            ? { errorComponent: errorComponent as PageRuntimeOptions["errorComponent"] }
            : {}),
          ...(actionResult !== undefined ? { actionResult } : {}),
          ...(actionFormData !== undefined ? { actionFormData } : {}),
        } as PageRuntimeOptions;

        const pageResult = await runPageRuntime(pageRuntimeOptions);

        if (pageResult.kind === "navigation") {
          return new Response(pageResult.body, {
            status: pageResult.statusCode,
            headers: pageResult.headers,
          });
        }

        if (pageResult.transport === "stream") {
          const html = decoratePageHtml(
            await collectStreamToString(pageResult.stream),
            manifest,
            liveReloadEnabled,
            config.port,
          );
          return new Response(html, {
            status: pageResult.statusCode,
            headers: pageResult.headers,
          });
        }

        const html = decoratePageHtml(
          pageResult.html,
          manifest,
          liveReloadEnabled,
          config.port,
        );
        return new Response(html, {
          status: pageResult.statusCode,
          headers: pageResult.headers,
        });
      };

      try {
        const middlewareDefinitions = await middlewareDefinitionsPromise;
        return await composeRouteMiddlewares(
          middlewareDefinitions,
          async () => executePageRequest(),
        )({
          request,
          ctx,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal Server Error";
        // eslint-disable-next-line no-console
        console.error(`[capstan] Error in page ${route.urlPattern}:`, message);

        if (isNavRequest) {
          return new Response(
            JSON.stringify({ error: message }),
            {
              status: 500,
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
            },
          );
        }

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(config.appName ?? "Capstan App")}</title>
</head>
<body>
  <div id="capstan-root">
    <h1>Page Render Error</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;

        return new Response(
          decoratePageHtml(html, manifest, liveReloadEnabled, config.port),
          {
            status: 500,
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          },
        );
      }
    };
  };

  for (const route of [...pageRoutes, ...notFoundRoutes]) {
    const executePageRoute = await createPageRouteExecutor(route);
    if (!executePageRoute) {
      continue;
    }

    pageRouteExecutors.set(route.filePath, executePageRoute);

    if (route.type !== "page") {
      continue;
    }

    pageRouteCount++;

    app.get(route.urlPattern, async (c) => {
      const params: Record<string, string> = {};
      for (const name of route.params) {
        const value = c.req.param(name);
        if (value !== undefined) {
          params[name] = value;
        }
      }

      return executePageRoute({
        request: c.req.raw,
        params,
        ctx: createContext(c),
        isNavRequest: c.req.header("X-Capstan-Nav") === "1",
        isStaticBuildRequest: c.req.header("X-Capstan-Static-Build") === "1",
        liveReloadEnabled: config.liveReload === true,
      });
    });

    // --- POST handler for page actions ------------------------------------
    const routeFilePathForPost = resolveRuntimePath(config.rootDir, route.filePath);
    const postResolvedMiddlewares = route.middlewares.map((middlewarePath) =>
      resolveRuntimePath(config.rootDir, middlewarePath),
    );
    const postMiddlewareDefinitionsPromise = loadRouteMiddlewares(postResolvedMiddlewares)
      .then((loaded) => loaded.map((middleware) => middleware.definition));

    app.post(route.urlPattern, async (c) => {
      const params: Record<string, string> = {};
      for (const name of route.params) {
        const value = c.req.param(name);
        if (value !== undefined) {
          params[name] = value;
        }
      }

      const isNavRequest = c.req.header("X-Capstan-Nav") === "1";

      let actionDef: unknown;
      try {
        actionDef = await loadActionHandler(routeFilePathForPost);
      } catch {
        // Module load failure — fall through to 405
      }

      if (!actionDef || !isActionDef(actionDef)) {
        return new Response(
          JSON.stringify({ error: "Method Not Allowed" }),
          {
            status: 405,
            headers: {
              "content-type": "application/json; charset=utf-8",
              Allow: "GET",
            },
          },
        );
      }

      // Parse request body into a plain object
      let formObject: Record<string, unknown> = {};
      const contentType = c.req.header("content-type") ?? "";

      try {
        if (contentType.includes("application/json")) {
          const parsed: unknown = await c.req.json();
          // Guard: JSON body must be a plain object, not array/string/null
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return new Response(
              JSON.stringify({ error: "Request body must be a JSON object" }),
              { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
            );
          }
          formObject = parsed as Record<string, unknown>;
        } else if (
          contentType.includes("multipart/form-data") ||
          contentType.includes("application/x-www-form-urlencoded")
        ) {
          const formData = await c.req.formData();
          const grouped = new Map<string, unknown[]>();
          formData.forEach((value, key) => {
            const existing = grouped.get(key);
            if (existing) {
              existing.push(value);
            } else {
              grouped.set(key, [value]);
            }
          });
          for (const [key, values] of grouped) {
            formObject[key] = values.length === 1 ? values[0] : values;
          }
        }
      } catch {
        return new Response(
          JSON.stringify({ error: "Failed to parse request body" }),
          {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        );
      }

      // Strip internal marker field injected by ActionForm
      delete formObject["_capstan_action"];

      const ctx = createContext(c);
      const request = c.req.raw;

      // Execute action within route middleware chain (same as GET)
      const executeAction = async (): Promise<Response> => {
        const actionArgs: ActionArgs = {
          input: formObject,
          params,
          request,
          ctx: { auth: ctx.auth as ActionArgs["ctx"]["auth"] },
        };

        try {
          const result = await (actionDef as ActionDefinition).handler(actionArgs);

          if (isNavRequest) {
            return new Response(JSON.stringify({ actionResult: result }), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          // Re-render page with action result available in ActionContext
          return executePageRoute({
            request,
            params,
            ctx,
            isNavRequest: false,
            isStaticBuildRequest: false,
            liveReloadEnabled: config.liveReload === true,
            actionResult: result,
            actionFormData: formObject,
          });
        } catch (err) {
          if (err instanceof ActionRedirectError) {
            if (isNavRequest) {
              return new Response(
                JSON.stringify({ redirect: err.url }),
                {
                  status: 200,
                  headers: { "content-type": "application/json; charset=utf-8" },
                },
              );
            }
            return new Response(null, {
              status: err.status,
              headers: { Location: err.url },
            });
          }

          const message = err instanceof Error ? err.message : "Action handler error";
          if (isNavRequest) {
            return new Response(
              JSON.stringify({ actionResult: { ok: false, error: message } }),
              {
                status: 500,
                headers: { "content-type": "application/json; charset=utf-8" },
              },
            );
          }

          return executePageRoute({
            request,
            params,
            ctx,
            isNavRequest: false,
            isStaticBuildRequest: false,
            liveReloadEnabled: config.liveReload === true,
            actionResult: { ok: false, error: message },
            actionFormData: formObject,
          });
        }
      };

      // Wrap action execution in route-level middleware (same as GET handler)
      try {
        const middlewareDefinitions = await postMiddlewareDefinitionsPromise;
        return await composeRouteMiddlewares(
          middlewareDefinitions,
          async () => executeAction(),
        )({ request, ctx });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal Server Error";
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
    });
  }

  // --- Approval management endpoints ----------------------------------------

  mountApprovalRoutes(app, handlerRegistry);

  if (ops) {
    const mode: "development" | "production" =
      config.port !== undefined ? "development" : "production";
    const healthSnapshotInput: Parameters<CapstanOpsContext["recordHealthSnapshot"]>[0] = {
      appName: config.appName ?? "capstan-app",
      routeCount: routeRegistry.length,
      apiRouteCount,
      pageRouteCount,
      approvalCount: 0,
      mode,
      ...(config.policyRegistry !== undefined
        ? { policyCount: config.policyRegistry.size }
        : {}),
      ...(config.ops?.recentWindowMs !== undefined
        ? { recentWindowMs: config.ops.recentWindowMs }
        : {}),
      ...(config.auth?.session ? { notes: ["session-auth-enabled"] } : {}),
    };
    void ops.recordHealthSnapshot(healthSnapshotInput).catch(() => void 0);
  }

  // --- Runtime client assets -------------------------------------------------

  app.get("/_capstan/client.js", () => {
    return new Response(CAPSTAN_CLIENT_BOOTSTRAP, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });

  app.get("/_capstan/client/*", async (c) => {
    if (c.req.path === "/_capstan/client/hydrate-current.js") {
      const url = new URL(c.req.url);
      const requestedPath = url.searchParams.get("path") || "/";
      const matched = matchRoute(manifest, "GET", requestedPath);
      if (!matched || matched.route.type !== "page") {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const code = await buildHydrationModule(
          matched.route,
          config.rootDir ?? process.cwd(),
        );
        return new Response(code, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[capstan] Failed to build hydration module:", message);
        return new Response(
          `throw new Error(${JSON.stringify(`Failed to build hydration module: ${message}`)});`,
          {
            status: 500,
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      }
    }

    if (c.req.path === SHARED_REACT_MODULE) {
      try {
        const code = await buildSharedReactModule();
        return new Response(code, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
          `throw new Error(${JSON.stringify(`Failed to build shared react module: ${message}`)});`,
          {
            status: 500,
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      }
    }

    if (c.req.path === SHARED_REACT_DOM_CLIENT_MODULE) {
      try {
        const code = await buildSharedReactDomClientModule();
        return new Response(code, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
          `throw new Error(${JSON.stringify(`Failed to build shared react-dom/client module: ${message}`)});`,
          {
            status: 500,
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      }
    }

    if (c.req.path === SHARED_REACT_DOM_MODULE) {
      try {
        const code = await buildSharedReactDomModule();
        return new Response(code, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
          `throw new Error(${JSON.stringify(`Failed to build shared react-dom module: ${message}`)});`,
          {
            status: 500,
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      }
    }

    if (c.req.path === SHARED_REACT_JSX_RUNTIME_MODULE) {
      try {
        const code = await buildSharedReactJsxRuntimeModule();
        return new Response(code, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
          `throw new Error(${JSON.stringify(`Failed to build shared react/jsx-runtime module: ${message}`)});`,
          {
            status: 500,
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      }
    }

    if (c.req.path === "/_capstan/client/route-module.js") {
      const url = new URL(c.req.url);
      const requestedPath = url.searchParams.get("path") || "/";
      const matched = matchRoute(manifest, "GET", requestedPath);
      if (!matched || matched.route.type !== "page") {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const code = await buildRouteModule(
          matched.route,
          config.rootDir ?? process.cwd(),
        );
        return new Response(code, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[capstan] Failed to build route module:", message);
        return new Response(
          `throw new Error(${JSON.stringify(`Failed to build route module: ${message}`)});`,
          {
            status: 500,
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      }
    }

    const assetPath = c.req.path.slice("/_capstan/client/".length);
    return serveReactClientAssetFromConfig(assetPath, config);
  });

  // --- Image optimization endpoint ------------------------------------------

  const imageHandler = (await import("./image-endpoint.js")).createImageEndpointHandler(
    config.rootDir ?? process.cwd(),
    config.imageOptimizer,
  );
  app.get("/_capstan/image", async (c) => {
    return imageHandler(c.req.raw);
  });

  // --- HMR / live-reload SSE endpoint (Hono-level for Bun compatibility) ----
  // The Node adapter intercepts this in adapter-node.ts, but the Bun adapter
  // passes all requests through Hono, so we register it here as well.
  app.get("/__capstan_hmr", (c) => {
    const transport = _hmrTransport;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const write = (data: string) => {
          try { controller.enqueue(encoder.encode(data)); } catch { /* closed */ }
        };
        const close = () => {
          try { controller.close(); } catch { /* already closed */ }
        };
        write(": connected\n\n");
        let disposeClient: (() => void) | null = null;
        if (transport) {
          disposeClient = transport.handleSSEConnection({ write, close });
        }
        // Abort signal removes client on disconnect using the exact tracked reference
        c.req.raw.signal.addEventListener("abort", () => {
          if (disposeClient) disposeClient();
        });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });
  app.get("/__capstan_livereload", (c) => {
    // Redirect legacy endpoint to the HMR endpoint
    return c.redirect("/__capstan_hmr", 307);
  });

  // --- Framework endpoints --------------------------------------------------

  // Agent manifest
  app.get("/.well-known/capstan.json", (c) => {
    const manifest = {
      capstan: "1.0",
      name: config.appName ?? "capstan-app",
      description: config.appDescription ?? "",
      authentication: {
        schemes: [
          {
            type: "bearer" as const,
            name: "API Key",
            header: "Authorization",
            description: "Bearer token for agent authentication",
          },
        ],
      },
      capabilities: routeRegistry.map((r) => ({
        key: `${r.method} ${r.path}`,
        title: r.description ?? `${r.method} ${r.path}`,
        mode: (r.capability ?? "read") as "read" | "write" | "external",
        endpoint: {
          method: r.method,
          path: r.path,
          ...(r.inputSchema ? { inputSchema: r.inputSchema } : {}),
          ...(r.outputSchema ? { outputSchema: r.outputSchema } : {}),
        },
      })),
    };
    return c.json(manifest);
  });

  // OpenAPI spec
  app.get("/openapi.json", (c) => {
    const paths: Record<string, Record<string, object>> = {};

    for (const r of routeRegistry) {
      const pathKey = r.path.replace(/:(\w+)/g, "{$1}").replace(/\*/g, "{path}");
      if (!paths[pathKey]) {
        paths[pathKey] = {};
      }
      paths[pathKey]![r.method.toLowerCase()] = {
        summary: r.description ?? `${r.method} ${r.path}`,
        operationId: `${r.method.toLowerCase()}_${r.path.replace(/[/:*]/g, "_").replace(/^_/, "")}`,
        responses: {
          "200": {
            description: "Successful response",
            ...(r.outputSchema ? { content: { "application/json": { schema: r.outputSchema } } } : {}),
          },
        },
        ...(r.inputSchema ? { requestBody: { content: { "application/json": { schema: r.inputSchema } } } } : {}),
      };
    }

    const spec = {
      openapi: "3.1.0",
      info: {
        title: config.appName ?? "capstan-app",
        description: config.appDescription ?? "",
        version: "0.3.0",
      },
      paths,
    };

    return c.json(spec);
  });

  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      uptime:
        typeof process !== "undefined" && typeof process.uptime === "function"
          ? process.uptime()
          : 0,
      timestamp: new Date().toISOString(),
    });
  });

  // --- A2A endpoints ---------------------------------------------------------
  // GET /.well-known/agent.json — A2A Agent Card discovery
  // POST /.well-known/a2a       — A2A JSON-RPC task handler

  app.get("/.well-known/agent.json", async (c) => {
    try {
      const agentPkg = await getAgentPkg();

      const card = agentPkg.generateA2AAgentCard(
        {
          name: config.appName ?? "capstan-app",
          ...(config.appDescription ? { description: config.appDescription } : {}),
          baseUrl: `http://${config.host ?? "localhost"}:${config.port ?? 3000}`,
        },
        routeRegistry,
      );
      return c.json(card as object);
    } catch {
      return c.json(
        { error: "@zauso-ai/capstan-agent not available — A2A disabled" },
        501,
      );
    }
  });

  app.post("/.well-known/a2a", async (c) => {
    try {
      const agentPkg = await getAgentPkg();

      const executeRoute = async (
        method: string,
        urlPath: string,
        input: unknown,
      ): Promise<unknown> => {
        const url = `http://localhost:${config.port ?? 3000}${urlPath}`;
        const init: RequestInit = {
          method,
          headers: { "Content-Type": "application/json" },
        };
        if (method !== "GET" && method !== "HEAD" && input !== undefined) {
          init.body = JSON.stringify(input);
        }
        const request = new Request(url, init);
        // Use the outer Hono app reference for internal dispatch.
        const response = await app.fetch(request);
        try {
          return await response.json();
        } catch {
          return { status: response.status, body: await response.text() };
        }
      };

      const handler = agentPkg.createA2AHandler(
        {
          name: config.appName ?? "capstan-app",
          ...(config.appDescription ? { description: config.appDescription } : {}),
          baseUrl: `http://${config.host ?? "localhost"}:${config.port ?? 3000}`,
        },
        routeRegistry,
        executeRoute,
      );

      const body = await c.req.json();
      const result = await handler.handleRequest(body);
      return c.json(result as object);
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "@zauso-ai/capstan-agent not available — A2A disabled",
          },
        },
        501,
      );
    }
  });

  // --- MCP discovery endpoint -----------------------------------------------
  // POST /.well-known/mcp returns a JSON description of available MCP tools
  // so that agents can discover capabilities without connecting via stdio.

  app.post("/.well-known/mcp", async (c) => {
    try {
      const agentPkg = await getAgentPkg();

      const tools = routeRegistry.map((r) => ({
        name: agentPkg.routeToToolName(r.method, r.path),
        description: r.description ?? `${r.method} ${r.path}`,
        method: r.method,
        path: r.path,
        inputSchema: r.inputSchema ?? { type: "object", properties: {} },
      }));

      return c.json({
        protocol: "mcp",
        version: "1.0",
        name: config.appName ?? "capstan-app",
        tools,
      });
    } catch {
      // @zauso-ai/capstan-agent not available
      return c.json({
        protocol: "mcp",
        version: "1.0",
        name: config.appName ?? "capstan-app",
        tools: [],
        error: "@zauso-ai/capstan-agent not available",
      });
    }
  });

  // --- Static file serving (app/public/) ------------------------------------
  // Serve files from publicDir as static assets at the root URL path.
  // This is registered AFTER all API/page/framework routes so that named
  // routes always take priority.

  const publicDir = config.publicDir ?? path.join(config.rootDir, "app", "public");

  app.get("*", async (c) => {
    const urlPath = new URL(c.req.url).pathname;

    if (config.assetProvider?.readPublicAsset) {
      const provided = await config.assetProvider.readPublicAsset(urlPath);
      if (provided) {
        return new Response(cloneBufferSource(await materializeAsset(provided)), {
          status: 200,
          headers: {
            "Content-Type": provided.contentType ?? "application/octet-stream",
            "Cache-Control": "no-cache",
          },
        });
      }
    }

    // Prevent directory traversal
    const resolved = path.resolve(publicDir, `.${urlPath}`);
    if (!resolved.startsWith(publicDir)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const content = await readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      if (shouldRenderNotFoundPage(c.req.raw)) {
        const matched = matchRoute(manifest, "GET", urlPath);
        if (matched?.route.type === "not-found") {
          const executePageRoute = pageRouteExecutors.get(matched.route.filePath);
          if (executePageRoute) {
            return await executePageRoute({
              request: c.req.raw,
              params: matched.params,
              ctx: createContext(c),
              isNavRequest: c.req.header("X-Capstan-Nav") === "1",
              isStaticBuildRequest: c.req.header("X-Capstan-Static-Build") === "1",
              liveReloadEnabled: config.liveReload === true,
            });
          }
        }
      }

      return c.notFound();
    }
  });

  return { app, apiRouteCount, pageRouteCount, routeRegistry };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and return a dev server instance that:
 *
 * 1. Scans `app/routes/` for route files
 * 2. Creates a Hono server with all routes registered
 * 3. Starts an HTTP server on the configured port
 * 4. Watches for file changes and re-builds routes
 * 5. Serves the agent manifest, OpenAPI spec, and health endpoint
 * 6. Prints a startup banner with URLs and route counts
 */
export async function createDevServer(
  config: DevServerConfig,
): Promise<DevServerInstance> {
  const port = config.port ?? 3000;
  const host = config.host ?? "0.0.0.0";
  const routesDir = path.join(config.rootDir, "app", "routes");
  config.publicDir = config.publicDir ?? path.join(config.rootDir, "app", "public");

  // --- Initial route scan ---------------------------------------------------

  const routeScanCache = createRouteScanCache();
  let manifest = await scanRoutes(routesDir, { cache: routeScanCache });
  let { app, apiRouteCount, pageRouteCount, routeRegistry } = await buildRuntimeApp({
    ...config,
    manifest,
    mode: "development",
    liveReload: true,
  });

  // The Node.js HTTP server holds a reference to the current Hono app.
  // When routes change we rebuild the app and swap the reference -- in-flight
  // requests finish against the old app while new requests hit the new one.
  let currentApp = app;

  // --- HMR coordinator -------------------------------------------------------
  const hmrHostname =
    !config.host || config.host === "0.0.0.0" || config.host === "::"
      ? "localhost"
      : config.host;

  const hmrCoordinator = createHmrCoordinator({
    rootDir: config.rootDir,
    routesDir,
    hostname: hmrHostname,
  });
  const hmrTransport = createHmrTransport();

  // Expose globally so the script injector and adapter-node can reach them.
  _hmrCoordinator = hmrCoordinator;
  _hmrTransport = hmrTransport;

  // --- MCP server instance ---------------------------------------------------
  // Create an MCP server backed by the route registry so that `capstan mcp`
  // can connect to the running dev server's routes. The executeRoute callback
  // invokes the Hono app directly using an internal fetch.

  type McpServerType = { server: unknown; getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }> };
  let mcpInstance: McpServerType | null = null;

  async function buildMcpServer(): Promise<void> {
    try {
      const agentPkg = await getAgentPkg();

      const executeRoute = async (
        method: string,
        urlPath: string,
        input: unknown,
      ): Promise<unknown> => {
        const url = `http://localhost:${port}${urlPath}`;
        const init: RequestInit = {
          method,
          headers: { "Content-Type": "application/json" },
        };
        if (method !== "GET" && method !== "HEAD" && input !== undefined) {
          init.body = JSON.stringify(input);
        }
        const request = new Request(url, init);
        const response = await currentApp.fetch(request);
        try {
          return await response.json();
        } catch {
          return { status: response.status, body: await response.text() };
        }
      };

      mcpInstance = agentPkg.createMcpServer(
        {
          name: config.appName ?? "capstan-app",
          ...(config.appDescription ? { description: config.appDescription } : {}),
        },
        routeRegistry,
        executeRoute,
      );
    } catch {
      // @zauso-ai/capstan-agent not available — MCP disabled.
      mcpInstance = null;
    }
  }

  await buildMcpServer();

  // --- Runtime adapter selection --------------------------------------------

  let adapter: ServerAdapter;

  // Detect Bun runtime at startup. If `Bun` global exists, use the Bun
  // adapter; otherwise fall back to the Node.js adapter.
  const isBun = typeof (globalThis as Record<string, unknown>)["Bun"] !== "undefined";

  if (isBun) {
    const { createBunAdapter } = await import("./adapter-bun.js");
    adapter = createBunAdapter();
  } else {
    adapter = createNodeAdapter({ maxBodySize: config.maxBodySize });
  }

  // The adapter handle is assigned once `start()` is called.
  let adapterHandle: { close: () => Promise<void> } | null = null;

  // --- File watcher ---------------------------------------------------------

  async function rebuildRoutes(changedFile?: string): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.log("[capstan] Routes changed, rebuilding...");
      // Invalidate only the changed file so unchanged modules stay cached.
      invalidateModuleCache(changedFile);
      manifest = await scanRoutes(routesDir, { cache: routeScanCache, ...(changedFile !== undefined ? { changedFile } : {}) });
      const rebuilt = await buildRuntimeApp({
        ...config,
        manifest,
        mode: "development",
        liveReload: true,
      });
      currentApp = rebuilt.app;
      apiRouteCount = rebuilt.apiRouteCount;
      pageRouteCount = rebuilt.pageRouteCount;
      routeRegistry = rebuilt.routeRegistry;

      // Rebuild MCP server with updated routes.
      await buildMcpServer();

      // Determine update type via HMR coordinator and broadcast to clients.
      if (changedFile) {
        const update = hmrCoordinator.handleFileChange(changedFile);
        hmrTransport.broadcast(update);
      } else {
        // No specific file — full reload via legacy path.
        notifyLiveReloadClients();
      }

      const totalRoutes = apiRouteCount + pageRouteCount;
      // eslint-disable-next-line no-console
      console.log(
        `[capstan] Rebuilt: ${totalRoutes} routes (${apiRouteCount} API, ${pageRouteCount} pages)`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[capstan] Failed to rebuild routes:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const watcher = watchRoutes(routesDir, (changedFile) => {
    void rebuildRoutes(changedFile);
  });

  // --- CSS processing -------------------------------------------------------

  const stylesDir = path.join(config.rootDir, "app", "styles");
  const cssEntry = path.join(stylesDir, "main.css");
  const cssOutFile = path.join(
    config.publicDir ?? path.join(config.rootDir, "app", "public"),
    "_capstan",
    "styles.css",
  );

  const cssMode = await detectCSSMode(config.rootDir);

  let cssStylesWatcher: { close: () => void } | null = null;
  let tailwindHandle: { stop: () => void } | null = null;

  if (cssMode === "lightningcss") {
    // Initial build
    try {
      await buildCSS(cssEntry, cssOutFile, true);
      // eslint-disable-next-line no-console
      console.log("[capstan] CSS built (Lightning CSS)");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[capstan] CSS build failed:",
        err instanceof Error ? err.message : err,
      );
    }

    // Watch for CSS changes and rebuild
    cssStylesWatcher = watchStyles(stylesDir, (changedFile) => {
      void (async () => {
        try {
          await buildCSS(cssEntry, cssOutFile, true);

          // Use HMR transport for granular CSS hot-swap when possible.
          if (changedFile) {
            const update = hmrCoordinator.handleFileChange(changedFile);
            hmrTransport.broadcast(update);
          } else {
            notifyLiveReloadClients();
          }

          // eslint-disable-next-line no-console
          console.log("[capstan] CSS rebuilt");
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            "[capstan] CSS rebuild failed:",
            err instanceof Error ? err.message : err,
          );
        }
      })();
    });
  } else if (cssMode === "tailwind") {
    tailwindHandle = startTailwindWatch(cssEntry, cssOutFile);
    // eslint-disable-next-line no-console
    console.log("[capstan] Tailwind CSS watch started");
  }

  // --- DevServerInstance ----------------------------------------------------

  let shuttingDown = false;

  const instance: DevServerInstance = {
    port,
    host,

    async start(): Promise<void> {
      adapterHandle = await adapter.listen(
        { fetch: (req) => currentApp.fetch(req) },
        port,
        host,
      );

      printStartupBanner({
        appName: config.appName ?? "capstan-app",
        port,
        host,
        routeCount: apiRouteCount + pageRouteCount,
        apiRouteCount,
        pageRouteCount,
      });
    },

    async stop(): Promise<void> {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      // eslint-disable-next-line no-console
      console.log("[capstan] Shutting down gracefully...");

      // 1. Close watchers so no more rebuilds are triggered.
      watcher.close();
      if (cssStylesWatcher) {
        cssStylesWatcher.close();
      }
      if (tailwindHandle) {
        tailwindHandle.stop();
      }

      // 2. Dispose HMR coordinator and transport.
      hmrCoordinator.dispose();
      hmrTransport.dispose();
      _hmrCoordinator = null;
      _hmrTransport = null;

      // 3. Close the server via the adapter (handles SSE cleanup, connection
      //    draining, etc. for the Node adapter; simple stop for Bun).
      if (adapterHandle) {
        await adapterHandle.close();
      }
    },
  };

  // --- Signal handlers -------------------------------------------------------
  // Register SIGINT/SIGTERM so that `Ctrl-C` and container stop signals
  // trigger a graceful shutdown instead of an abrupt process exit.

  function onSignal(): void {
    void instance.stop().then(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return instance;
}
