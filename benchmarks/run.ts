import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatBenchmarkScenarioList,
  parseBenchmarkCliArgs,
  selectBenchmarkScenarios,
} from "./cli.js";
import { benchmarkBaseline } from "./baseline.js";
import { benchmarkBudgets } from "./budgets.js";
import { formatBenchmarkTable, runBenchmarkSuite } from "./harness.js";
import { createBenchmarkScenarios } from "./scenarios.js";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseBenchmarkCliArgs(argv);
  const scenarios = createBenchmarkScenarios();

  if (args.list) {
    process.stdout.write(formatBenchmarkScenarioList(scenarios));
    return;
  }

  const selectedScenarios = selectBenchmarkScenarios(scenarios, args.scenarios);
  const report = await runBenchmarkSuite({
    scenarios: selectedScenarios,
    budgets: benchmarkBudgets,
    baseline: benchmarkBaseline,
    strictBudgets: args.check,
  });

  const output = args.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatBenchmarkTable(report);

  process.stdout.write(output);

  if (args.output) {
    const outputPath = resolve(args.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }

  if (args.check && report.failed) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
