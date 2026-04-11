/**
 * Comprehensive unit tests for the Capstan dev package.
 *
 * Tests pure functions, parsers, analyzers, and transformers that do NOT
 * require a running server, filesystem watching, or network access.
 */

import { describe, it, expect, beforeEach } from "bun:test";

// All public exports come from the main package entry
import {
  // analyzer.ts
  formatBytes,
  computeSizes,
  checkBudgets,
  formatAnalysisTable,
  formatAnalysisSummary,
  formatBudgetReport,
  DEFAULT_BUDGETS,
  // hmr.ts
  createHmrCoordinator,
  createHmrTransport,
  // loader.ts
  loadRouteModule,
  registerVirtualRouteModule,
  registerVirtualRouteModules,
  clearVirtualRouteModules,
  // page-fetch.ts
  PageFetchError,
  createPageFetch,
  // page-runtime.ts
  runPageRuntime,
  // runtime.ts
  buildPortableRuntimeApp,
  // adapter-node.ts
  createNodeAdapter,
  // types
  type BundleAnalysis,
  type BundleSizeEntry,
  type HmrUpdate,
} from "@zauso-ai/capstan-dev";

// invalidateModuleCache is not re-exported from the main index
import { invalidateModuleCache } from "../../packages/dev/src/loader.js";

// Internal modules imported via direct source paths for testing
import {
  PageFetchRequestCache,
  createPageFetchCacheKey,
  shouldCacheFetchResponse,
  resolveSharedPageFetchCachePolicy,
} from "../../packages/dev/src/page-fetch-cache.js";

import {
  createRuntimeDiagnostic,
  mergeRuntimeDiagnostics,
  runtimeDiagnosticsHeaders,
  serializeRuntimeDiagnostics,
  createRouteRuntimeDiagnostics,
  createPageRuntimeDiagnostics,
} from "../../packages/dev/src/runtime-diagnostics.js";

import {
  notifyLiveReloadClients,
  closeLiveReloadClients,
  registerWSRoute,
  clearWSRoutes,
} from "../../packages/dev/src/adapter-node.js";

import {
  resolveProjectOpsConfig,
} from "../../packages/dev/src/ops-sink.js";

// ===================================================================
// analyzer.ts — Bundle analyzer
// ===================================================================

describe("analyzer.ts", () => {
  // -------------------------------------------------------------------
  // formatBytes
  // -------------------------------------------------------------------

  describe("formatBytes", () => {
    it("returns '0 B' for zero bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    it("returns '0 B' for negative numbers", () => {
      expect(formatBytes(-100)).toBe("0 B");
    });

    it("returns '0 B' for NaN", () => {
      expect(formatBytes(NaN)).toBe("0 B");
    });

    it("returns '0 B' for Infinity", () => {
      expect(formatBytes(Infinity)).toBe("0 B");
    });

    it("formats bytes under 1024 as B", () => {
      expect(formatBytes(512)).toBe("512 B");
    });

    it("formats bytes under 1 MB as KB", () => {
      expect(formatBytes(2048)).toBe("2.00 KB");
    });

    it("formats bytes at exactly 1024 as KB", () => {
      expect(formatBytes(1024)).toBe("1.00 KB");
    });

    it("formats bytes over 1 MB as MB", () => {
      expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MB");
    });

    it("formats fractional KB values", () => {
      expect(formatBytes(1536)).toBe("1.50 KB");
    });

    it("rounds small byte values", () => {
      expect(formatBytes(7)).toBe("7 B");
    });
  });

  // -------------------------------------------------------------------
  // computeSizes
  // -------------------------------------------------------------------

  describe("computeSizes", () => {
    it("returns zero sizes for empty content", async () => {
      const sizes = await computeSizes("");
      expect(sizes.raw).toBe(0);
      expect(sizes.gzip).toBe(0);
      expect(sizes.brotli).toBe(0);
    });

    it("computes raw size from string content", async () => {
      const content = "hello world";
      const sizes = await computeSizes(content);
      expect(sizes.raw).toBe(Buffer.from(content).length);
    });

    it("computes gzip and brotli sizes smaller than raw for large input", async () => {
      const content = "a".repeat(10000);
      const sizes = await computeSizes(content);
      expect(sizes.raw).toBe(10000);
      expect(sizes.gzip).toBeLessThan(sizes.raw);
      expect(sizes.brotli).toBeLessThan(sizes.raw);
    });

    it("accepts Uint8Array input", async () => {
      const buf = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const sizes = await computeSizes(buf);
      expect(sizes.raw).toBe(5);
      expect(sizes.gzip).toBeGreaterThan(0);
      expect(sizes.brotli).toBeGreaterThan(0);
    });

    it("computes non-zero gzip/brotli for small input", async () => {
      const sizes = await computeSizes("x");
      expect(sizes.raw).toBe(1);
      expect(sizes.gzip).toBeGreaterThan(0);
      expect(sizes.brotli).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // checkBudgets
  // -------------------------------------------------------------------

  function makeAnalysis(overrides: Partial<BundleAnalysis> = {}): BundleAnalysis {
    const zero: BundleSizeEntry = { raw: 0, gzip: 0, brotli: 0 };
    return {
      timestamp: new Date().toISOString(),
      totalSize: { ...zero },
      jsSize: { ...zero },
      cssSize: { ...zero },
      routes: [],
      chunks: [],
      assets: [],
      routeCount: 0,
      sharedChunkCount: 0,
      ...overrides,
    };
  }

  describe("checkBudgets", () => {
    it("passes when all sizes are within budget", () => {
      const analysis = makeAnalysis({
        totalSize: { raw: 1024, gzip: 512, brotli: 400 },
        jsSize: { raw: 512, gzip: 256, brotli: 200 },
        cssSize: { raw: 512, gzip: 256, brotli: 200 },
      });
      const result = checkBudgets(analysis, DEFAULT_BUDGETS);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("reports violation when total size exceeds budget (gzip by default)", () => {
      const analysis = makeAnalysis({
        totalSize: { raw: 500 * 1024, gzip: 300 * 1024, brotli: 200 * 1024 },
      });
      const result = checkBudgets(analysis, { maxTotalSizeKb: 250, useGzip: true });
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]!.rule).toBe("maxTotalSizeKb");
    });

    it("uses raw size when useGzip is false", () => {
      const analysis = makeAnalysis({
        totalSize: { raw: 200 * 1024, gzip: 300 * 1024, brotli: 100 * 1024 },
      });
      const result = checkBudgets(analysis, { maxTotalSizeKb: 250, useGzip: false });
      expect(result.passed).toBe(true);
    });

    it("checks per-route budgets", () => {
      const analysis = makeAnalysis({
        routes: [
          {
            pattern: "/big-page",
            filePath: "big.page.tsx",
            js: { raw: 200 * 1024, gzip: 150 * 1024, brotli: 100 * 1024 },
            css: { raw: 0, gzip: 0, brotli: 0 },
            total: { raw: 200 * 1024, gzip: 150 * 1024, brotli: 100 * 1024 },
            chunks: [],
          },
        ],
      });
      const result = checkBudgets(analysis, { maxRouteSizeKb: 100, useGzip: true });
      expect(result.passed).toBe(false);
      expect(result.violations[0]!.rule).toBe("maxRouteSizeKb");
      expect(result.violations[0]!.target).toBe("/big-page");
    });

    it("checks per-chunk budgets", () => {
      const analysis = makeAnalysis({
        chunks: [
          {
            name: "vendor.js",
            size: { raw: 200 * 1024, gzip: 180 * 1024, brotli: 160 * 1024 },
            modules: [],
            isEntry: false,
            isDynamic: false,
          },
        ],
      });
      const result = checkBudgets(analysis, { maxChunkSizeKb: 150, useGzip: true });
      expect(result.passed).toBe(false);
      expect(result.violations[0]!.target).toBe("vendor.js");
    });

    it("checks JS size budget", () => {
      const analysis = makeAnalysis({
        jsSize: { raw: 300 * 1024, gzip: 250 * 1024, brotli: 200 * 1024 },
      });
      const result = checkBudgets(analysis, { maxJsSizeKb: 200, useGzip: true });
      expect(result.passed).toBe(false);
      expect(result.violations[0]!.rule).toBe("maxJsSizeKb");
    });

    it("checks CSS size budget", () => {
      const analysis = makeAnalysis({
        cssSize: { raw: 100 * 1024, gzip: 60 * 1024, brotli: 40 * 1024 },
      });
      const result = checkBudgets(analysis, { maxCssSizeKb: 50, useGzip: true });
      expect(result.passed).toBe(false);
      expect(result.violations[0]!.rule).toBe("maxCssSizeKb");
    });

    it("skips checks for undefined budget limits", () => {
      const analysis = makeAnalysis({
        totalSize: { raw: 999 * 1024, gzip: 999 * 1024, brotli: 999 * 1024 },
      });
      const result = checkBudgets(analysis, {});
      expect(result.passed).toBe(true);
    });

    it("accumulates multiple violations", () => {
      const analysis = makeAnalysis({
        totalSize: { raw: 500 * 1024, gzip: 500 * 1024, brotli: 500 * 1024 },
        jsSize: { raw: 400 * 1024, gzip: 400 * 1024, brotli: 400 * 1024 },
        cssSize: { raw: 100 * 1024, gzip: 100 * 1024, brotli: 100 * 1024 },
      });
      const result = checkBudgets(analysis, {
        maxTotalSizeKb: 100,
        maxJsSizeKb: 100,
        maxCssSizeKb: 50,
        useGzip: true,
      });
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------
  // formatAnalysisTable / formatAnalysisSummary / formatBudgetReport
  // -------------------------------------------------------------------

  describe("formatAnalysisTable", () => {
    it("returns a string containing route information", () => {
      const analysis = makeAnalysis({
        routes: [
          {
            pattern: "/",
            filePath: "index.page.tsx",
            js: { raw: 5000, gzip: 2000, brotli: 1500 },
            css: { raw: 1000, gzip: 500, brotli: 400 },
            total: { raw: 6000, gzip: 2500, brotli: 1900 },
            chunks: ["index.js"],
          },
        ],
        routeCount: 1,
      });
      const table = formatAnalysisTable(analysis);
      expect(table).toContain("/");
      expect(table).toContain("Route");
      expect(table).toContain("JS (gz)");
      expect(table).toContain("CSS (gz)");
    });

    it("handles empty routes gracefully", () => {
      const analysis = makeAnalysis();
      const table = formatAnalysisTable(analysis);
      expect(table).toContain("(no routes)");
    });

    it("truncates long route patterns", () => {
      const analysis = makeAnalysis({
        routes: [
          {
            pattern: "/very/long/route/pattern/that/exceeds/column/width",
            filePath: "deep.page.tsx",
            js: { raw: 1000, gzip: 500, brotli: 400 },
            css: { raw: 0, gzip: 0, brotli: 0 },
            total: { raw: 1000, gzip: 500, brotli: 400 },
            chunks: [],
          },
        ],
        routeCount: 1,
      });
      const table = formatAnalysisTable(analysis);
      expect(table).toContain("\u2026");
    });
  });

  describe("formatAnalysisSummary", () => {
    it("includes total, JS, CSS, and route count", () => {
      const analysis = makeAnalysis({
        totalSize: { raw: 10000, gzip: 5000, brotli: 4000 },
        jsSize: { raw: 8000, gzip: 4000, brotli: 3000 },
        cssSize: { raw: 2000, gzip: 1000, brotli: 1000 },
        routeCount: 3,
        sharedChunkCount: 1,
      });
      const summary = formatAnalysisSummary(analysis);
      expect(summary).toContain("Total:");
      expect(summary).toContain("JS:");
      expect(summary).toContain("CSS:");
      expect(summary).toContain("Routes: 3");
      expect(summary).toContain("Shared chunks: 1");
    });
  });

  describe("formatBudgetReport", () => {
    it("returns pass message when no violations", () => {
      const report = formatBudgetReport({ passed: true, violations: [] });
      expect(report).toContain("All budgets passed");
    });

    it("lists violations when present", () => {
      const report = formatBudgetReport({
        passed: false,
        violations: [
          {
            rule: "maxTotalSizeKb",
            limit: 250,
            actual: 300,
            message: "maxTotalSizeKb: 300 KB exceeds 250 KB",
          },
        ],
      });
      expect(report).toContain("Budget violations (1)");
      expect(report).toContain("maxTotalSizeKb");
    });
  });

  describe("DEFAULT_BUDGETS", () => {
    it("has sensible default values", () => {
      expect(DEFAULT_BUDGETS.maxTotalSizeKb).toBe(250);
      expect(DEFAULT_BUDGETS.maxRouteSizeKb).toBe(100);
      expect(DEFAULT_BUDGETS.maxChunkSizeKb).toBe(150);
      expect(DEFAULT_BUDGETS.maxCssSizeKb).toBe(50);
      expect(DEFAULT_BUDGETS.maxJsSizeKb).toBe(200);
      expect(DEFAULT_BUDGETS.useGzip).toBe(true);
    });
  });
});

// ===================================================================
// hmr.ts — HMR coordinator and transport
// ===================================================================

describe("hmr.ts", () => {
  describe("classifyChange", () => {
    let coordinator: ReturnType<typeof createHmrCoordinator>;

    beforeEach(() => {
      coordinator = createHmrCoordinator({
        rootDir: "/project",
        routesDir: "/project/app/routes",
      });
    });

    it("classifies .css files as css", () => {
      expect(coordinator.classifyChange("/project/app/styles/main.css")).toBe("css");
    });

    it("classifies .page.tsx inside routes as page", () => {
      expect(coordinator.classifyChange("/project/app/routes/index.page.tsx")).toBe("page");
    });

    it("classifies .page.ts inside routes as page", () => {
      expect(coordinator.classifyChange("/project/app/routes/about.page.ts")).toBe("page");
    });

    it("classifies _layout.tsx inside routes as layout", () => {
      expect(coordinator.classifyChange("/project/app/routes/_layout.tsx")).toBe("layout");
    });

    it("classifies _layout.ts inside routes as layout", () => {
      expect(coordinator.classifyChange("/project/app/routes/_layout.ts")).toBe("layout");
    });

    it("classifies .api.ts inside routes as api", () => {
      expect(coordinator.classifyChange("/project/app/routes/users.api.ts")).toBe("api");
    });

    it("classifies _middleware.ts inside routes as middleware", () => {
      expect(coordinator.classifyChange("/project/app/routes/_middleware.ts")).toBe("middleware");
    });

    it("classifies _loading.tsx inside routes as loading", () => {
      expect(coordinator.classifyChange("/project/app/routes/_loading.tsx")).toBe("loading");
    });

    it("classifies _loading.ts inside routes as loading", () => {
      expect(coordinator.classifyChange("/project/app/routes/_loading.ts")).toBe("loading");
    });

    it("classifies _error.tsx inside routes as error", () => {
      expect(coordinator.classifyChange("/project/app/routes/_error.tsx")).toBe("error");
    });

    it("classifies _error.ts inside routes as error", () => {
      expect(coordinator.classifyChange("/project/app/routes/_error.ts")).toBe("error");
    });

    it("classifies capstan.config.ts as config", () => {
      expect(coordinator.classifyChange("/project/capstan.config.ts")).toBe("config");
    });

    it("classifies capstan.config.js as config", () => {
      expect(coordinator.classifyChange("/project/capstan.config.js")).toBe("config");
    });

    it("classifies unrecognized files as full-reload", () => {
      expect(coordinator.classifyChange("/project/lib/utils.ts")).toBe("full-reload");
    });

    it("classifies empty path as full-reload", () => {
      expect(coordinator.classifyChange("")).toBe("full-reload");
    });

    it("classifies page files outside routes dir as full-reload", () => {
      expect(coordinator.classifyChange("/other/dir/index.page.tsx")).toBe("full-reload");
    });

    it("classifies CSS outside routes dir still as css", () => {
      expect(coordinator.classifyChange("/project/styles/global.css")).toBe("css");
    });

    it("handles Windows-style backslash paths", () => {
      const coord = createHmrCoordinator({
        rootDir: "C:\\project",
        routesDir: "C:\\project\\app\\routes",
      });
      expect(coord.classifyChange("C:\\project\\app\\routes\\index.page.tsx")).toBe("page");
    });

    it("classifies nested route page files correctly", () => {
      expect(coordinator.classifyChange("/project/app/routes/admin/users.page.tsx")).toBe("page");
    });

    it("classifies nested api files correctly", () => {
      expect(coordinator.classifyChange("/project/app/routes/api/users.api.ts")).toBe("api");
    });
  });

  describe("handleFileChange", () => {
    it("returns an HmrUpdate with correct type and timestamp", () => {
      const coordinator = createHmrCoordinator({
        rootDir: "/project",
        routesDir: "/project/app/routes",
      });
      const update = coordinator.handleFileChange("/project/app/routes/index.page.tsx");
      expect(update.type).toBe("page");
      expect(update.filePath).toBe("/project/app/routes/index.page.tsx");
      expect(typeof update.timestamp).toBe("number");
      expect(update.timestamp).toBeGreaterThan(0);
    });

    it("produces monotonically increasing timestamps", () => {
      const coordinator = createHmrCoordinator({
        rootDir: "/project",
        routesDir: "/project/app/routes",
      });
      const t1 = coordinator.handleFileChange("/project/a.css").timestamp;
      const t2 = coordinator.handleFileChange("/project/b.css").timestamp;
      const t3 = coordinator.handleFileChange("/project/c.css").timestamp;
      expect(t2).toBeGreaterThanOrEqual(t1);
      expect(t3).toBeGreaterThanOrEqual(t2);
    });
  });

  describe("createHmrCoordinator", () => {
    it("throws when routesDir is not provided", () => {
      expect(() =>
        createHmrCoordinator({ rootDir: "/project", routesDir: "" }),
      ).toThrow("routesDir is required");
    });

    it("defaults viteActive to true", () => {
      const coordinator = createHmrCoordinator({
        rootDir: "/project",
        routesDir: "/project/routes",
      });
      expect(coordinator.viteActive).toBe(true);
    });

    it("respects enableViteHmr: false", () => {
      const coordinator = createHmrCoordinator({
        rootDir: "/project",
        routesDir: "/project/routes",
        enableViteHmr: false,
      });
      expect(coordinator.viteActive).toBe(false);
    });
  });

  describe("createHmrTransport", () => {
    it("starts with zero clients", () => {
      const transport = createHmrTransport();
      expect(transport.clientCount).toBe(0);
    });

    it("tracks WebSocket connections", () => {
      const transport = createHmrTransport();
      const mockWs = { send: () => {}, close: () => {} };
      transport.handleConnection(mockWs);
      expect(transport.clientCount).toBe(1);
    });

    it("tracks SSE connections and returns dispose function", () => {
      const transport = createHmrTransport();
      const messages: string[] = [];
      const mockRes = {
        write: (data: string) => { messages.push(data); },
        close: () => {},
      };
      const dispose = transport.handleSSEConnection(mockRes);
      expect(transport.clientCount).toBe(1);
      expect(messages.some((m) => m.includes("connected"))).toBe(true);

      dispose();
      expect(transport.clientCount).toBe(0);
    });

    it("broadcasts to WebSocket clients as JSON", () => {
      const transport = createHmrTransport();
      const received: string[] = [];
      transport.handleConnection({
        send: (data: string) => { received.push(data); },
        close: () => {},
      });

      const update: HmrUpdate = {
        type: "css",
        filePath: "/test.css",
        timestamp: Date.now(),
      };
      transport.broadcast(update);
      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0]!)).toEqual(update);
    });

    it("broadcasts to SSE clients with data: prefix", () => {
      const transport = createHmrTransport();
      const received: string[] = [];
      transport.handleSSEConnection({
        write: (data: string) => { received.push(data); },
        close: () => {},
      });

      const update: HmrUpdate = {
        type: "page",
        filePath: "/index.page.tsx",
        timestamp: Date.now(),
      };
      transport.broadcast(update);
      const broadcastMsg = received.find((m) => m.startsWith("data:"));
      expect(broadcastMsg).toBeDefined();
      expect(broadcastMsg).toContain(JSON.stringify(update));
    });

    it("does not broadcast after dispose", () => {
      const transport = createHmrTransport();
      const received: string[] = [];
      transport.handleConnection({
        send: (data: string) => { received.push(data); },
        close: () => {},
      });
      transport.dispose();

      transport.broadcast({
        type: "css",
        filePath: "/test.css",
        timestamp: Date.now(),
      });
      expect(received).toHaveLength(0);
    });

    it("removes disconnected clients on broadcast error", () => {
      const transport = createHmrTransport();
      transport.handleConnection({
        send: () => { throw new Error("disconnected"); },
        close: () => {},
      });
      expect(transport.clientCount).toBe(1);

      transport.broadcast({
        type: "css",
        filePath: "/test.css",
        timestamp: Date.now(),
      });
      expect(transport.clientCount).toBe(0);
    });

    it("does not add clients after dispose", () => {
      const transport = createHmrTransport();
      transport.dispose();
      transport.handleConnection({ send: () => {}, close: () => {} });
      expect(transport.clientCount).toBe(0);
    });
  });
});

// ===================================================================
// loader.ts — Module loading utilities
// ===================================================================

describe("loader.ts", () => {
  describe("virtual route modules", () => {
    beforeEach(() => {
      clearVirtualRouteModules();
    });

    it("registerVirtualRouteModule makes module available to loadRouteModule", async () => {
      const mod = { default: () => "hello", GET: { handler: () => ({}) } };
      registerVirtualRouteModule("/virtual/test.ts", mod);
      const loaded = await loadRouteModule("/virtual/test.ts");
      expect(loaded).toBe(mod);
    });

    it("registerVirtualRouteModules registers multiple modules at once", async () => {
      const modA = { default: "a" };
      const modB = { default: "b" };
      registerVirtualRouteModules({
        "/virtual/a.ts": modA,
        "/virtual/b.ts": modB,
      });
      expect(await loadRouteModule("/virtual/a.ts")).toBe(modA);
      expect(await loadRouteModule("/virtual/b.ts")).toBe(modB);
    });

    it("clearVirtualRouteModules clears all when called without argument", async () => {
      registerVirtualRouteModule("/virtual/x.ts", { default: "x" });
      clearVirtualRouteModules();
      await expect(loadRouteModule("/virtual/x.ts")).rejects.toThrow();
    });

    it("clearVirtualRouteModules with path clears only that module", async () => {
      const modA = { default: "a" };
      const modB = { default: "b" };
      registerVirtualRouteModule("/virtual/a.ts", modA);
      registerVirtualRouteModule("/virtual/b.ts", modB);
      clearVirtualRouteModules("/virtual/a.ts");
      expect(await loadRouteModule("/virtual/b.ts")).toBe(modB);
      await expect(loadRouteModule("/virtual/a.ts")).rejects.toThrow();
    });
  });

  describe("invalidateModuleCache", () => {
    it("does not throw when called with a path", () => {
      expect(() => invalidateModuleCache("/some/path.ts")).not.toThrow();
    });

    it("does not throw when called without arguments (clears all)", () => {
      expect(() => invalidateModuleCache()).not.toThrow();
    });
  });
});

// ===================================================================
// page-fetch.ts — Page fetch client helpers
// ===================================================================

describe("page-fetch.ts", () => {
  describe("PageFetchError", () => {
    it("stores method, url, and phase", () => {
      const err = new PageFetchError("test error", {
        method: "GET",
        url: "http://localhost/api/test",
        phase: "request",
      });
      expect(err.name).toBe("PageFetchError");
      expect(err.method).toBe("GET");
      expect(err.url).toBe("http://localhost/api/test");
      expect(err.phase).toBe("request");
      expect(err.message).toBe("test error");
    });

    it("stores optional status and body", () => {
      const err = new PageFetchError("not found", {
        method: "POST",
        url: "http://localhost/api/users",
        phase: "response",
        status: 404,
        statusText: "Not Found",
        body: { error: "user not found" },
      });
      expect(err.status).toBe(404);
      expect(err.statusText).toBe("Not Found");
      expect(err.body).toEqual({ error: "user not found" });
    });

    it("includes cause when provided", () => {
      const cause = new Error("network failure");
      const err = new PageFetchError("fetch failed", {
        method: "GET",
        url: "http://localhost/test",
        phase: "request",
      }, cause);
      expect(err.cause).toBe(cause);
    });

    it("is an instance of Error", () => {
      const err = new PageFetchError("test", {
        method: "GET",
        url: "/",
        phase: "request",
      });
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("createPageFetch", () => {
    it("returns an object with get, post, put, delete methods", () => {
      const request = new Request("http://localhost:3000/");
      const client = createPageFetch(request);
      expect(typeof client.get).toBe("function");
      expect(typeof client.post).toBe("function");
      expect(typeof client.put).toBe("function");
      expect(typeof client.delete).toBe("function");
    });

    it("uses custom fetchImpl when provided", async () => {
      const request = new Request("http://localhost:3000/page");
      const mockFetch = async (req: Request): Promise<Response> => {
        return new Response(JSON.stringify({ data: "mock" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      const result = await client.get<{ data: string }>("/api/data");
      expect(result).toEqual({ data: "mock" });
    });

    it("forwards specified headers", async () => {
      const request = new Request("http://localhost:3000/page", {
        headers: {
          authorization: "Bearer test-token",
          cookie: "session=abc",
        },
      });

      let capturedHeaders: Headers | null = null;
      const mockFetch = async (req: Request): Promise<Response> => {
        capturedHeaders = req.headers;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      await client.get("/api/test");

      expect(capturedHeaders).not.toBeNull();
      expect(capturedHeaders!.get("authorization")).toBe("Bearer test-token");
      expect(capturedHeaders!.get("cookie")).toBe("session=abc");
    });

    it("sets internal fetch headers", async () => {
      const request = new Request("http://localhost:3000/page");
      let capturedHeaders: Headers | null = null;
      const mockFetch = async (req: Request): Promise<Response> => {
        capturedHeaders = req.headers;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      await client.get("/api/test");

      expect(capturedHeaders!.get("x-capstan-internal-fetch")).toBe("1");
      expect(capturedHeaders!.get("x-capstan-internal-depth")).toBe("1");
    });

    it("throws PageFetchError on HTTP error response", async () => {
      const request = new Request("http://localhost:3000/page");
      const mockFetch = async (): Promise<Response> => {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      await expect(client.get("/api/missing")).rejects.toThrow(PageFetchError);
    });

    it("throws on recursion limit", async () => {
      const request = new Request("http://localhost:3000/page", {
        headers: { "x-capstan-internal-depth": "8" },
      });
      const mockFetch = async (): Promise<Response> => {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      await expect(client.get("/api/test")).rejects.toThrow("recursion limit");
    });

    it("POST sends body as JSON for objects", async () => {
      const request = new Request("http://localhost:3000/page");
      let capturedBody: string | null = null;
      let capturedContentType: string | null = null;

      const mockFetch = async (req: Request): Promise<Response> => {
        capturedBody = await req.text();
        capturedContentType = req.headers.get("content-type");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      await client.post("/api/users", { name: "Alice" });

      expect(capturedBody).toBe(JSON.stringify({ name: "Alice" }));
      expect(capturedContentType).toContain("application/json");
    });

    it("DELETE sends request with DELETE method", async () => {
      const request = new Request("http://localhost:3000/page");
      let capturedMethod: string | null = null;

      const mockFetch = async (req: Request): Promise<Response> => {
        capturedMethod = req.method;
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      await client.delete("/api/users/1");

      expect(capturedMethod).toBe("DELETE");
    });

    it("GET appends query params to URL", async () => {
      const request = new Request("http://localhost:3000/page");
      let capturedUrl: string | null = null;

      const mockFetch = async (req: Request): Promise<Response> => {
        capturedUrl = req.url;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      await client.get("/api/search", { q: "test", page: "1" });

      expect(capturedUrl).toContain("q=test");
      expect(capturedUrl).toContain("page=1");
    });

    it("handles 204 response (no body)", async () => {
      const request = new Request("http://localhost:3000/page");
      const mockFetch = async (): Promise<Response> => {
        return new Response(null, { status: 204 });
      };

      const client = createPageFetch(request, { fetchImpl: mockFetch });
      const result = await client.delete("/api/users/1");
      expect(result).toBeUndefined();
    });
  });
});

// ===================================================================
// page-fetch-cache.ts — Page fetch caching
// ===================================================================

describe("page-fetch-cache.ts", () => {
  describe("PageFetchRequestCache", () => {
    it("starts empty", () => {
      const cache = new PageFetchRequestCache();
      expect(cache.has("key")).toBe(false);
      expect(cache.get("key")).toBeUndefined();
    });

    it("set and get work", () => {
      const cache = new PageFetchRequestCache();
      cache.set("key", { data: 42 });
      expect(cache.has("key")).toBe(true);
      expect(cache.get("key")).toEqual({ data: 42 });
    });

    it("clear removes all entries", () => {
      const cache = new PageFetchRequestCache();
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(false);
    });

    it("dedupe returns same promise for concurrent calls", async () => {
      const cache = new PageFetchRequestCache();
      let callCount = 0;
      const execute = async () => {
        callCount++;
        return { value: "result", cacheable: true };
      };

      const [a, b] = await Promise.all([
        cache.dedupe("key", execute),
        cache.dedupe("key", execute),
      ]);

      expect(a).toBe("result");
      expect(b).toBe("result");
      expect(callCount).toBe(1);
    });

    it("dedupe caches result when cacheable is true", async () => {
      const cache = new PageFetchRequestCache();
      await cache.dedupe("key", async () => ({ value: 42, cacheable: true }));
      expect(cache.has("key")).toBe(true);
      expect(cache.get("key")).toBe(42);
    });

    it("dedupe does not cache when cacheable is false", async () => {
      const cache = new PageFetchRequestCache();
      await cache.dedupe("key", async () => ({ value: 42, cacheable: false }));
      expect(cache.has("key")).toBe(false);
    });
  });

  describe("createPageFetchCacheKey", () => {
    it("creates key from method and URL", () => {
      const key = createPageFetchCacheKey("GET", "http://localhost/api", new Headers());
      expect(key).toBe("GET http://localhost/api");
    });

    it("includes headers in key when present", () => {
      const headers = new Headers({ authorization: "Bearer token" });
      const key = createPageFetchCacheKey("GET", "http://localhost/api", headers);
      expect(key).toContain("GET http://localhost/api");
      expect(key).toContain("authorization:Bearer token");
    });

    it("produces different keys for different URLs", () => {
      const h = new Headers();
      const k1 = createPageFetchCacheKey("GET", "http://localhost/a", h);
      const k2 = createPageFetchCacheKey("GET", "http://localhost/b", h);
      expect(k1).not.toBe(k2);
    });
  });

  describe("shouldCacheFetchResponse", () => {
    it("returns true for a normal 200 response", () => {
      const res = new Response("ok", { status: 200 });
      expect(shouldCacheFetchResponse(res)).toBe(true);
    });

    it("returns false for non-ok status", () => {
      const res = new Response("error", { status: 500 });
      expect(shouldCacheFetchResponse(res)).toBe(false);
    });

    it("returns false when cache-control includes no-store", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
      expect(shouldCacheFetchResponse(res)).toBe(false);
    });

    it("returns false when cache-control includes no-cache", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "no-cache" },
      });
      expect(shouldCacheFetchResponse(res)).toBe(false);
    });

    it("returns false when cache-control includes private", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "private" },
      });
      expect(shouldCacheFetchResponse(res)).toBe(false);
    });

    it("returns false when vary is *", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { vary: "*" },
      });
      expect(shouldCacheFetchResponse(res)).toBe(false);
    });

    it("returns true when cache-control is public, max-age=60", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "public, max-age=60" },
      });
      expect(shouldCacheFetchResponse(res)).toBe(true);
    });
  });

  describe("resolveSharedPageFetchCachePolicy", () => {
    it("returns not cacheable for no-store response", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
      const policy = resolveSharedPageFetchCachePolicy("http://localhost/api", res);
      expect(policy.cacheable).toBe(false);
    });

    it("returns cacheable with ttl from max-age", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "public, max-age=300" },
      });
      const policy = resolveSharedPageFetchCachePolicy("http://localhost/api", res);
      expect(policy.cacheable).toBe(true);
      expect(policy.ttl).toBe(300);
    });

    it("prefers s-maxage over max-age for ttl", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "public, max-age=60, s-maxage=300" },
      });
      const policy = resolveSharedPageFetchCachePolicy("http://localhost/api", res);
      expect(policy.ttl).toBe(300);
    });

    it("includes path tag derived from URL", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "public, max-age=60" },
      });
      const policy = resolveSharedPageFetchCachePolicy("http://localhost/api/users", res);
      expect(policy.tags).toContain("path:/api/users");
    });

    it("not cacheable when no ttl or revalidate", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "public" },
      });
      const policy = resolveSharedPageFetchCachePolicy("http://localhost/api", res);
      expect(policy.cacheable).toBe(false);
    });

    it("extracts revalidate from stale-while-revalidate", () => {
      const res = new Response("ok", {
        status: 200,
        headers: { "cache-control": "public, max-age=60, stale-while-revalidate=120" },
      });
      const policy = resolveSharedPageFetchCachePolicy("http://localhost/api", res);
      expect(policy.cacheable).toBe(true);
      expect(policy.revalidate).toBe(120);
    });
  });
});

// ===================================================================
// runtime-diagnostics.ts — Diagnostic helpers
// ===================================================================

describe("runtime-diagnostics.ts", () => {
  describe("createRuntimeDiagnostic", () => {
    it("creates a diagnostic with severity, code, and message", () => {
      const d = createRuntimeDiagnostic("error", "test.code", "Something broke");
      expect(d.severity).toBe("error");
      expect(d.code).toBe("test.code");
      expect(d.message).toBe("Something broke");
      expect(d.data).toBeUndefined();
    });

    it("includes data when provided", () => {
      const d = createRuntimeDiagnostic("info", "test", "msg", { key: "val" });
      expect(d.data).toEqual({ key: "val" });
    });
  });

  describe("mergeRuntimeDiagnostics", () => {
    it("merges multiple arrays", () => {
      const a = [createRuntimeDiagnostic("info", "a", "A")];
      const b = [createRuntimeDiagnostic("warn", "b", "B")];
      const merged = mergeRuntimeDiagnostics(a, b);
      expect(merged).toHaveLength(2);
    });

    it("handles undefined groups", () => {
      const a = [createRuntimeDiagnostic("info", "a", "A")];
      const merged = mergeRuntimeDiagnostics(a, undefined, undefined);
      expect(merged).toHaveLength(1);
    });

    it("returns empty array when all groups are undefined", () => {
      const merged = mergeRuntimeDiagnostics(undefined, undefined);
      expect(merged).toHaveLength(0);
    });
  });

  describe("serializeRuntimeDiagnostics", () => {
    it("returns undefined for empty array", () => {
      expect(serializeRuntimeDiagnostics([])).toBeUndefined();
    });

    it("returns JSON string for non-empty array", () => {
      const d = [createRuntimeDiagnostic("info", "test", "msg")];
      const serialized = serializeRuntimeDiagnostics(d);
      expect(serialized).toBeDefined();
      expect(JSON.parse(serialized!)).toEqual(d);
    });
  });

  describe("runtimeDiagnosticsHeaders", () => {
    it("returns empty object for empty diagnostics", () => {
      const headers = runtimeDiagnosticsHeaders([]);
      expect(headers).toEqual({});
    });

    it("returns x-capstan-diagnostics header for non-empty diagnostics", () => {
      const d = [createRuntimeDiagnostic("info", "test", "msg")];
      const headers = runtimeDiagnosticsHeaders(d);
      expect(headers["x-capstan-diagnostics"]).toBeDefined();
    });
  });

  describe("createRouteRuntimeDiagnostics", () => {
    it("produces info diagnostic for scanned component type", () => {
      const diagnostics = createRouteRuntimeDiagnostics({
        urlPattern: "/",
        filePath: "index.page.tsx",
        routeType: "page",
        routeComponentType: "server",
        hasDefaultExport: true,
      });
      const scanned = diagnostics.find((d) => d.code === "route.component-type.scanned");
      expect(scanned).toBeDefined();
      expect(scanned!.severity).toBe("info");
    });

    it("produces error diagnostic for missing default export", () => {
      const diagnostics = createRouteRuntimeDiagnostics({
        urlPattern: "/missing",
        filePath: "missing.page.tsx",
        routeType: "page",
        hasDefaultExport: false,
      });
      const missing = diagnostics.find((d) => d.code === "route.page.missing-default");
      expect(missing).toBeDefined();
      expect(missing!.severity).toBe("error");
    });

    it("produces warn diagnostic for component type mismatch", () => {
      const diagnostics = createRouteRuntimeDiagnostics({
        urlPattern: "/mismatch",
        filePath: "mismatch.page.tsx",
        routeType: "page",
        routeComponentType: "server",
        moduleComponentType: "client",
        hasDefaultExport: true,
      });
      const mismatch = diagnostics.find((d) => d.code === "route.component-type.mismatch");
      expect(mismatch).toBeDefined();
      expect(mismatch!.severity).toBe("warn");
    });

    it("does not produce mismatch diagnostic when types match", () => {
      const diagnostics = createRouteRuntimeDiagnostics({
        urlPattern: "/match",
        filePath: "match.page.tsx",
        routeType: "page",
        routeComponentType: "server",
        moduleComponentType: "server",
        hasDefaultExport: true,
      });
      const mismatch = diagnostics.find((d) => d.code === "route.component-type.mismatch");
      expect(mismatch).toBeUndefined();
    });

    it("does not produce missing-default for non-page routes", () => {
      const diagnostics = createRouteRuntimeDiagnostics({
        urlPattern: "/api/test",
        filePath: "test.api.ts",
        routeType: "api",
        hasDefaultExport: false,
      });
      const missing = diagnostics.find((d) => d.code === "route.page.missing-default");
      expect(missing).toBeUndefined();
    });
  });

  describe("createPageRuntimeDiagnostics", () => {
    it("includes a page-runtime.request diagnostic", () => {
      const diagnostics = createPageRuntimeDiagnostics({
        requestUrl: "http://localhost:3000/",
        renderMode: "ssr",
        effectiveRenderMode: "ssr",
        transport: "html",
        componentType: "server",
        isNavigationRequest: false,
        statusCode: 200,
      });
      const requestDiag = diagnostics.find((d) => d.code === "page-runtime.request");
      expect(requestDiag).toBeDefined();
    });

    it("includes render mode fallback diagnostic when modes differ", () => {
      const diagnostics = createPageRuntimeDiagnostics({
        requestUrl: "http://localhost:3000/",
        renderMode: "ssg",
        effectiveRenderMode: "ssr",
        transport: "html",
        componentType: "server",
        isNavigationRequest: false,
        statusCode: 200,
      });
      const fallback = diagnostics.find((d) => d.code === "page-runtime.render-mode-fallback");
      expect(fallback).toBeDefined();
    });

    it("includes cache diagnostic when cacheStatus provided", () => {
      const diagnostics = createPageRuntimeDiagnostics({
        requestUrl: "http://localhost:3000/",
        renderMode: "isr",
        effectiveRenderMode: "isr",
        transport: "html",
        componentType: "server",
        isNavigationRequest: false,
        statusCode: 200,
        cacheStatus: "HIT",
      });
      const cacheDiag = diagnostics.find((d) => d.code === "page-runtime.cache");
      expect(cacheDiag).toBeDefined();
      expect(cacheDiag!.data!.cacheStatus).toBe("HIT");
    });

    it("preserves route diagnostics passed in", () => {
      const routeDiags = [createRuntimeDiagnostic("info", "route.test", "test")];
      const diagnostics = createPageRuntimeDiagnostics(
        {
          requestUrl: "http://localhost:3000/",
          renderMode: "ssr",
          effectiveRenderMode: "ssr",
          transport: "html",
          componentType: "server",
          isNavigationRequest: false,
          statusCode: 200,
        },
        routeDiags,
      );
      const found = diagnostics.find((d) => d.code === "route.test");
      expect(found).toBeDefined();
    });
  });
});

// ===================================================================
// ops-sink.ts — Ops config resolution
// ===================================================================

describe("ops-sink.ts", () => {
  describe("resolveProjectOpsConfig", () => {
    it("returns config with enabled: false when disabled", () => {
      const result = resolveProjectOpsConfig(
        { enabled: false },
        { rootDir: "/tmp" },
      );
      expect(result).toBeDefined();
      expect(result!.enabled).toBe(false);
    });

    it("propagates appName from options when base is disabled", () => {
      const result = resolveProjectOpsConfig(
        { enabled: false },
        { rootDir: "/tmp", appName: "test-app" },
      );
      expect(result).toBeDefined();
    });

    it("preserves existing sink when provided", () => {
      const mockSink = { recordEvent: () => {} };
      const result = resolveProjectOpsConfig(
        { sink: mockSink } as any,
        { rootDir: "/tmp" },
      );
      expect(result).toBeDefined();
      expect((result as any).sink).toBe(mockSink);
    });
  });
});

// ===================================================================
// adapter-node.ts — Node.js adapter helpers
// ===================================================================

describe("adapter-node.ts", () => {
  describe("notifyLiveReloadClients", () => {
    it("does not throw when there are no clients", () => {
      expect(() => notifyLiveReloadClients()).not.toThrow();
    });
  });

  describe("closeLiveReloadClients", () => {
    it("does not throw when there are no clients", () => {
      expect(() => closeLiveReloadClients()).not.toThrow();
    });
  });

  describe("WebSocket route registry", () => {
    beforeEach(() => {
      clearWSRoutes();
    });

    it("registerWSRoute does not throw", () => {
      expect(() =>
        registerWSRoute({
          path: "/ws",
          handler: {},
        }),
      ).not.toThrow();
    });

    it("clearWSRoutes does not throw", () => {
      registerWSRoute({ path: "/ws", handler: {} });
      expect(() => clearWSRoutes()).not.toThrow();
    });
  });

  describe("createNodeAdapter", () => {
    it("returns an adapter with listen method", () => {
      const adapter = createNodeAdapter();
      expect(typeof adapter.listen).toBe("function");
    });

    it("accepts custom maxBodySize option", () => {
      const adapter = createNodeAdapter({ maxBodySize: 2_000_000 });
      expect(typeof adapter.listen).toBe("function");
    });
  });
});

// ===================================================================
// runtime.ts — Portable runtime app builder
// ===================================================================

describe("runtime.ts — buildPortableRuntimeApp", () => {
  it("builds an app with zero routes", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
    });
    expect(result.app).toBeDefined();
    expect(result.apiRouteCount).toBe(0);
    expect(result.pageRouteCount).toBe(0);
    expect(result.routeRegistry).toEqual([]);
  });

  it("health endpoint returns ok", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
      appName: "test-app",
    });
    const response = await result.app.fetch(
      new Request("http://localhost/health"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("capstan.json manifest includes app name", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
      appName: "my-app",
      appDescription: "My application",
    });
    const response = await result.app.fetch(
      new Request("http://localhost/.well-known/capstan.json"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; description: string };
    expect(body.name).toBe("my-app");
    expect(body.description).toBe("My application");
  });

  it("openapi.json returns valid spec", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
      appName: "test-app",
    });
    const response = await result.app.fetch(
      new Request("http://localhost/openapi.json"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("test-app");
  });

  it("registers API route handlers from route modules", async () => {
    const routeModules = {
      "/tmp/app/routes/hello.api.ts": {
        GET: {
          description: "Say hello",
          capability: "read",
          handler: async () => ({ greeting: "hello" }),
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/hello.api.ts",
            urlPattern: "/hello",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
    });

    expect(result.apiRouteCount).toBe(1);
    expect(result.routeRegistry.length).toBe(1);
    expect(result.routeRegistry[0]!.method).toBe("GET");
    expect(result.routeRegistry[0]!.path).toBe("/hello");

    const response = await result.app.fetch(
      new Request("http://localhost/hello"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { greeting: string };
    expect(body.greeting).toBe("hello");
  });

  it("registers multiple HTTP methods for one API route", async () => {
    const routeModules = {
      "/tmp/app/routes/items.api.ts": {
        GET: {
          description: "List items",
          capability: "read",
          handler: async () => ({ items: [] }),
        },
        POST: {
          description: "Create item",
          capability: "write",
          handler: async ({ input }: { input: unknown }) => ({ created: true }),
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/items.api.ts",
            urlPattern: "/items",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
    });

    expect(result.apiRouteCount).toBe(2);
    expect(result.routeRegistry.length).toBe(2);
  });

  it("includes API route in agent manifest capabilities", async () => {
    const routeModules = {
      "/tmp/app/routes/users.api.ts": {
        GET: {
          description: "List users",
          capability: "read",
          handler: async () => [],
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/users.api.ts",
            urlPattern: "/users",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
    });

    const response = await result.app.fetch(
      new Request("http://localhost/.well-known/capstan.json"),
    );
    const body = (await response.json()) as {
      capabilities: Array<{
        key: string;
        title: string;
        mode: string;
        endpoint: { method: string; path: string };
      }>;
    };
    expect(body.capabilities.length).toBe(1);
    expect(body.capabilities[0]!.endpoint.method).toBe("GET");
    expect(body.capabilities[0]!.endpoint.path).toBe("/users");
    expect(body.capabilities[0]!.mode).toBe("read");
  });

  it("includes API routes in openapi.json paths", async () => {
    const routeModules = {
      "/tmp/app/routes/users.api.ts": {
        GET: {
          description: "List users",
          handler: async () => [],
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/users.api.ts",
            urlPattern: "/users",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
    });

    const response = await result.app.fetch(
      new Request("http://localhost/openapi.json"),
    );
    const body = (await response.json()) as { paths: Record<string, unknown> };
    expect(body.paths["/users"]).toBeDefined();
  });

  it("returns 400 for validation errors in API handlers", async () => {
    const routeModules = {
      "/tmp/app/routes/validate.api.ts": {
        POST: {
          description: "Validate",
          handler: async () => {
            const err = new Error("Validation");
            (err as Error & { issues: unknown[] }).issues = [
              { path: "name", message: "required" },
            ];
            throw err;
          },
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/validate.api.ts",
            urlPattern: "/validate",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
    });

    const response = await result.app.fetch(
      new Request("http://localhost/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("Validation Error");
    expect(body.issues).toHaveLength(1);
  });

  it("returns 500 for unhandled errors in API handlers", async () => {
    const routeModules = {
      "/tmp/app/routes/crash.api.ts": {
        GET: {
          description: "Crash",
          handler: async () => {
            throw new Error("unexpected");
          },
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/crash.api.ts",
            urlPattern: "/crash",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
    });

    const response = await result.app.fetch(
      new Request("http://localhost/crash"),
    );
    expect(response.status).toBe(500);
  });

  it("serves /_capstan/client.js bootstrap script", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
    });
    const response = await result.app.fetch(
      new Request("http://localhost/_capstan/client.js"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const body = await response.text();
    expect(body).toContain("bootstrapClient");
  });

  it("MCP discovery returns tool list", async () => {
    const routeModules = {
      "/tmp/app/routes/hello.api.ts": {
        GET: {
          description: "Say hello",
          handler: async () => ({ greeting: "hello" }),
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/hello.api.ts",
            urlPattern: "/hello",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
      appName: "mcp-test",
    });

    const response = await result.app.fetch(
      new Request("http://localhost/.well-known/mcp", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { protocol: string; name: string; tools: unknown[] };
    expect(body.protocol).toBe("mcp");
    expect(body.name).toBe("mcp-test");
  });

  it("uses custom agentManifest when provided", async () => {
    const customManifest = { capstan: "1.0", name: "custom", capabilities: [] };
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
      agentManifest: customManifest,
    });

    const response = await result.app.fetch(
      new Request("http://localhost/.well-known/capstan.json"),
    );
    const body = await response.json();
    expect(body).toEqual(customManifest);
  });

  it("uses custom openApiSpec when provided", async () => {
    const customSpec = { openapi: "3.1.0", info: { title: "custom" }, paths: {} };
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
      openApiSpec: customSpec,
    });

    const response = await result.app.fetch(
      new Request("http://localhost/openapi.json"),
    );
    const body = await response.json();
    expect(body).toEqual(customSpec);
  });

  it("handles function-style API handlers (non-APIDefinition)", async () => {
    const routeModules = {
      "/tmp/app/routes/fn.api.ts": {
        GET: async ({ input, ctx, params }: { input: unknown; ctx: unknown; params: Record<string, string> }) => {
          return { result: "from-function" };
        },
      },
    };

    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/fn.api.ts",
            urlPattern: "/fn",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules,
    });

    const response = await result.app.fetch(
      new Request("http://localhost/fn"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: string };
    expect(body.result).toBe("from-function");
  });

  it("skips API routes that fail to load", async () => {
    // Route manifest references a module that doesn't exist in routeModules
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: {
        routes: [
          {
            type: "api" as const,
            filePath: "app/routes/missing.api.ts",
            urlPattern: "/missing",
            params: [],
            layouts: [],
            middlewares: [],
          },
        ],
      },
      routeModules: {},
    });

    expect(result.apiRouteCount).toBe(0);
  });
});

// ===================================================================
// page-runtime.ts — Page runtime
// ===================================================================

describe("page-runtime.ts", () => {
  it("throws TypeError when page module has no default export", async () => {
    await expect(
      runPageRuntime({
        pageModule: {} as any,
        layouts: [],
        params: {},
        request: new Request("http://localhost/"),
        loaderArgs: {
          params: {},
          request: new Request("http://localhost/"),
          ctx: { auth: { isAuthenticated: false } as any },
          fetch: {} as any,
        },
      }),
    ).rejects.toThrow(TypeError);
  });

  it("throws with descriptive message about default component", async () => {
    await expect(
      runPageRuntime({
        pageModule: { loader: () => ({}) } as any,
        layouts: [],
        params: {},
        request: new Request("http://localhost/"),
        loaderArgs: {
          params: {},
          request: new Request("http://localhost/"),
          ctx: { auth: { isAuthenticated: false } as any },
          fetch: {} as any,
        },
      }),
    ).rejects.toThrow("default React component");
  });
});
