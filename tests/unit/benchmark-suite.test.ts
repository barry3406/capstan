import { describe, expect, it } from "bun:test";

import { benchmarkBaseline } from "../../benchmarks/baseline.js";
import { benchmarkBudgets } from "../../benchmarks/budgets.js";
import {
  formatBenchmarkScenarioList,
  parseBenchmarkCliArgs,
  selectBenchmarkScenarios,
} from "../../benchmarks/cli.js";
import {
  evaluateBudget,
  formatBenchmarkTable,
  runBenchmarkSuite,
  summarizeSamples,
} from "../../benchmarks/harness.js";
import { createBenchmarkScenarios } from "../../benchmarks/scenarios.js";
import { formatBenchmarkMarkdownSummary } from "../../benchmarks/summary.js";

describe("benchmark harness", () => {
  it("summarizes measured samples into latency percentiles and throughput", () => {
    const summary = summarizeSamples([5, 1, 3, 7, 9], 100);

    expect(summary.sampleCount).toBe(5);
    expect(summary.totalIterations).toBe(500);
    expect(summary.avgMs).toBe(5);
    expect(summary.p50Ms).toBe(5);
    expect(summary.p95Ms).toBeCloseTo(8.6, 5);
    expect(summary.minMs).toBe(1);
    expect(summary.maxMs).toBe(9);
    expect(summary.opsPerSec).toBe(200);
  });

  it("rejects empty sample sets and invalid iteration counts", () => {
    expect(() => summarizeSamples([], 1)).toThrow(
      "Benchmark summaries require at least one measured sample.",
    );
    expect(() => summarizeSamples([1], 0)).toThrow(
      "iterationsPerSample must be a positive integer.",
    );
  });

  it("reports both avg and p95 budget regressions", () => {
    const summary = summarizeSamples([2, 4, 6, 8, 10], 10);
    expect(
      evaluateBudget(summary, {
        maxAvgMs: 4.5,
        maxP95Ms: 8.5,
      }),
    ).toEqual([
      "avg 6.000ms exceeded budget 4.500ms",
      "p95 9.600ms exceeded budget 8.500ms",
    ]);
  });

  it("marks missing budgets and explicit budget failures in suite reports", async () => {
    const report = await runBenchmarkSuite({
      scenarios: [
        {
          id: "missing-budget",
          description: "scenario without a budget",
          group: "test",
          iterations: 1,
          samples: 1,
          run: () => undefined,
        },
        {
          id: "failing-budget",
          description: "scenario that must fail its budget",
          group: "test",
          iterations: 1,
          samples: 1,
          run: () => undefined,
        },
      ],
      budgets: {
        "failing-budget": {
          maxAvgMs: -1,
          maxP95Ms: -1,
        },
      },
      strictBudgets: true,
    });

    expect(report.failed).toBe(true);
    expect(report.results[0]?.status).toBe("fail");
    expect(report.results[0]?.failures).toContain(
      "no performance budget is defined for this scenario",
    );
    expect(report.results[1]?.status).toBe("fail");
    expect(report.results[1]?.failures.some((failure) => failure.includes("avg"))).toBe(true);
    expect(report.results[1]?.failures.some((failure) => failure.includes("p95"))).toBe(true);
  });

  it("reports teardown failures without aborting the suite", async () => {
    const report = await runBenchmarkSuite({
      scenarios: [
        {
          id: "teardown-failure",
          description: "scenario with a cleanup failure",
          group: "test",
          iterations: 1,
          samples: 1,
          setup: () => ({ cleaned: false }),
          run: () => undefined,
          teardown: () => {
            throw new Error("cleanup broke");
          },
        },
      ],
      budgets: {
        "teardown-failure": {
          maxAvgMs: 100,
          maxP95Ms: 100,
        },
      },
    });

    expect(report.failed).toBe(true);
    expect(report.results[0]?.status).toBe("fail");
    expect(report.results[0]?.failures).toContain("scenario teardown failed");
    expect(report.results[0]?.error).toBe("cleanup broke");
  });

  it("runs beforeSample hooks ahead of both warmup and measured samples", async () => {
    const markers: number[] = [];

    const report = await runBenchmarkSuite({
      scenarios: [
        {
          id: "before-sample",
          description: "scenario with sample preparation",
          group: "test",
          iterations: 1,
          samples: 2,
          warmupSamples: 1,
          setup: () => ({ marker: 0 }),
          beforeSample: (state) => {
            state.marker += 1;
            markers.push(state.marker);
          },
          run: (state) => {
            if (state.marker === 0) {
              throw new Error("beforeSample did not run");
            }
          },
        },
      ],
      budgets: {
        "before-sample": {
          maxAvgMs: 100,
          maxP95Ms: 100,
        },
      },
    });

    expect(report.failed).toBe(false);
    expect(markers).toEqual([1, 2, 3]);
  });

  it("runs beforeIteration hooks outside the measured iteration body", async () => {
    const iterations: Array<{ sampleIndex: number; iterationIndex: number }> = [];

    const report = await runBenchmarkSuite({
      scenarios: [
        {
          id: "before-iteration",
          description: "scenario with iteration preparation",
          group: "test",
          iterations: 2,
          samples: 2,
          warmupSamples: 1,
          setup: () => ({ marker: 0 }),
          beforeIteration: (state, iterationIndex, sampleIndex) => {
            state.marker += 1;
            iterations.push({ sampleIndex, iterationIndex });
          },
          run: (state) => {
            if (state.marker === 0) {
              throw new Error("beforeIteration did not run");
            }
          },
        },
      ],
      budgets: {
        "before-iteration": {
          maxAvgMs: 100,
          maxP95Ms: 100,
        },
      },
    });

    expect(report.failed).toBe(false);
    expect(iterations).toEqual([
      { sampleIndex: 0, iterationIndex: 0 },
      { sampleIndex: 0, iterationIndex: 1 },
      { sampleIndex: 1, iterationIndex: 0 },
      { sampleIndex: 1, iterationIndex: 1 },
      { sampleIndex: 2, iterationIndex: 0 },
      { sampleIndex: 2, iterationIndex: 1 },
    ]);
  });

  it("formats human-readable benchmark tables", async () => {
    const report = await runBenchmarkSuite({
      scenarios: [
        {
          id: "table-row",
          description: "table formatting fixture",
          group: "test",
          iterations: 1,
          samples: 1,
          run: () => undefined,
        },
      ],
      budgets: {
        "table-row": {
          maxAvgMs: 100,
          maxP95Ms: 100,
        },
      },
      baseline: {
        "table-row": {
          avgMs: 0.25,
          p95Ms: 0.5,
        },
      },
    });

    const table = formatBenchmarkTable(report);
    expect(table).toContain("Capstan Benchmark Suite");
    expect(table).toContain("table-row");
    expect(table).toContain("Group Trends");
    expect(table).toContain("Δavg");
    expect(table).toContain("PASS");
  });

  it("computes scenario deltas and group trends from a committed baseline", async () => {
    const report = await runBenchmarkSuite({
      scenarios: [
        {
          id: "router.fast",
          description: "fast router fixture",
          group: "router",
          iterations: 1,
          samples: 2,
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
          },
        },
        {
          id: "router.slower",
          description: "slower router fixture",
          group: "router",
          iterations: 1,
          samples: 2,
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 2));
          },
        },
      ],
      budgets: {
        "router.fast": { maxAvgMs: 50, maxP95Ms: 50 },
        "router.slower": { maxAvgMs: 50, maxP95Ms: 50 },
      },
      baseline: {
        "router.fast": { avgMs: 2.5, p95Ms: 2.5 },
        "router.slower": { avgMs: 1.0, p95Ms: 1.0 },
      },
    });

    expect(report.results[0]?.delta?.direction).toBe("improved");
    expect(report.results[1]?.delta?.direction).toBe("regressed");
    expect(report.groups).toEqual([
      expect.objectContaining({
        group: "router",
        scenarioCount: 2,
      }),
    ]);
    expect(report.groups[0]?.avgDeltaPct).toBeDefined();
  });

  it("formats CI-friendly markdown summaries with group trends and regressions", () => {
    const summary = formatBenchmarkMarkdownSummary({
      version: 1,
      createdAt: "2026-04-04T00:00:00.000Z",
      runtime: {
        node: "v22.0.0",
        platform: "linux",
        arch: "x64",
        cpuCount: 8,
        gcExposed: true,
      },
      strictBudgets: true,
      failed: false,
      groups: [
        {
          group: "router",
          scenarioCount: 2,
          avgMs: 10,
          p95Ms: 12,
          opsPerSec: 100,
          baselineAvgMs: 8,
          baselineP95Ms: 10,
          avgDeltaPct: 25,
          p95DeltaPct: 20,
        },
      ],
      results: [
        {
          id: "router.scan.synthetic-app",
          description: "scan fixture",
          group: "router",
          status: "pass",
          summary: summarizeSamples([10, 12], 1),
          budget: { maxAvgMs: 20, maxP95Ms: 30 },
          baseline: { avgMs: 8, p95Ms: 10 },
          delta: {
            avgMs: 3,
            avgPct: 37.5,
            p95Ms: 2,
            p95Pct: 20,
            direction: "regressed",
          },
          failures: [],
        },
      ],
    });

    expect(summary).toContain("## Performance");
    expect(summary).toContain("### Group Trends");
    expect(summary).toContain("router.scan.synthetic-app");
    expect(summary).toContain("+37.5%");
  });
});

describe("benchmark cli", () => {
  it("parses benchmark flags and selected scenarios", () => {
    expect(
      parseBenchmarkCliArgs([
        "--check",
        "--json",
        "--scenario",
        "router.scan.synthetic-app",
        "--output",
        "perf-report.json",
      ]),
    ).toEqual({
      check: true,
      json: true,
      list: false,
      output: "perf-report.json",
      scenarios: ["router.scan.synthetic-app"],
    });
  });

  it("rejects unknown flags and missing option values", () => {
    expect(() => parseBenchmarkCliArgs(["--wat"])).toThrow(
      "Unknown benchmark flag: --wat",
    );
    expect(() => parseBenchmarkCliArgs(["--scenario"])).toThrow(
      "--scenario requires a scenario id.",
    );
    expect(() => parseBenchmarkCliArgs(["--output"])).toThrow(
      "--output requires a file path.",
    );
  });

  it("selects explicit scenario subsets and errors on unknown ids", () => {
    const scenarios = createBenchmarkScenarios();
    const selected = selectBenchmarkScenarios(scenarios, [
      "react.render.minimal-ssr",
      "runtime.request.navigation",
    ]);

    expect(selected.map((scenario) => scenario.id)).toEqual([
      "react.render.minimal-ssr",
      "runtime.request.navigation",
    ]);
    expect(() =>
      selectBenchmarkScenarios(scenarios, ["does-not-exist"]),
    ).toThrow("Unknown benchmark scenarios: does-not-exist");
  });

  it("lists every benchmark scenario and keeps budgets aligned with scenarios", () => {
    const scenarios = createBenchmarkScenarios();
    const listOutput = formatBenchmarkScenarioList(scenarios);
    const scenarioIds = scenarios.map((scenario) => scenario.id);
    const budgetIds = Object.keys(benchmarkBudgets);
    const baselineIds = Object.keys(benchmarkBaseline);

    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    expect(new Set(budgetIds).size).toBe(budgetIds.length);
    expect([...scenarioIds].sort()).toEqual([...budgetIds].sort());
    expect([...scenarioIds].sort()).toEqual([...baselineIds].sort());
    expect(listOutput).toContain("Available benchmark scenarios");
    expect(listOutput).toContain("runtime.request.not-found");
    expect(listOutput).toContain("router.scan.super-complex-app");
    expect(listOutput).toContain("router.scan.incremental-super-complex-app");
    expect(listOutput).toContain("runtime.request.deep-document");
  });
});
