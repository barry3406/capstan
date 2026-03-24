# Roadmap

## Planning Rule

Capstan should grow by closing one complete loop at a time.

The first loop is:

1. A human provides a short product or workflow brief
2. A coding agent instantiates a Capstan application
3. Capstan verifies that application with structured feedback
4. A human can use the resulting software
5. Another agent can consume the same application's capabilities
6. The application can be previewed and released through a structured flow

If a milestone does not make that loop more real, it is not on the critical
path.

## 0-1

The 0-1 milestone is not "build the full framework". It is "prove the
harness-first application model works end-to-end".

### Scope

- TypeScript-first implementation
- `npm workspaces` monorepo
- One source of truth: `App Graph`
- One CLI entry point
- One local harness-friendly developer flow
- One AI-first control plane abstraction
- One preview and verification path

### Milestone 1: Source Of Truth

Deliverables:

- a minimal `App Graph` model
- graph validation rules
- stable naming for `Domain`, `Resource`, `Capability`, `Task`, `Policy`,
  `Artifact`, and `View`
- a machine-readable graph contract that both humans and agents can inspect

Exit criteria:

- Capstan can reject malformed graphs with useful diagnostics
- coding agents can discover the current application shape without reading
  prose docs first

### Milestone 2: Local Compiler Loop

Deliverables:

- graph-to-code projection plan
- generated stubs for resources, capabilities, tasks, and views
- a predictable repo layout for generated applications

Exit criteria:

- a short brief can be turned into a deterministic project skeleton
- generated code follows one obvious path

### Milestone 3: Human Surface

Deliverables:

- basic human-facing projection for resource list/detail/form flows
- capability-triggered actions
- policy-aware UI placeholders

Exit criteria:

- a human can use the generated application for a real workflow

### Milestone 4: Agent Surface

Deliverables:

- AI-first `search`, `execute`, `task`, and `artifact` entry points
- low-entropy capability discovery
- structured action execution results

Exit criteria:

- another agent can safely discover and invoke application capabilities without
  scraping the UI

### Milestone 5: Verification Loop

Deliverables:

- schema checks
- type checks
- capability contract checks
- permission checks
- smoke tests
- structured diagnostics

Exit criteria:

- Capstan can tell an agent what failed, where it failed, and what changed

### Milestone 6: Preview And Release

Deliverables:

- preview environment contract
- environment and secret schema
- release checks
- health checks
- rollback plan

Exit criteria:

- a generated application can be previewed and released with a machine-readable
  flow

### 0-1 Success Definition

Capstan 0-1 succeeds when Claude Code can take a short brief and use Capstan to
produce an application that:

- humans can operate
- agents can consume through native capabilities
- Capstan can validate and inspect
- Capstan can preview and release

## 1-100

The 1-100 path turns Capstan from a promising system into a durable platform.

### Phase 1: Stronger Graph

- richer type system for resources and capabilities
- graph versioning
- graph diffs and migrations
- graph introspection APIs

### Phase 2: Real Harness Runtime

- durable tasks
- pause and resume
- retries and replay
- approval checkpoints
- human handoff
- memory and compaction

### Phase 3: Multi-Surface Projection

- human web surface
- AI control plane
- MCP projection
- A2A projection
- HTTP or RPC adapters

### Phase 4: Self-Repairing Feedback

- regression evals
- visual checks
- impact analysis
- policy reasoning
- guided repair hints for coding agents

### Phase 5: Structured Release Kernel

- rollout strategies
- rollback automation
- deployment traceability
- environment drift checks
- migration safety gates

### Phase 6: Reusable Building Blocks

- domain packs
- auth packs
- billing packs
- connector packs
- workflow packs

### Phase 7: Full Capstan Loop

At maturity, Capstan should support this native cycle:

1. A human provides an intent
2. A coding agent updates the graph and projections
3. The harness executes and verifies the change
4. Capstan releases the application safely
5. Humans use the system
6. Other agents consume the same system through AI-first surfaces
7. Future agents continue evolving the software through the same loop
