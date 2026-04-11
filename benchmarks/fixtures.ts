import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { z } from "zod";
import { defineAPI } from "../packages/core/src/api.js";
import { clearAPIRegistry } from "../packages/core/src/api.js";
import { defineMiddleware } from "../packages/core/src/middleware.js";
import { Outlet } from "../packages/react/src/layout.js";
import { buildRuntimeApp } from "../packages/dev/src/server.js";
import {
  clearVirtualRouteModules,
  registerVirtualRouteModules,
} from "../packages/dev/src/loader.js";
import { scanRoutes } from "../packages/router/src/scanner.js";
import type { RouteManifest } from "../packages/router/src/types.js";

const STATIC_PAGE_COUNT = 160;
const STATIC_API_COUNT = 160;
const SECTION_COUNT = 24;
const SUPER_STATIC_PAGE_COUNT = 320;
const SUPER_STATIC_API_COUNT = 320;
const SUPER_WORKSPACE_COUNT = 64;

type VirtualRouteModuleMap = Record<string, unknown>;

async function writeFixtureFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

export interface SyntheticRoutesFixture {
  routesDir: string;
  cleanup(): Promise<void>;
}

export async function createSyntheticRoutesFixture(): Promise<SyntheticRoutesFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "capstan-bench-routes-"));
  const routesDir = join(rootDir, "app", "routes");

  await writeFixtureFile(
    join(routesDir, "_layout.tsx"),
    "export default function RootLayout({ children }) { return children; }\n",
  );
  await writeFixtureFile(
    join(routesDir, "_loading.tsx"),
    "export default function RootLoading() { return null; }\n",
  );
  await writeFixtureFile(
    join(routesDir, "_error.tsx"),
    "export default function RootError() { return null; }\n",
  );
  await writeFixtureFile(
    join(routesDir, "not-found.page.tsx"),
    "export default function RootNotFound() { return null; }\n",
  );

  for (let index = 0; index < STATIC_PAGE_COUNT; index++) {
    await writeFixtureFile(
      join(routesDir, `page-${index}.page.tsx`),
      `export default function Page${index}() { return null; }\n`,
    );
  }

  for (let index = 0; index < STATIC_API_COUNT; index++) {
    await writeFixtureFile(
      join(routesDir, "api", `route-${index}.api.ts`),
      `export const GET = {};\n`,
    );
  }

  for (let index = 0; index < SECTION_COUNT; index++) {
    const sectionDir = join(routesDir, `(workspace-${index})`, `projects-${index}`);

    await writeFixtureFile(
      join(sectionDir, "_layout.tsx"),
      `export default function ProjectLayout${index}({ children }) { return children; }\n`,
    );
    await writeFixtureFile(
      join(sectionDir, "_loading.tsx"),
      `export default function ProjectLoading${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(sectionDir, "_error.tsx"),
      `export default function ProjectError${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(sectionDir, "not-found.page.tsx"),
      `export default function ProjectNotFound${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(sectionDir, "[ticketId].page.tsx"),
      `export default function TicketPage${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(sectionDir, "[ticketId].api.ts"),
      `export const GET = {};\n`,
    );
    await writeFixtureFile(
      join(sectionDir, "[...rest].page.tsx"),
      `export default function CatchAll${index}() { return null; }\n`,
    );
  }

  return {
    routesDir,
    async cleanup() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export async function createSuperComplexRoutesFixture(): Promise<SyntheticRoutesFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "capstan-bench-routes-mega-"));
  const routesDir = join(rootDir, "app", "routes");

  await writeFixtureFile(
    join(routesDir, "_layout.tsx"),
    "export default function RootLayout({ children }) { return children; }\n",
  );
  await writeFixtureFile(
    join(routesDir, "_middleware.ts"),
    "export default function RootMiddleware() { return null; }\n",
  );
  await writeFixtureFile(
    join(routesDir, "_loading.tsx"),
    "export default function RootLoading() { return null; }\n",
  );
  await writeFixtureFile(
    join(routesDir, "_error.tsx"),
    "export default function RootError() { return null; }\n",
  );
  await writeFixtureFile(
    join(routesDir, "not-found.page.tsx"),
    "export default function RootNotFound() { return null; }\n",
  );

  for (let index = 0; index < SUPER_STATIC_PAGE_COUNT; index++) {
    await writeFixtureFile(
      join(routesDir, `landing-${index}.page.tsx`),
      `export default function Landing${index}() { return null; }\n`,
    );
  }

  for (let index = 0; index < SUPER_STATIC_API_COUNT; index++) {
    await writeFixtureFile(
      join(routesDir, "api", `endpoint-${index}.api.ts`),
      "export const GET = {};\n",
    );
  }

  for (let index = 0; index < SUPER_WORKSPACE_COUNT; index++) {
    const workspaceDir = join(
      routesDir,
      "(ops)",
      "(primary-surface)",
      `workspace-${index}`,
    );
    const projectsDir = join(workspaceDir, "projects", "[projectId]");
    const releasesDir = join(projectsDir, "releases", "[releaseId]");

    await writeFixtureFile(
      join(workspaceDir, "_layout.tsx"),
      `export default function WorkspaceLayout${index}({ children }) { return children; }\n`,
    );
    await writeFixtureFile(
      join(workspaceDir, "_middleware.ts"),
      `export default function WorkspaceMiddleware${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(workspaceDir, "_loading.tsx"),
      `export default function WorkspaceLoading${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(workspaceDir, "_error.tsx"),
      `export default function WorkspaceError${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(workspaceDir, "not-found.page.tsx"),
      `export default function WorkspaceNotFound${index}() { return null; }\n`,
    );

    await writeFixtureFile(
      join(projectsDir, "_layout.tsx"),
      `export default function ProjectLayout${index}({ children }) { return children; }\n`,
    );
    await writeFixtureFile(
      join(projectsDir, "_middleware.ts"),
      `export default function ProjectMiddleware${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(projectsDir, "overview.page.tsx"),
      `export default function ProjectOverview${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(projectsDir, "settings.page.tsx"),
      `export default function ProjectSettings${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(projectsDir, "activity", "[activityId].page.tsx"),
      `export default function ProjectActivity${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(projectsDir, "docs", "[...slug].page.tsx"),
      `export default function ProjectDocs${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(projectsDir, "overview.api.ts"),
      "export const GET = {};\n",
    );
    await writeFixtureFile(
      join(projectsDir, "activity", "[activityId].api.ts"),
      "export const GET = {};\n",
    );

    await writeFixtureFile(
      join(releasesDir, "_layout.tsx"),
      `export default function ReleaseLayout${index}({ children }) { return children; }\n`,
    );
    await writeFixtureFile(
      join(releasesDir, "incidents", "[incidentId].page.tsx"),
      `export default function IncidentPage${index}() { return null; }\n`,
    );
    await writeFixtureFile(
      join(releasesDir, "incidents", "[incidentId].api.ts"),
      "export const GET = {};\n",
    );
    await writeFixtureFile(
      join(workspaceDir, "teams", "[teamId]", "members", "[memberId].page.tsx"),
      `export default function TeamMemberPage${index}() { return null; }\n`,
    );
  }

  return {
    routesDir,
    async cleanup() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export interface RuntimeBenchmarkFixture {
  app: Awaited<ReturnType<typeof buildRuntimeApp>>["app"];
  cleanup(): Promise<void>;
}

async function createRegisteredRuntimeBenchmarkFixture(
  manifest: RouteManifest,
  modules: VirtualRouteModuleMap,
): Promise<RuntimeBenchmarkFixture> {
  const previousLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "error";

  clearVirtualRouteModules();
  clearAPIRegistry();
  registerVirtualRouteModules(modules);

  const originalWarn = console.warn;
  console.warn = () => undefined;

  try {
    const { app } = await buildRuntimeApp({
      rootDir: "/virtual",
      manifest,
      mode: "production",
      host: "127.0.0.1",
      port: 3000,
      appName: "capstan-bench",
      appDescription: "Performance fixture",
      publicDir: "/virtual/public",
      staticDir: "/virtual/static",
      liveReload: false,
      unknownPolicyMode: "deny",
    });

    return {
      app,
      async cleanup() {
        clearVirtualRouteModules();
        clearAPIRegistry();
        if (previousLogLevel === undefined) {
          delete process.env.LOG_LEVEL;
        } else {
          process.env.LOG_LEVEL = previousLogLevel;
        }
      },
    };
  } finally {
    console.warn = originalWarn;
  }
}

function buildRuntimeFixtureManifest(): RouteManifest {
  const routesRoot = "/virtual/app/routes";

  return {
    scannedAt: new Date().toISOString(),
    rootDir: routesRoot,
    routes: [
      {
        filePath: `${routesRoot}/dashboard/index.page.tsx`,
        type: "page",
        urlPattern: "/dashboard",
        layouts: [
          `${routesRoot}/_layout.tsx`,
          `${routesRoot}/dashboard/_layout.tsx`,
        ],
        middlewares: [`${routesRoot}/_middleware.ts`],
        params: [],
        isCatchAll: false,
        componentType: "server",
        loading: `${routesRoot}/dashboard/_loading.tsx`,
        error: `${routesRoot}/dashboard/_error.tsx`,
        notFound: `${routesRoot}/dashboard/not-found.page.tsx`,
      },
      {
        filePath: `${routesRoot}/dashboard/not-found.page.tsx`,
        type: "not-found",
        urlPattern: "/dashboard",
        layouts: [
          `${routesRoot}/_layout.tsx`,
          `${routesRoot}/dashboard/_layout.tsx`,
        ],
        middlewares: [`${routesRoot}/_middleware.ts`],
        params: [],
        isCatchAll: false,
        componentType: "server",
      },
      {
        filePath: `${routesRoot}/api/ping.api.ts`,
        type: "api",
        urlPattern: "/api/ping",
        methods: ["GET"],
        layouts: [],
        middlewares: [`${routesRoot}/_middleware.ts`],
        params: [],
        isCatchAll: false,
      },
    ],
  };
}

export async function createRuntimeBenchmarkFixture(): Promise<RuntimeBenchmarkFixture> {
  const routesRoot = "/virtual/app/routes";
  return createRegisteredRuntimeBenchmarkFixture(buildRuntimeFixtureManifest(), {
    [`${routesRoot}/_layout.tsx`]: {
      default: ({ children }: { children?: unknown }) =>
        createElement(
          "div",
          { "data-layout": "root" },
          createElement("header", null, "root"),
          children ?? null,
          createElement(Outlet, null),
        ),
      metadata: {
        title: { default: "Workspace", template: "%s | Capstan" },
      },
    },
    [`${routesRoot}/dashboard/_layout.tsx`]: {
      default: ({ children }: { children?: unknown }) =>
        createElement(
          "section",
          { "data-layout": "dashboard" },
          createElement("h1", null, "dashboard"),
          children ?? null,
          createElement(Outlet, null),
        ),
      metadata: {
        description: "Dashboard overview",
      },
    },
    [`${routesRoot}/dashboard/_loading.tsx`]: {
      default: () => createElement("p", null, "loading"),
    },
    [`${routesRoot}/dashboard/_error.tsx`]: {
      default: () => createElement("p", null, "error"),
    },
    [`${routesRoot}/dashboard/not-found.page.tsx`]: {
      default: () => createElement("main", null, "missing dashboard page"),
      metadata: {
        title: "Missing dashboard page",
      },
    },
    [`${routesRoot}/dashboard/index.page.tsx`]: {
      default: () => createElement("main", null, "dashboard home"),
      metadata: {
        title: "Dashboard",
      },
      loader: async ({ fetch }: { fetch: { get: <T>(path: string) => Promise<T> } }) => {
        return fetch.get("/api/ping");
      },
    },
    [`${routesRoot}/api/ping.api.ts`]: {
      GET: defineAPI({
        capability: "read",
        input: z.object({}).optional(),
        output: z.object({
          ok: z.literal(true),
          source: z.literal("bench"),
        }),
        handler: async () => ({ ok: true, source: "bench" as const }),
      }),
    },
    [`${routesRoot}/_middleware.ts`]: {
      default: defineMiddleware(async ({ next }) => next()),
    },
  });
}

function createBenchmarkLayoutModule(label: string, metadata?: Record<string, unknown>) {
  return {
    default: ({ children }: { children?: unknown }) =>
      createElement(
        "section",
        { "data-layout": label },
        createElement("header", null, label),
        children ?? null,
        createElement(Outlet, null),
      ),
    ...(metadata ? { metadata } : {}),
  };
}

export async function createSyntheticRouteManifest(): Promise<{
  fixture: SyntheticRoutesFixture;
  manifest: RouteManifest;
}> {
  const fixture = await createSyntheticRoutesFixture();
  const manifest = await scanRoutes(fixture.routesDir);
  return { fixture, manifest };
}

function buildSuperComplexRuntimeFixtureManifest(): RouteManifest {
  const routesRoot = "/virtual/mega/routes";
  const groupedRoot = `${routesRoot}/(ops)/(primary)`;
  const workspaceRoot = `${groupedRoot}/workspaces`;
  const workspaceDir = `${workspaceRoot}/[workspaceId]`;
  const projectsDir = `${workspaceDir}/projects`;
  const projectDir = `${projectsDir}/[projectId]`;
  const releasesDir = `${projectDir}/releases`;
  const releaseDir = `${releasesDir}/[releaseId]`;
  const incidentsDir = `${releaseDir}/incidents`;
  const incidentDir = `${incidentsDir}/[incidentId]`;

  return {
    scannedAt: new Date().toISOString(),
    rootDir: routesRoot,
    routes: [
      {
        filePath: `${incidentDir}/index.page.tsx`,
        type: "page",
        urlPattern: "/workspaces/:workspaceId/projects/:projectId/releases/:releaseId/incidents/:incidentId",
        layouts: [
          `${routesRoot}/_layout.tsx`,
          `${routesRoot}/(ops)/_layout.tsx`,
          `${groupedRoot}/_layout.tsx`,
          `${workspaceRoot}/_layout.tsx`,
          `${workspaceDir}/_layout.tsx`,
          `${projectsDir}/_layout.tsx`,
          `${projectDir}/_layout.tsx`,
          `${releasesDir}/_layout.tsx`,
          `${releaseDir}/_layout.tsx`,
          `${incidentsDir}/_layout.tsx`,
        ],
        middlewares: [
          `${routesRoot}/_middleware.ts`,
          `${routesRoot}/(ops)/_middleware.ts`,
          `${workspaceRoot}/_middleware.ts`,
          `${workspaceDir}/_middleware.ts`,
          `${projectDir}/_middleware.ts`,
          `${releaseDir}/_middleware.ts`,
        ],
        params: ["workspaceId", "projectId", "releaseId", "incidentId"],
        isCatchAll: false,
        componentType: "server",
        loading: `${incidentDir}/_loading.tsx`,
        error: `${incidentDir}/_error.tsx`,
        notFound: `${projectDir}/not-found.page.tsx`,
      },
      {
        filePath: `${projectDir}/not-found.page.tsx`,
        type: "not-found",
        urlPattern: "/workspaces/:workspaceId/projects/:projectId",
        layouts: [
          `${routesRoot}/_layout.tsx`,
          `${routesRoot}/(ops)/_layout.tsx`,
          `${groupedRoot}/_layout.tsx`,
          `${workspaceRoot}/_layout.tsx`,
          `${workspaceDir}/_layout.tsx`,
          `${projectsDir}/_layout.tsx`,
          `${projectDir}/_layout.tsx`,
        ],
        middlewares: [
          `${routesRoot}/_middleware.ts`,
          `${routesRoot}/(ops)/_middleware.ts`,
          `${workspaceRoot}/_middleware.ts`,
          `${workspaceDir}/_middleware.ts`,
          `${projectDir}/_middleware.ts`,
        ],
        params: ["workspaceId", "projectId"],
        isCatchAll: false,
        componentType: "server",
      },
      {
        filePath: `${routesRoot}/api/bench/context.api.ts`,
        type: "api",
        urlPattern: "/api/bench/context",
        methods: ["GET"],
        layouts: [],
        middlewares: [`${routesRoot}/_middleware.ts`],
        params: [],
        isCatchAll: false,
      },
      {
        filePath: `${routesRoot}/api/bench/metrics.api.ts`,
        type: "api",
        urlPattern: "/api/bench/metrics",
        methods: ["GET"],
        layouts: [],
        middlewares: [`${routesRoot}/_middleware.ts`],
        params: [],
        isCatchAll: false,
      },
      {
        filePath: `${routesRoot}/api/bench/timeline.api.ts`,
        type: "api",
        urlPattern: "/api/bench/timeline",
        methods: ["GET"],
        layouts: [],
        middlewares: [`${routesRoot}/_middleware.ts`],
        params: [],
        isCatchAll: false,
      },
      {
        filePath: `${routesRoot}/api/bench/owners.api.ts`,
        type: "api",
        urlPattern: "/api/bench/owners",
        methods: ["GET"],
        layouts: [],
        middlewares: [`${routesRoot}/_middleware.ts`],
        params: [],
        isCatchAll: false,
      },
    ],
  };
}

export async function createSuperComplexRuntimeBenchmarkFixture(): Promise<RuntimeBenchmarkFixture> {
  const routesRoot = "/virtual/mega/routes";
  const groupedRoot = `${routesRoot}/(ops)/(primary)`;
  const workspaceRoot = `${groupedRoot}/workspaces`;
  const workspaceDir = `${workspaceRoot}/[workspaceId]`;
  const projectsDir = `${workspaceDir}/projects`;
  const projectDir = `${projectsDir}/[projectId]`;
  const releasesDir = `${projectDir}/releases`;
  const releaseDir = `${releasesDir}/[releaseId]`;
  const incidentsDir = `${releaseDir}/incidents`;
  const incidentDir = `${incidentsDir}/[incidentId]`;

  return createRegisteredRuntimeBenchmarkFixture(buildSuperComplexRuntimeFixtureManifest(), {
    [`${routesRoot}/_layout.tsx`]: createBenchmarkLayoutModule("root", {
      title: { default: "Operations", template: "%s | Capstan" },
    }),
    [`${routesRoot}/_middleware.ts`]: {
      default: defineMiddleware(async ({ next }) => next()),
    },
    [`${routesRoot}/(ops)/_layout.tsx`]: createBenchmarkLayoutModule("ops", {
      description: "Operational command surface",
    }),
    [`${routesRoot}/(ops)/_middleware.ts`]: {
      default: defineMiddleware(async ({ next }) => next()),
    },
    [`${groupedRoot}/_layout.tsx`]: createBenchmarkLayoutModule("primary-surface", {
      openGraph: {
        siteName: "Capstan Control Plane",
      },
    }),
    [`${workspaceRoot}/_layout.tsx`]: createBenchmarkLayoutModule("workspaces", {
      alternates: {
        languages: {
          "en-US": "https://example.com/en/workspaces",
          "zh-CN": "https://example.com/zh/workspaces",
        },
      },
    }),
    [`${workspaceRoot}/_middleware.ts`]: {
      default: defineMiddleware(async ({ next }) => next()),
    },
    [`${workspaceDir}/_layout.tsx`]: createBenchmarkLayoutModule("workspace", {
      canonical: "https://example.com/workspaces/acme",
    }),
    [`${workspaceDir}/_middleware.ts`]: {
      default: defineMiddleware(async ({ next }) => next()),
    },
    [`${projectsDir}/_layout.tsx`]: createBenchmarkLayoutModule("projects", {
      keywords: ["projects", "operations", "runtime"],
    }),
    [`${projectDir}/_layout.tsx`]: createBenchmarkLayoutModule("project", {
      robots: {
        index: false,
        follow: true,
      },
    }),
    [`${projectDir}/_middleware.ts`]: {
      default: defineMiddleware(async ({ next }) => next()),
    },
    [`${projectDir}/not-found.page.tsx`]: {
      default: () => createElement("main", null, "project boundary missing"),
      metadata: {
        title: "Project boundary missing",
      },
    },
    [`${releasesDir}/_layout.tsx`]: createBenchmarkLayoutModule("releases", {
      icons: {
        icon: [{ url: "/icons/release.svg", type: "image/svg+xml" }],
      },
    }),
    [`${releaseDir}/_layout.tsx`]: createBenchmarkLayoutModule("release", {
      twitter: {
        card: "summary_large_image",
        title: "Release command center",
      },
    }),
    [`${releaseDir}/_middleware.ts`]: {
      default: defineMiddleware(async ({ next }) => next()),
    },
    [`${incidentsDir}/_layout.tsx`]: createBenchmarkLayoutModule("incidents", {
      openGraph: {
        title: "Incident command center",
        type: "article",
      },
    }),
    [`${incidentDir}/_loading.tsx`]: {
      default: () => createElement("p", null, "incident loading"),
    },
    [`${incidentDir}/_error.tsx`]: {
      default: () => createElement("p", null, "incident error"),
    },
    [`${incidentDir}/index.page.tsx`]: {
      default: () =>
        createElement(
          "main",
          { "data-page": "incident-cockpit" },
          createElement("h1", null, "incident cockpit"),
          createElement("p", null, "release operations overview"),
        ),
      componentType: "server",
      renderMode: "streaming",
      metadata: {
        title: "Incident cockpit",
        description: "Deep benchmark incident route",
      },
      loader: async ({
        fetch,
        params,
      }: {
        fetch: {
          get: <T>(path: string, params?: Record<string, string>) => Promise<T>;
        };
        params: Record<string, string>;
      }) => {
        const query = {
          workspaceId: params.workspaceId ?? "unknown-workspace",
          projectId: params.projectId ?? "unknown-project",
          releaseId: params.releaseId ?? "unknown-release",
          incidentId: params.incidentId ?? "unknown-incident",
        };

        const [context, metrics, timeline, owners] = await Promise.all([
          fetch.get("/api/bench/context", query),
          fetch.get("/api/bench/metrics", query),
          fetch.get("/api/bench/timeline", query),
          fetch.get("/api/bench/owners", query),
        ]);

        return {
          context,
          metrics,
          timeline,
          owners,
        };
      },
    },
    [`${routesRoot}/api/bench/context.api.ts`]: {
      GET: defineAPI({
        capability: "read",
        input: z.object({
          workspaceId: z.string(),
          projectId: z.string(),
          releaseId: z.string(),
          incidentId: z.string(),
        }),
        output: z.object({
          workspaceId: z.string(),
          projectId: z.string(),
          releaseId: z.string(),
          incidentId: z.string(),
          severity: z.literal("high"),
          state: z.literal("active"),
        }),
        handler: async ({ input }) => ({
          ...input,
          severity: "high" as const,
          state: "active" as const,
        }),
      }),
    },
    [`${routesRoot}/api/bench/metrics.api.ts`]: {
      GET: defineAPI({
        capability: "read",
        input: z.object({
          workspaceId: z.string(),
          projectId: z.string(),
          releaseId: z.string(),
          incidentId: z.string(),
        }),
        output: z.object({
          slaMinutesRemaining: z.number(),
          impactedServices: z.number(),
          concurrentResponders: z.number(),
        }),
        handler: async () => ({
          slaMinutesRemaining: 37,
          impactedServices: 9,
          concurrentResponders: 14,
        }),
      }),
    },
    [`${routesRoot}/api/bench/timeline.api.ts`]: {
      GET: defineAPI({
        capability: "read",
        input: z.object({
          workspaceId: z.string(),
          projectId: z.string(),
          releaseId: z.string(),
          incidentId: z.string(),
        }),
        output: z.object({
          entries: z.array(
            z.object({
              at: z.string(),
              kind: z.enum(["deploy", "rollback", "mitigation"]),
            }),
          ),
        }),
        handler: async () => ({
          entries: [
            { at: "2026-04-04T08:00:00.000Z", kind: "deploy" as const },
            { at: "2026-04-04T08:11:00.000Z", kind: "mitigation" as const },
            { at: "2026-04-04T08:18:00.000Z", kind: "rollback" as const },
          ],
        }),
      }),
    },
    [`${routesRoot}/api/bench/owners.api.ts`]: {
      GET: defineAPI({
        capability: "read",
        input: z.object({
          workspaceId: z.string(),
          projectId: z.string(),
          releaseId: z.string(),
          incidentId: z.string(),
        }),
        output: z.object({
          primary: z.string(),
          secondary: z.string(),
          escalationChain: z.array(z.string()),
        }),
        handler: async () => ({
          primary: "sre-primary",
          secondary: "release-owner",
          escalationChain: ["incident-commander", "platform-director", "cto"],
        }),
      }),
    },
  });
}

export async function createSuperComplexRouteManifest(): Promise<{
  fixture: SyntheticRoutesFixture;
  manifest: RouteManifest;
}> {
  const fixture = await createSuperComplexRoutesFixture();
  const manifest = await scanRoutes(fixture.routesDir);
  return { fixture, manifest };
}
