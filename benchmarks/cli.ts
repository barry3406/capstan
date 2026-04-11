import type { BenchmarkScenario } from "./harness.js";

export interface BenchmarkCliArgs {
  check: boolean;
  json: boolean;
  list: boolean;
  output?: string;
  scenarios: string[];
}

export function parseBenchmarkCliArgs(args: readonly string[]): BenchmarkCliArgs {
  const parsed: BenchmarkCliArgs = {
    check: false,
    json: false,
    list: false,
    scenarios: [],
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;

    if (arg === "--check") {
      parsed.check = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--list") {
      parsed.list = true;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a file path.`);
      }
      parsed.output = value;
      index++;
      continue;
    }

    if (arg === "--scenario") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--scenario requires a scenario id.");
      }
      parsed.scenarios.push(value);
      index++;
      continue;
    }

    throw new Error(`Unknown benchmark flag: ${arg}`);
  }

  return parsed;
}

export function selectBenchmarkScenarios(
  scenarios: readonly BenchmarkScenario[],
  selectedIds: readonly string[],
): BenchmarkScenario[] {
  if (selectedIds.length === 0) {
    return [...scenarios];
  }

  const selected = scenarios.filter((scenario) => selectedIds.includes(scenario.id));
  const missing = selectedIds.filter(
    (id) => !scenarios.some((scenario) => scenario.id === id),
  );

  if (missing.length > 0) {
    throw new Error(`Unknown benchmark scenarios: ${missing.join(", ")}`);
  }

  return selected;
}

export function formatBenchmarkScenarioList(
  scenarios: readonly BenchmarkScenario[],
): string {
  const lines = ["Available benchmark scenarios", ""];
  for (const scenario of scenarios) {
    lines.push(`${scenario.id}  ${scenario.group}  ${scenario.description}`);
  }
  lines.push("");
  return lines.join("\n");
}
