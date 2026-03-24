# Core Architecture

## Source Of Truth

Capstan's source of truth is the `App Graph`.

The current working model is:

`App Graph = Domain + Resource + Capability + Task + Policy + Artifact + View`

Each element has a distinct role:

- `Domain`: the bounded business space and its language
- `Resource`: stable entities and their relations
- `Capability`: executable business actions with semantics
- `Task`: long-running or stateful executions
- `Policy`: rules for access, approval, redaction, and budget
- `Artifact`: durable outputs produced by the system
- `View`: human-facing projections of the graph

## Kernel 1: Graph

The graph kernel defines and materializes the application model.

Responsibilities:

- application schema
- resource and capability registry
- dependency graph
- machine-readable project index
- projection inputs for UI and agent surfaces

## Kernel 2: Harness

The harness kernel runs agent work against the application.

Responsibilities:

- task lifecycle
- tool execution
- shell, browser, and runtime coordination
- memory and compaction
- approvals and interventions
- event streaming

## Kernel 3: Surface

The surface kernel exposes the application to operators.

Responsibilities:

- AI-first action and task surfaces
- generated agent-operating contracts in scaffolded apps, including `AGENTS.md` workflow guidance and starter prompts for coding agents
- recoverable workflow recipes plus workflow control-plane supervision, discovery, inbox presets, grouped queue presets, top-level inbox/queue queries, and task/search/resource-level attention summaries with embedded queue lanes for durable runs
- human-facing projections, including route-aware attention queue lanes plus top-level, task-scoped, resource-scoped, and route-scoped operator inbox presets backed by the same generated workflow state, preserving inherited task/resource/route handoff breadcrumbs during drill-down, reopening those parent presets directly from route-local supervision, and pinning reusable supervision workspace presets plus saved workspace history and named slots that survive browser reloads in the console, including fixed auto-save slot mappings with sticky manual overrides plus live slot summaries, new-since-open deltas, and highest-priority queue shortcuts
- protocol adapters such as HTTP, MCP, or A2A
- search and execution entry points

## Kernel 4: Feedback

The feedback kernel closes the repair loop.

Responsibilities:

- type and schema validation
- tests and assertions
- runtime diagnostics
- evals and regression checks
- structured error reporting

## Kernel 5: Release

The release kernel turns application state into operable software.

Responsibilities:

- environment schema
- secret requirements
- migrations
- preview environments
- health checks
- rollout and rollback

## Golden Loop

Capstan should make this loop native:

1. Read the graph
2. Plan a change
3. Execute through the harness
4. Verify through feedback
5. Release through structured workflows
6. Expose updated surfaces to humans and agents

## Open Questions

- What is the smallest useful `App Graph` representation?
- Which parts of the graph are hand-authored versus generated?
- How should capabilities map to tasks and artifacts?
- What is the default human supervision model?
- What is the first runtime Capstan should target?
