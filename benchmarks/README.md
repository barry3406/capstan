# Benchmark Suite

Capstan keeps its committed performance waterline in this directory.

## Commands

- `npm run perf` — run the full suite and print a human-readable table
- `npm run perf:check` — run the full suite and fail when a scenario exceeds its budget
- `npm run perf:list` — list the committed scenario ids

## Structure

- `harness.ts` — benchmark runner, summaries, and budget evaluation
- `budgets.ts` — committed latency budgets for every scenario
- `fixtures.ts` — synthetic runtime and router fixtures
- `scenarios.ts` — the benchmark scenarios that define the performance contract
- `baseline.ts` — committed reference latencies used for scenario and group trend deltas
- `summary.ts` — CI-friendly Markdown summaries for perf reports
- `run.ts` — CLI entry point used by local scripts and CI

## Budget Profiles

Budgets are machine-readable contracts, and some scenarios can define
runtime-specific overrides for constrained environments such as the
`ubuntu-latest` 4-vCPU CI runner.

- Keep the default budget as the primary contract.
- Only add overrides when a scenario is deterministic but hardware-class drift
  would otherwise cause persistent false failures.
- Scope overrides narrowly with explicit runtime matchers such as platform,
  architecture, CPU count, or Node major version.

## Working Rules

- Keep scenarios synthetic and deterministic.
- Measure framework overhead, not network or external service latency.
- Keep both hot-path and super-complex scenarios in the committed suite.
- Keep incremental rebuild scenarios alongside full scans when dev ergonomics are a goal.
- Every committed scenario must have a budget.
- Every committed scenario should have a baseline so trend deltas stay meaningful.
- Budget changes should be reviewed like runtime contract changes.
- Prefer adding a focused scenario over making one benchmark try to prove everything.
