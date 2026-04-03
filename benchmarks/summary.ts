import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { BenchmarkReport, BenchmarkResult } from "./harness.js";

function formatSignedPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function toStatusIcon(status: BenchmarkResult["status"]): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "unbudgeted":
      return "NO BUDGET";
    case "fail":
      return "FAIL";
  }
}

export function formatBenchmarkMarkdownSummary(report: BenchmarkReport): string {
  const regressions = [...report.results]
    .filter((result) => result.delta && result.delta.avgPct > 0)
    .sort((left, right) => (right.delta?.avgPct ?? 0) - (left.delta?.avgPct ?? 0))
    .slice(0, 5);

  const improvements = [...report.results]
    .filter((result) => result.delta && result.delta.avgPct < 0)
    .sort((left, right) => (left.delta?.avgPct ?? 0) - (right.delta?.avgPct ?? 0))
    .slice(0, 3);

  const lines = [
    "## Performance",
    "",
    `- Result: ${report.failed ? "FAIL" : "PASS"}`,
    `- Runtime: ${report.runtime.node} on ${report.runtime.platform}/${report.runtime.arch} (${report.runtime.cpuCount} CPUs)`,
    `- Benchmarks: ${report.results.length} scenarios across ${report.groups.length} groups`,
    "",
    "### Group Trends",
    "",
    "| Group | Avg | P95 | Δavg | Scenarios |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const group of report.groups) {
    lines.push(
      `| ${group.group} | ${group.avgMs.toFixed(3)}ms | ${group.p95Ms.toFixed(3)}ms | ${formatSignedPercent(group.avgDeltaPct)} | ${group.scenarioCount} |`,
    );
  }

  lines.push("");
  lines.push("### Largest Regressions");
  lines.push("");

  if (regressions.length === 0) {
    lines.push("No scenario regressed against the committed baseline.");
  } else {
    lines.push("| Scenario | Avg | Δavg | Status |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const result of regressions) {
      lines.push(
        `| ${result.id} | ${result.summary?.avgMs.toFixed(3) ?? "n/a"}ms | ${formatSignedPercent(result.delta?.avgPct)} | ${toStatusIcon(result.status)} |`,
      );
    }
  }

  if (improvements.length > 0) {
    lines.push("");
    lines.push("### Largest Improvements");
    lines.push("");
    lines.push("| Scenario | Avg | Δavg | Status |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const result of improvements) {
      lines.push(
        `| ${result.id} | ${result.summary?.avgMs.toFixed(3) ?? "n/a"}ms | ${formatSignedPercent(result.delta?.avgPct)} | ${toStatusIcon(result.status)} |`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(reportPath: string): Promise<void> {
  const raw = await readFile(reportPath, "utf-8");
  const report = JSON.parse(raw) as BenchmarkReport;
  process.stdout.write(formatBenchmarkMarkdownSummary(report));
}

const isMainModule = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error("Usage: node --import tsx ./benchmarks/summary.ts <perf-report.json>");
    process.exitCode = 1;
  } else {
    main(reportPath).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
