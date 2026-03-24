import { agentSurface } from "../agent-surface/index.js";
import { artifacts } from "../artifacts/index.js";
import { capabilities } from "../capabilities/index.js";
import { controlPlane } from "../control-plane/index.js";
import { domain } from "../domain.js";
import {
  createHumanSurfaceRuntimeSnapshot,
  humanSurface
} from "../human-surface/index.js";
import { policies } from "../policies/index.js";
import { resources } from "../resources/index.js";
import { tasks } from "../tasks/index.js";
import type {
  AppAssertion,
  AppAssertionContext,
  AppAssertionResult
} from "../types.js";
import { views } from "../views/index.js";
import { customAssertions } from "./custom.js";

export interface AppAssertionRun {
  assertion: {
    key: string;
    title: string;
    source: "generated" | "custom";
  };
  result: AppAssertionResult;
}

function pass(summary: string, detail?: string): AppAssertionResult {
  return {
    status: "passed",
    summary,
    ...(detail ? { detail } : {})
  };
}

function fail(
  summary: string,
  hint: string,
  options: {
    detail?: string;
    file?: string;
  } = {}
): AppAssertionResult {
  return {
    status: "failed",
    summary,
    hint,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.file ? { file: options.file } : {})
  };
}

const generatedAssertions = [
  {
    key: "agentSurfaceSummary",
    title: "Agent Surface Summary Matches Projections",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const expected = {
        capabilities: context.capabilities.length,
        tasks: context.tasks.length,
        artifacts: context.artifacts.length
      };
      const received = {
        capabilities: context.agentSurface.summary?.capabilityCount ?? -1,
        tasks: context.agentSurface.summary?.taskCount ?? -1,
        artifacts: context.agentSurface.summary?.artifactCount ?? -1
      };

      if (
        expected.capabilities !== received.capabilities ||
        expected.tasks !== received.tasks ||
        expected.artifacts !== received.artifacts
      ) {
        return fail(
          "Agent surface summary counts diverged from the generated projections.",
          "Regenerate the app so the agent surface summary converges again.",
          {
            detail: `Expected ${expected.capabilities}/${expected.tasks}/${expected.artifacts}, received ${received.capabilities}/${received.tasks}/${received.artifacts}.`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Agent surface summary matches generated capability, task, and artifact counts.");
    }
  },
  {
    key: "humanSurfaceSummary",
    title: "Human Surface Summary Matches Projections",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const expected = {
        resources: context.resources.length,
        capabilities: context.capabilities.length,
        routes: context.humanSurface.routes?.length ?? 0
      };
      const received = {
        resources: context.humanSurface.summary?.resourceCount ?? -1,
        capabilities: context.humanSurface.summary?.capabilityCount ?? -1,
        routes: context.humanSurface.summary?.routeCount ?? -1
      };

      if (
        expected.resources !== received.resources ||
        expected.capabilities !== received.capabilities ||
        expected.routes !== received.routes
      ) {
        return fail(
          "Human surface summary counts diverged from the generated projections.",
          "Regenerate the app so the human surface summary stays aligned with the projected routes.",
          {
            detail: `Expected ${expected.resources}/${expected.capabilities}/${expected.routes}, received ${received.resources}/${received.capabilities}/${received.routes}.`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Human surface summary matches generated resource, capability, and route counts.");
    }
  },
  {
    key: "controlPlaneDiscovery",
    title: "Control Plane Discovery Matches Runtime Registries",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const searchResult = context.controlPlane.search("") as {
        capabilities?: unknown[];
        tasks?: unknown[];
        artifacts?: unknown[];
      };

      if (
        !Array.isArray(searchResult?.capabilities) ||
        !Array.isArray(searchResult?.tasks) ||
        !Array.isArray(searchResult?.artifacts)
      ) {
        return fail(
          "Control plane search returned an invalid discovery shape.",
          "Preserve the generated control plane discovery contract.",
          {
            file: "src/assertions/index.ts"
          }
        );
      }

      if (
        searchResult.capabilities.length !== context.capabilities.length ||
        searchResult.tasks.length !== context.tasks.length ||
        searchResult.artifacts.length !== context.artifacts.length
      ) {
        return fail(
          "Control plane search no longer exposes the full generated discovery set.",
          "Keep control plane discovery aligned with the generated registries.",
          {
            detail: `Expected ${context.capabilities.length}/${context.tasks.length}/${context.artifacts.length}, received ${searchResult.capabilities.length}/${searchResult.tasks.length}/${searchResult.artifacts.length}.`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Control plane discovery matches the generated capability, task, and artifact registries.");
    }
  },
  {
    key: "humanSurfaceRuntimeSnapshot",
    title: "Human Surface Runtime Snapshot Covers Every Route",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const snapshot = context.createHumanSurfaceRuntimeSnapshot();
      const routeCount = context.humanSurface.routes?.length ?? 0;
      const resultCount = Object.keys(snapshot.results ?? {}).length;
      const firstRouteKey = context.humanSurface.routes?.[0]?.key;

      if (!snapshot.activeRouteKey || (firstRouteKey && snapshot.activeRouteKey !== firstRouteKey)) {
        return fail(
          "Human surface runtime snapshot did not activate the expected default route.",
          "Keep the human surface runtime snapshot aligned with the generated route order.",
          {
            detail: `Expected "${firstRouteKey ?? "unknown"}", received "${snapshot.activeRouteKey ?? "missing"}".`,
            file: "src/assertions/index.ts"
          }
        );
      }

      if (resultCount !== routeCount) {
        return fail(
          "Human surface runtime snapshot does not track every generated route result.",
          "Keep runtime snapshot generation aligned with the projected human routes.",
          {
            detail: `Expected ${routeCount} route results, received ${resultCount}.`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Human surface runtime snapshot covers every generated route result.");
    }
  }
] as const satisfies readonly AppAssertion[];

export const appAssertions: readonly AppAssertion[] = [
  ...generatedAssertions,
  ...customAssertions
];

export function createAppAssertionContext(): AppAssertionContext {
  return {
    domain,
    resources,
    capabilities,
    tasks,
    policies,
    artifacts,
    views,
    controlPlane: {
      search: controlPlane.search
    },
    agentSurface,
    humanSurface,
    createHumanSurfaceRuntimeSnapshot
  };
}

export async function runAppAssertions(
  context: AppAssertionContext = createAppAssertionContext()
): Promise<AppAssertionRun[]> {
  const runs: AppAssertionRun[] = [];

  for (const assertion of appAssertions) {
    try {
      const result = await assertion.run(context);
      runs.push({
        assertion: {
          key: assertion.key,
          title: assertion.title,
          source: assertion.source ?? "custom"
        },
        result
      });
    } catch (error: unknown) {
      runs.push({
        assertion: {
          key: assertion.key,
          title: assertion.title,
          source: assertion.source ?? "custom"
        },
        result: {
          status: "failed",
          summary: `Assertion "${assertion.key}" threw before it could complete.`,
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
          hint: "Fix the assertion runtime or simplify the assertion body before rerunning `capstan verify`.",
          file:
            assertion.source === "generated"
              ? "src/assertions/index.ts"
              : "src/assertions/custom.ts"
        }
      });
    }
  }

  return runs;
}
