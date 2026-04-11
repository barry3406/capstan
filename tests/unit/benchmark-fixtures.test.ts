import { afterAll, describe, expect, it } from "bun:test";

import {
  createSuperComplexRouteManifest,
  createSuperComplexRuntimeBenchmarkFixture,
  createSyntheticRouteManifest,
} from "../../benchmarks/fixtures.js";

const cleanupTasks: Array<() => Promise<void>> = [];

afterAll(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe("benchmark fixtures", () => {
  it("builds a super-complex route manifest that meaningfully exceeds the baseline fixture", async () => {
    const baseline = await createSyntheticRouteManifest();
    cleanupTasks.push(() => baseline.fixture.cleanup());

    const complex = await createSuperComplexRouteManifest();
    cleanupTasks.push(() => complex.fixture.cleanup());

    expect(complex.manifest.routes.length).toBeGreaterThan(
      baseline.manifest.routes.length * 2,
    );
    expect(
      complex.manifest.routes.some(
        (route) =>
          route.type === "page"
          && route.urlPattern === "/workspace-31/projects/:projectId/releases/:releaseId/incidents/:incidentId",
      ),
    ).toBe(true);
    expect(
      complex.manifest.routes.some(
        (route) =>
          route.type === "page"
          && route.urlPattern === "/workspace-23/projects/:projectId/docs/*",
      ),
    ).toBe(true);
  });

  it("serves deep document and navigation responses from the super-complex runtime fixture", async () => {
    const fixture = await createSuperComplexRuntimeBenchmarkFixture();
    cleanupTasks.push(() => fixture.cleanup());

    const documentResponse = await fixture.app.fetch(
      new Request("http://localhost/workspaces/acme/projects/atlas/releases/42/incidents/77", {
        headers: { Accept: "text/html" },
      }),
    );
    const documentBody = await documentResponse.text();

    expect(documentResponse.status).toBe(200);
    expect(documentBody).toContain("<title>Incident cockpit | Capstan</title>");
    expect(documentBody).toContain('content="Capstan Control Plane"');

    const navigationResponse = await fixture.app.fetch(
      new Request("http://localhost/workspaces/acme/projects/atlas/releases/42/incidents/77", {
        headers: { "X-Capstan-Nav": "1" },
      }),
    );
    const navigationBody = await navigationResponse.text();

    expect(navigationResponse.status).toBe(200);
    expect(navigationBody).toContain("\"severity\":\"high\"");
    expect(navigationBody).toContain("\"primary\":\"sre-primary\"");

    const notFoundResponse = await fixture.app.fetch(
      new Request("http://localhost/workspaces/acme/projects/atlas/ghost", {
        headers: { Accept: "text/html" },
      }),
    );
    const notFoundBody = await notFoundResponse.text();

    expect(notFoundResponse.status).toBe(404);
    expect(notFoundBody).toContain("404");
  });
});
