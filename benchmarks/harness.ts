import { cpus } from "node:os";

export interface BenchmarkScenario<State = void> {
  id: string;
  description: string;
  group: string;
  iterations: number;
  samples: number;
  warmupSamples?: number;
  setup?: () => Promise<State> | State;
  beforeSample?: (state: State, sampleIndex: number) => Promise<void> | void;
  beforeIteration?: (
    state: State,
    iterationIndex: number,
    sampleIndex: number,
  ) => Promise<void> | void;
  run: (state: State) => Promise<void> | void;
  teardown?: (state: State) => Promise<void> | void;
}

export interface BenchmarkBudget {
  maxAvgMs: number;
  maxP95Ms: number;
}

export type BenchmarkBudgetMap = Record<string, BenchmarkBudget>;

export interface BenchmarkBaseline {
  avgMs: number;
  p95Ms: number;
}

export type BenchmarkBaselineMap = Record<string, BenchmarkBaseline>;

export interface BenchmarkSummary {
  sampleCount: number;
  iterationsPerSample: number;
  totalIterations: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
  opsPerSec: number;
  rawSampleMs: number[];
}

export interface BenchmarkResult {
  id: string;
  description: string;
  group: string;
  status: "pass" | "fail" | "unbudgeted";
  summary?: BenchmarkSummary;
  budget?: BenchmarkBudget;
  baseline?: BenchmarkBaseline;
  delta?: {
    avgMs: number;
    avgPct: number;
    p95Ms: number;
    p95Pct: number;
    direction: "improved" | "regressed" | "flat";
  };
  failures: string[];
  error?: string;
}

export interface BenchmarkGroupResult {
  group: string;
  scenarioCount: number;
  avgMs: number;
  p95Ms: number;
  opsPerSec: number;
  baselineAvgMs?: number;
  baselineP95Ms?: number;
  avgDeltaPct?: number;
  p95DeltaPct?: number;
}

export interface BenchmarkReport {
  version: 1;
  createdAt: string;
  runtime: {
    node: string;
    platform: string;
    arch: string;
    cpuCount: number;
    gcExposed: boolean;
  };
  strictBudgets: boolean;
  results: BenchmarkResult[];
  groups: BenchmarkGroupResult[];
  failed: boolean;
}

export interface BenchmarkSuiteOptions {
  scenarios: BenchmarkScenario[];
  budgets?: BenchmarkBudgetMap;
  baseline?: BenchmarkBaselineMap;
  strictBudgets?: boolean;
}

function toFixed(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) {
    throw new Error("Cannot compute a percentile from an empty sample set.");
  }

  if (sortedValues.length === 1) {
    return sortedValues[0]!;
  }

  const index = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex]!;
  const upper = sortedValues[upperIndex]!;

  if (lowerIndex === upperIndex) {
    return lower;
  }

  const weight = index - lowerIndex;
  return lower + (upper - lower) * weight;
}

function standardDeviation(values: readonly number[], mean: number): number {
  if (values.length <= 1) {
    return 0;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function maybeCollectGarbage(): void {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };
  runtime.gc?.();
}

async function measureScenarioSample<State>(
  scenario: BenchmarkScenario<State>,
  state: State,
  sampleIndex: number,
): Promise<number> {
  if (scenario.beforeIteration) {
    let totalElapsedMs = 0;

    for (let index = 0; index < scenario.iterations; index++) {
      await scenario.beforeIteration(state, index, sampleIndex);
      const startedAt = performance.now();
      await scenario.run(state);
      totalElapsedMs += performance.now() - startedAt;
    }

    return totalElapsedMs / scenario.iterations;
  }

  const startedAt = performance.now();

  for (let index = 0; index < scenario.iterations; index++) {
    await scenario.run(state);
  }

  const elapsedMs = performance.now() - startedAt;
  return elapsedMs / scenario.iterations;
}

export function summarizeSamples(
  samples: readonly number[],
  iterationsPerSample: number,
): BenchmarkSummary {
  if (samples.length === 0) {
    throw new Error("Benchmark summaries require at least one measured sample.");
  }
  if (!Number.isInteger(iterationsPerSample) || iterationsPerSample <= 0) {
    throw new Error("iterationsPerSample must be a positive integer.");
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const avgMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const minMs = sorted[0]!;
  const maxMs = sorted[sorted.length - 1]!;

  return {
    sampleCount: sorted.length,
    iterationsPerSample,
    totalIterations: sorted.length * iterationsPerSample,
    avgMs,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minMs,
    maxMs,
    stdDevMs: standardDeviation(sorted, avgMs),
    opsPerSec: avgMs > 0 ? 1000 / avgMs : Number.POSITIVE_INFINITY,
    rawSampleMs: sorted,
  };
}

export function evaluateBudget(
  summary: BenchmarkSummary,
  budget: BenchmarkBudget,
): string[] {
  const failures: string[] = [];

  if (summary.avgMs > budget.maxAvgMs) {
    failures.push(
      `avg ${toFixed(summary.avgMs)}ms exceeded budget ${toFixed(budget.maxAvgMs)}ms`,
    );
  }

  if (summary.p95Ms > budget.maxP95Ms) {
    failures.push(
      `p95 ${toFixed(summary.p95Ms)}ms exceeded budget ${toFixed(budget.maxP95Ms)}ms`,
    );
  }

  return failures;
}

async function runScenario<State>(
  scenario: BenchmarkScenario<State>,
  budget: BenchmarkBudget | undefined,
  baseline: BenchmarkBaseline | undefined,
  strictBudgets: boolean,
): Promise<BenchmarkResult> {
  let state: State | undefined;
  let result: BenchmarkResult;

  try {
    state = scenario.setup
      ? await scenario.setup()
      : undefined as State;

    maybeCollectGarbage();
    for (let index = 0; index < (scenario.warmupSamples ?? 2); index++) {
      if (scenario.beforeSample) {
        await scenario.beforeSample(state, index);
      }
      await measureScenarioSample(scenario, state, index);
      maybeCollectGarbage();
    }

    const samples: number[] = [];
    for (let index = 0; index < scenario.samples; index++) {
      const sampleIndex = index + (scenario.warmupSamples ?? 2);
      if (scenario.beforeSample) {
        await scenario.beforeSample(state, sampleIndex);
      }
      samples.push(await measureScenarioSample(scenario, state, sampleIndex));
      maybeCollectGarbage();
    }

    const summary = summarizeSamples(samples, scenario.iterations);
    const failures = budget
      ? evaluateBudget(summary, budget)
      : strictBudgets
        ? ["no performance budget is defined for this scenario"]
        : [];

    const status = failures.length > 0
      ? "fail"
      : budget
        ? "pass"
        : "unbudgeted";

    result = {
      id: scenario.id,
      description: scenario.description,
      group: scenario.group,
      status,
      summary,
      ...(budget ? { budget } : {}),
      ...(baseline ? { baseline } : {}),
      ...(baseline
        ? {
            delta: {
              avgMs: summary.avgMs - baseline.avgMs,
              avgPct: baseline.avgMs > 0 ? ((summary.avgMs - baseline.avgMs) / baseline.avgMs) * 100 : 0,
              p95Ms: summary.p95Ms - baseline.p95Ms,
              p95Pct: baseline.p95Ms > 0 ? ((summary.p95Ms - baseline.p95Ms) / baseline.p95Ms) * 100 : 0,
              direction:
                Math.abs(summary.avgMs - baseline.avgMs) < 0.01
                  ? "flat"
                  : summary.avgMs < baseline.avgMs
                    ? "improved"
                    : "regressed",
            },
          }
        : {}),
      failures,
    };
  } catch (error) {
    result = {
      id: scenario.id,
      description: scenario.description,
      group: scenario.group,
      status: "fail",
      failures: ["scenario execution failed"],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (state !== undefined && scenario.teardown) {
    try {
      await scenario.teardown(state);
    } catch (error) {
      return {
        ...result,
        status: "fail",
        failures: [...result.failures, "scenario teardown failed"],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return result;
}

function buildGroupResults(results: readonly BenchmarkResult[]): BenchmarkGroupResult[] {
  const grouped = new Map<string, BenchmarkResult[]>();

  for (const result of results) {
    if (!result.summary) {
      continue;
    }

    const bucket = grouped.get(result.group) ?? [];
    bucket.push(result);
    grouped.set(result.group, bucket);
  }

  return [...grouped.entries()]
    .map(([group, entries]) => {
      const scenarioCount = entries.length;
      const avgMs = entries.reduce((sum, entry) => sum + entry.summary!.avgMs, 0) / scenarioCount;
      const p95Ms = entries.reduce((sum, entry) => sum + entry.summary!.p95Ms, 0) / scenarioCount;
      const opsPerSec = entries.reduce((sum, entry) => sum + entry.summary!.opsPerSec, 0) / scenarioCount;
      const baselineEntries = entries.filter((entry) => entry.baseline);
      const baselineAvgMs = baselineEntries.length > 0
        ? baselineEntries.reduce((sum, entry) => sum + entry.baseline!.avgMs, 0) / baselineEntries.length
        : undefined;
      const baselineP95Ms = baselineEntries.length > 0
        ? baselineEntries.reduce((sum, entry) => sum + entry.baseline!.p95Ms, 0) / baselineEntries.length
        : undefined;

      return {
        group,
        scenarioCount,
        avgMs,
        p95Ms,
        opsPerSec,
        ...(baselineAvgMs !== undefined ? { baselineAvgMs } : {}),
        ...(baselineP95Ms !== undefined ? { baselineP95Ms } : {}),
        ...(baselineAvgMs && baselineAvgMs > 0
          ? { avgDeltaPct: ((avgMs - baselineAvgMs) / baselineAvgMs) * 100 }
          : {}),
        ...(baselineP95Ms && baselineP95Ms > 0
          ? { p95DeltaPct: ((p95Ms - baselineP95Ms) / baselineP95Ms) * 100 }
          : {}),
      } satisfies BenchmarkGroupResult;
    })
    .sort((left, right) => left.group.localeCompare(right.group));
}

export async function runBenchmarkSuite(
  options: BenchmarkSuiteOptions,
): Promise<BenchmarkReport> {
  const strictBudgets = options.strictBudgets ?? false;
  const results: BenchmarkResult[] = [];

  for (const scenario of options.scenarios) {
    results.push(
      await runScenario(
        scenario,
        options.budgets?.[scenario.id],
        options.baseline?.[scenario.id],
        strictBudgets,
      ),
    );
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: cpus().length,
      gcExposed: typeof (globalThis as typeof globalThis & { gc?: () => void }).gc === "function",
    },
    strictBudgets,
    groups: buildGroupResults(results),
    failed: results.some((result) => result.status === "fail"),
    results,
  };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

export function formatBenchmarkTable(report: BenchmarkReport): string {
  const lines = [
    "Capstan Benchmark Suite",
    `${report.runtime.node} | ${report.runtime.platform}/${report.runtime.arch} | cpu=${report.runtime.cpuCount} | gc=${report.runtime.gcExposed ? "on" : "off"}`,
    "",
    `${pad("Scenario", 34)} ${pad("avg", 9)} ${pad("p95", 9)} ${pad("ops/s", 11)} ${pad("Δavg", 9)} Status`,
    `${"-".repeat(34)} ${"-".repeat(9)} ${"-".repeat(9)} ${"-".repeat(11)} ${"-".repeat(9)} ${"-".repeat(18)}`,
  ];

  for (const result of report.results) {
    const summary = result.summary;
    const statusLabel =
      result.status === "pass"
        ? "PASS"
        : result.status === "unbudgeted"
          ? "NO BUDGET"
          : "FAIL";

    lines.push(
      `${pad(result.id, 34)} ${pad(summary ? toFixed(summary.avgMs) : "n/a", 9)} ${pad(summary ? toFixed(summary.p95Ms) : "n/a", 9)} ${pad(summary ? toFixed(summary.opsPerSec, 1) : "n/a", 11)} ${pad(result.delta ? `${result.delta.avgPct >= 0 ? "+" : ""}${toFixed(result.delta.avgPct, 1)}%` : "n/a", 9)} ${statusLabel}`,
    );

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        lines.push(`  - ${failure}`);
      }
    }

    if (result.error) {
      lines.push(`  - ${result.error}`);
    }
  }

  lines.push("");
  if (report.groups.length > 0) {
    lines.push("Group Trends");
    lines.push("");
    lines.push(`${pad("Group", 18)} ${pad("avg", 9)} ${pad("p95", 9)} ${pad("ops/s", 11)} ${pad("Δavg", 9)} Scenarios`);
    lines.push(`${"-".repeat(18)} ${"-".repeat(9)} ${"-".repeat(9)} ${"-".repeat(11)} ${"-".repeat(9)} ${"-".repeat(9)}`);
    for (const group of report.groups) {
      lines.push(
        `${pad(group.group, 18)} ${pad(toFixed(group.avgMs), 9)} ${pad(toFixed(group.p95Ms), 9)} ${pad(toFixed(group.opsPerSec, 1), 11)} ${pad(group.avgDeltaPct !== undefined ? `${group.avgDeltaPct >= 0 ? "+" : ""}${toFixed(group.avgDeltaPct, 1)}%` : "n/a", 9)} ${group.scenarioCount}`,
      );
    }
    lines.push("");
  }

  lines.push(
    report.failed
      ? "Result: FAIL"
      : report.results.every((result) => result.status === "pass")
        ? "Result: PASS"
        : "Result: PASS (with unbudgeted scenarios)",
  );

  return `${lines.join("\n")}\n`;
}
