import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderPage } from "../packages/react/src/ssr.js";
import type { LayoutModule, LoaderArgs, PageModule } from "../packages/react/src/types.js";
import { Outlet } from "../packages/react/src/layout.js";
import { runPageRuntime } from "../packages/dev/src/page-runtime.js";
import { createRouteScanCache, scanRoutes } from "../packages/router/src/scanner.js";
import { matchRoute } from "../packages/router/src/matcher.js";
import type { BenchmarkScenario } from "./harness.js";
import {
  createRuntimeBenchmarkFixture,
  createSuperComplexRouteManifest,
  createSuperComplexRoutesFixture,
  createSuperComplexRuntimeBenchmarkFixture,
  createSyntheticRouteManifest,
  createSyntheticRoutesFixture,
} from "./fixtures.js";

function createLoaderArgs(request: Request): LoaderArgs {
  return {
    params: {},
    request,
    ctx: {
      auth: {
        isAuthenticated: false,
        type: "anonymous",
      },
    },
    fetch: {
      get: async () => null,
      post: async () => null,
      put: async () => null,
      delete: async () => null,
    },
  };
}

function createLayout(label: string, metadata?: unknown): LayoutModule {
  return {
    default: ({ children }) =>
      createElement(
        "section",
        { "data-layout": label },
        createElement("header", null, label),
        children ?? null,
        createElement(Outlet, null),
      ),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function createPageModule(overrides?: Partial<PageModule> & { metadata?: unknown }): PageModule & { metadata?: unknown } {
  return {
    default: () => createElement("main", null, "benchmark page"),
    ...overrides,
  };
}

export function createBenchmarkScenarios(): BenchmarkScenario[] {
  return [
    {
      id: "react.render.minimal-ssr",
      description: "renderPage() hot path for a minimal server-rendered page",
      group: "react",
      iterations: 220,
      samples: 9,
      run: async () => {
        const request = new Request("http://localhost/");
        await renderPage({
          pageModule: createPageModule(),
          layouts: [],
          params: {},
          request,
          loaderArgs: createLoaderArgs(request),
        });
      },
    },
    {
      id: "react.render.metadata-layouts",
      description: "renderPage() with nested layouts and merged metadata",
      group: "react",
      iterations: 180,
      samples: 9,
      run: async () => {
        const request = new Request("http://localhost/dashboard");
        await renderPage({
          pageModule: createPageModule({
            metadata: {
              title: "Dashboard",
              openGraph: { siteName: "Capstan" },
            },
          }),
          layouts: [
            createLayout("root", {
              title: { default: "Workspace", template: "%s | Capstan" },
            }),
            createLayout("dashboard", {
              description: "Dashboard overview",
            }),
          ],
          params: {},
          request,
          loaderArgs: createLoaderArgs(request),
        });
      },
    },
    {
      id: "dev.page-runtime.document",
      description: "runPageRuntime() full document render",
      group: "runtime",
      iterations: 180,
      samples: 9,
      run: async () => {
        const request = new Request("http://localhost/billing");
        await runPageRuntime({
          pageModule: createPageModule({
            metadata: {
              title: "Billing",
            },
          }),
          layouts: [
            createLayout("root", {
              title: { default: "Workspace", template: "%s | Capstan" },
            }),
            createLayout("billing", {
              description: "Billing center",
            }),
          ],
          layoutKeys: ["/_layout.tsx", "/billing/_layout.tsx"],
          metadataChain: [
            { canonical: "https://example.com/billing" },
            { robots: { index: false, follow: true } },
          ],
          params: {},
          request,
          loaderArgs: createLoaderArgs(request),
        });
      },
    },
    {
      id: "dev.page-runtime.navigation-client",
      description: "runPageRuntime() client navigation payload",
      group: "runtime",
      iterations: 260,
      samples: 9,
      run: async () => {
        const request = new Request("http://localhost/client", {
          headers: { "X-Capstan-Nav": "1" },
        });
        await runPageRuntime({
          pageModule: createPageModule({
            componentType: "client",
            loader: async () => ({ ready: true }),
            metadata: { title: "Client page" },
          }),
          layouts: [],
          params: {},
          request,
          loaderArgs: createLoaderArgs(request),
        });
      },
    },
    {
      id: "router.scan.synthetic-app",
      description: "scanRoutes() against a synthetic mid-sized app tree",
      group: "router",
      iterations: 6,
      samples: 7,
      warmupSamples: 1,
      setup: async () => createSyntheticRoutesFixture(),
      run: async (fixture) => {
        await scanRoutes(fixture.routesDir);
      },
      teardown: async (fixture) => {
        await fixture.cleanup();
      },
    },
    {
      id: "router.scan.super-complex-app",
      description: "scanRoutes() against a route tree with deep groups, layouts, and dynamic segments",
      group: "router",
      iterations: 3,
      samples: 5,
      warmupSamples: 1,
      setup: async () => createSuperComplexRoutesFixture(),
      run: async (fixture) => {
        await scanRoutes(fixture.routesDir);
      },
      teardown: async (fixture) => {
        await fixture.cleanup();
      },
    },
    {
      id: "router.scan.incremental-super-complex-app",
      description: "scanRoutes() incremental rebuild after a single-route edit in a cached super-complex tree",
      group: "router",
      iterations: 3,
      samples: 5,
      warmupSamples: 1,
      setup: async () => {
        const fixture = await createSuperComplexRoutesFixture();
        const cache = createRouteScanCache();
        const targetFile = join(
          fixture.routesDir,
          "(ops)",
          "(primary-surface)",
          "workspace-7",
          "projects",
          "[projectId]",
          "overview.page.tsx",
        );

        await scanRoutes(fixture.routesDir, { cache });

        return {
          fixture,
          cache,
          targetFile,
          revision: 0,
        };
      },
      beforeIteration: async (state) => {
        state.revision += 1;
        await writeFile(
          state.targetFile,
          [
            `export const revalidate = ${30 + state.revision};`,
            `export const metadata = { title: "Project ${state.revision}" };`,
            "export default function ProjectOverview7() { return null; }",
          ].join("\n"),
          "utf-8",
        );
      },
      run: async (state) => {
        await scanRoutes(state.fixture.routesDir, { cache: state.cache });
      },
      teardown: async (state) => {
        await state.fixture.cleanup();
      },
    },
    {
      id: "router.match.synthetic-app",
      description: "matchRoute() over a synthetic manifest with mixed route types",
      group: "router",
      iterations: 2500,
      samples: 9,
      setup: async () => {
        const { fixture, manifest } = await createSyntheticRouteManifest();
        return {
          fixture,
          manifest,
          paths: [
            "/page-42",
            "/projects-7/alpha",
            "/projects-13/docs/a/b",
            "/projects-21/missing",
          ],
          cursor: 0,
        };
      },
      run: async (state) => {
        const path = state.paths[state.cursor % state.paths.length]!;
        state.cursor++;
        const match = matchRoute(state.manifest, "GET", path);
        if (!match) {
          throw new Error(`Expected a route match for ${path}`);
        }
      },
      teardown: async (state) => {
        await state.fixture.cleanup();
      },
    },
    {
      id: "router.match.super-complex-app",
      description: "matchRoute() over a large manifest with deep static, dynamic, and catch-all routes",
      group: "router",
      iterations: 3000,
      samples: 9,
      setup: async () => {
        const { fixture, manifest } = await createSuperComplexRouteManifest();
        return {
          fixture,
          manifest,
          paths: [
            "/landing-42",
            "/workspace-7/projects/alpha/overview",
            "/workspace-11/projects/beta/activity/9001",
            "/workspace-23/projects/gamma/docs/runbooks/deploy/canary",
            "/workspace-31/projects/delta/releases/42/incidents/77",
            "/workspace-5/teams/ops/members/jane",
          ],
          cursor: 0,
        };
      },
      run: async (state) => {
        const path = state.paths[state.cursor % state.paths.length]!;
        state.cursor++;
        const match = matchRoute(state.manifest, "GET", path);
        if (!match) {
          throw new Error(`Expected a route match for ${path}`);
        }
      },
      teardown: async (state) => {
        await state.fixture.cleanup();
      },
    },
    {
      id: "runtime.request.document",
      description: "buildRuntimeApp() request path for a full HTML page response",
      group: "runtime-app",
      iterations: 180,
      samples: 9,
      setup: async () => createRuntimeBenchmarkFixture(),
      run: async (state) => {
        const response = await state.app.fetch(
          new Request("http://localhost/dashboard", {
            headers: { Accept: "text/html" },
          }),
        );
        const body = await response.text();
        if (response.status !== 200 || !body.includes("<title>Dashboard | Capstan</title>")) {
          throw new Error("Expected a successful dashboard document response.");
        }
      },
      teardown: async (state) => {
        await state.cleanup();
      },
    },
    {
      id: "runtime.request.deep-document",
      description: "buildRuntimeApp() deep HTML request with layout stack, metadata chain, and loader fan-out",
      group: "runtime-app",
      iterations: 120,
      samples: 7,
      setup: async () => createSuperComplexRuntimeBenchmarkFixture(),
      run: async (state) => {
        const response = await state.app.fetch(
          new Request(
            "http://localhost/workspaces/acme/projects/atlas/releases/42/incidents/77",
            {
              headers: { Accept: "text/html" },
            },
          ),
        );
        const body = await response.text();
        if (
          response.status !== 200
          || !body.includes("<title>Incident cockpit | Capstan</title>")
          || !body.includes('content="Capstan Control Plane"')
        ) {
          throw new Error("Expected a successful deep document response.");
        }
      },
      teardown: async (state) => {
        await state.cleanup();
      },
    },
    {
      id: "runtime.request.navigation",
      description: "buildRuntimeApp() request path for SPA navigation payloads",
      group: "runtime-app",
      iterations: 180,
      samples: 9,
      setup: async () => createRuntimeBenchmarkFixture(),
      run: async (state) => {
        const response = await state.app.fetch(
          new Request("http://localhost/dashboard", {
            headers: { "X-Capstan-Nav": "1" },
          }),
        );
        const body = await response.text();
        if (response.status !== 200 || !body.includes("\"url\":\"/dashboard\"")) {
          throw new Error("Expected a successful dashboard navigation payload.");
        }
      },
      teardown: async (state) => {
        await state.cleanup();
      },
    },
    {
      id: "runtime.request.deep-navigation",
      description: "buildRuntimeApp() deep navigation payload with server component HTML and loader data",
      group: "runtime-app",
      iterations: 120,
      samples: 7,
      setup: async () => createSuperComplexRuntimeBenchmarkFixture(),
      run: async (state) => {
        const response = await state.app.fetch(
          new Request(
            "http://localhost/workspaces/acme/projects/atlas/releases/42/incidents/77",
            {
              headers: { "X-Capstan-Nav": "1" },
            },
          ),
        );
        const body = await response.text();
        if (
          response.status !== 200
          || !body.includes("\"url\":\"/workspaces/acme/projects/atlas/releases/42/incidents/77\"")
          || !body.includes("\"severity\":\"high\"")
          || !body.includes("\"slaMinutesRemaining\":37")
        ) {
          throw new Error("Expected a successful deep navigation payload.");
        }
      },
      teardown: async (state) => {
        await state.cleanup();
      },
    },
    {
      id: "runtime.request.not-found",
      description: "buildRuntimeApp() request path for scoped not-found HTML responses",
      group: "runtime-app",
      iterations: 180,
      samples: 9,
      setup: async () => createRuntimeBenchmarkFixture(),
      run: async (state) => {
        const response = await state.app.fetch(
          new Request("http://localhost/dashboard/missing", {
            headers: { Accept: "text/html" },
          }),
        );
        const body = await response.text();
        if (
          response.status !== 404
          || !body.includes("<title>Missing dashboard page | Capstan</title>")
        ) {
          throw new Error("Expected a scoped not-found page response.");
        }
      },
      teardown: async (state) => {
        await state.cleanup();
      },
    },
  ];
}
