# Core Architecture

## Source Of Truth

Capstan's current source-of-truth vocabulary is:

`Domain + Resource + Capability + Task + Policy + Artifact + View`

Each element has a distinct role:

- `Domain`: the bounded business space and its language
- `Resource`: stable entities and their relations
- `Capability`: executable business actions with semantics
- `Task`: long-running or stateful executions
- `Policy`: rules for access, approval, redaction, and budget
- `Artifact`: durable outputs produced by the system
- `View`: human-facing projections of the graph

## Kernel 1: Graph

The graph kernel defines and materializes the shared application contract.

Responsibilities:

- application schema
- resource and capability registry
- dependency graph
- machine-readable project index
- projection inputs for human and machine surfaces

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

The surface kernel exposes the application to humans and other agents through
shared runtime contracts.

Responsibilities:

- machine-facing execution and discovery surfaces such as HTTP, MCP, A2A, and OpenAPI
- generated agent-operating contracts in scaffolded apps, including `AGENTS.md` guidance and starter prompts
- operator-facing projections for inspection, approval, input handoff, retry, and supervision
- shared attention, queue, and drill-down semantics over durable work
- search and execution entry points over the same underlying runtime state

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

1. Read the contract
2. Plan a change
3. Execute through the harness
4. Verify through feedback
5. Release through structured workflows
6. Expose updated surfaces to humans and agents

## Open Questions

- What is the smallest useful shared contract artifact?
- Which parts of the contract are hand-authored versus generated?
- How should capabilities map to tasks and artifacts?
- What is the default human supervision model?
- What is the first runtime Capstan should target?
