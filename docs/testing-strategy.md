# Testing Strategy

Capstan needs a stronger test discipline than a typical framework because it
has two products at once:

- the framework itself
- the applications the framework generates

That means we do not only test package internals. We also test whether generated
software remains correct, stable, and agent-operable.

## Test Layers

## Unit Tests

Purpose:

- protect local logic inside a single package or module

Typical targets:

- graph validation rules
- naming and normalization utilities
- compiler template functions
- task state-machine transitions
- release plan validators
- protocol adapters

Expected traits:

- fast
- deterministic
- no network
- minimal fixture setup

## Integration Tests

Purpose:

- verify a Capstan package boundary or command boundary end to end

Typical targets:

- CLI commands over fixture graphs
- graph -> compiler -> generated app build
- generated control plane -> capability handler
- feedback pipeline over broken fixtures
- release planning over fixture apps

Expected traits:

- uses fixture graphs and fixture apps
- may touch the filesystem
- focuses on behavior across modules

## End-To-End Tests

Purpose:

- verify real operator flows from the outside

Typical targets:

- scaffold an app and run the human UI
- run capability actions through the generated control plane
- execute a long-running task with pause/resume
- preview and release a generated application

Expected traits:

- black-box mindset
- exercise generated output, not just framework internals
- validate both human and agent surfaces

## Test Assets

Capstan should maintain explicit fixtures instead of ad hoc sample files.

Recommended layout:

- `tests/fixtures/graphs`: minimal graph inputs
- `tests/fixtures/apps`: expected generated outputs or golden examples
- `tests/unit`: package-local unit suites
- `tests/integration`: CLI, compiler, and package-boundary suites
- `tests/e2e`: full generated-app workflows

## Proposed Tooling

For the TypeScript-first stage:

- unit and integration: `vitest`
- end-to-end browser flows: `playwright`
- snapshot support: built into `vitest`
- coverage: `vitest --coverage`

The tooling can change later, but the test layers should not.

## Milestone Coverage Matrix

## Milestone 0: Foundation

Required tests:

- unit tests for `validateAppGraph`
- unit tests for compiler naming and path generation
- integration tests for `graph:check`
- integration tests for `graph:scaffold`
- integration test that scaffolded output typechecks

Release gate:

- no milestone promotion without at least one compiling generated fixture app

## Milestone 1: Graph Kernel

Required tests:

- unit tests for normalization and diffing
- integration tests for version upgrades
- snapshot tests for normalized graph output

Release gate:

- graph upgrades must be deterministic across fixtures

## Milestone 2: Compiler Loop

Required tests:

- snapshot tests for generated file plans
- integration tests for idempotent regeneration
- integration tests for protected user-owned code regions
- integration tests for scaffolded `AGENTS.md` guidance and official starter prompt output

Release gate:

- two consecutive scaffold runs over the same graph produce the same generated output

## Milestone 3: Human Surface

Required tests:

- integration tests for projected routes
- integration tests for relation-scoped route navigation from generated related-record links
- e2e CRUD flows on generated fixtures
- e2e action flows from generated views
- browser-level generated-surface tests that assert route/result projection after real handler execution

Release gate:

- at least one generated app can support a complete human workflow

## Milestone 4: Agent Surface

Required tests:

- integration tests for `search`, `execute`, `task`, and `artifact`
- integration tests for generated `resource` discovery and relation-aware resource projections
- integration tests for generated `executeAction` route contracts and relation-aware action execution context
- integration tests for generated `startTaskAction` route contracts and relation-aware task-run context
- integration tests for generated `workflow` starter recipes and relation-aware harness supervision envelopes
- integration tests for generated `getWorkflowRun` and `advanceWorkflowRun` control-plane contracts across local and transport adapters
- integration tests for generated `listWorkflowRuns` discovery contracts and attention-scoped workflow filtering across local and transport adapters
- integration tests for durable-task `workflowAttention` summaries exposed through `task()` queries
- integration tests for search results that surface durable-task `workflowAttention` summaries
- integration tests for resource results that surface route-scoped workflow attention queues
- integration tests for task/search/resource attention summaries that now also surface grouped queue lanes
- integration tests for top-level `listAttentionItems` inbox queries across local and transport adapters
- unit and integration tests for durable workflow projections that expose route-aware inbox presets
- integration tests for grouped `listAttentionQueues` results and route-aware queue presets
- unit and integration tests for generated human surfaces that project durable route-aware attention queue lanes and open live queue payloads from the browser runtime
- unit and integration tests for generated human operator consoles that expose a top-level attention inbox and grouped queue lanes
- unit and integration tests for generated human operator consoles that surface task-scoped and resource-scoped attention presets over the same runtime state
- unit and integration tests for generated human operator consoles that surface route-scoped attention presets and route drill-down behavior
- unit and integration tests for multi-level task/resource/route handoff breadcrumbs carried into route-local attention lane payloads and UI
- unit and integration tests for reopening parent presets from route-local handoff controls without rebuilding the filter by hand
- unit and integration tests for pinned supervision workspace presets that survive global attention detours and refresh the same trail
- unit and integration tests for saved supervision workspace history, including resume and clear flows
- integration tests for restoring persisted supervision workspace history across browser reloads
- unit and integration tests for named supervision workspace slots, including save/open/clear flows and reload restore behavior
- unit and integration tests for auto-assigned workspace slots, including task/resource/route preset mapping and manual override persistence
- unit and integration tests for slot attention summaries, including highest-priority queue shortcuts, new-since-open deltas, seen-state reset on reopen, and post-clear refresh behavior
- contract tests for capability discovery and execution errors
- e2e agent-consumer flow over a generated app
- integration tests for generated local control-plane task/artifact discovery
- integration tests for generated local task-run lifecycle transitions
- integration tests for artifact records produced from task runs
- unit and integration tests for generated agent manifest projections
- integration tests for transport auth hooks and policy-aware decisions

Release gate:

- an external consumer can discover and invoke generated capabilities without UI scraping

## Milestone 5: Feedback Kernel

Required tests:

- integration tests for `verify` pipelines
- golden tests for failure diagnostics
- e2e broken-app scenarios with actionable output
- unit tests for TypeScript diagnostic parsing and hint generation
- integration tests for `capstan verify --json` success and failure flows
- integration tests for generated build and smoke verification
- integration tests for generated and custom assertion runtimes
- integration tests for generated transport and human-surface behavior smoke
- e2e scaffold -> break -> verify -> repair -> verify flows for generated apps

Release gate:

- Capstan must turn common failures into structured, repairable diagnostics

## Milestone 6: Release Kernel

Current wedge:

- generated release contract validation
- integration coverage for `capstan release:plan`
- e2e ready -> blocked -> ready simulated release flow
- environment drift detection for preview/release inputs
- migration safety blocking for pending or unsafe release plans
- `capstan release:run` execution coverage and persisted release traces
- release history listing and rollback-source selection from persisted traces

Required tests:

- unit tests for release contracts
- integration tests for preview and rollback planning
- integration tests for custom release input paths and drift conditions
- integration tests for release execution and trace persistence
- integration tests for release history and rollback selection
- e2e simulated release flow

Release gate:

- preview and release plans must be validated before any deploy path is considered done

## Milestone 7: Harness Runtime

Current wedge:

- durable task runs persisted under `.capstan/harness/runs/`
- structured NDJSON event streams under `.capstan/harness/events.ndjson`
- CLI coverage for pause/resume, approval, input handoff, completion, failure, cancellation, retry, and replay
- replay checks that persisted events reconstruct the same run state after interruption
- compaction coverage persists bounded runtime summaries under `.capstan/harness/summaries/`
- runtime memory coverage persists agent-readable memory artifacts under `.capstan/harness/memory/`
- freshness coverage proves persisted summaries and memories refresh themselves after later lifecycle events

Required tests:

- unit tests for task lifecycle transitions
- integration tests for retries, replay, and approvals
- e2e interrupted workflow recovery

Release gate:

- long-running tasks must survive interruption and continue safely

## Milestone 8: Multi-Surface Interop

Current wedge:

- generated manifests now advertise local plus preview `http_rpc`, `mcp`, and `a2a` transports
- generated apps now emit `src/agent-surface/http.ts`, `src/agent-surface/mcp.ts`, and `src/agent-surface/a2a.ts`
- integration coverage now exercises REST-like paths and `/rpc` requests, MCP tool calls, and A2A message sends against generated apps
- e2e coverage now proves one generated app reuses the same semantic runtime across HTTP, MCP, and A2A projections

Required tests:

- unit tests for projection metadata and generated transport descriptors
- integration tests for HTTP/RPC request mapping and response shaping
- integration tests for MCP tool mapping and response shaping
- integration tests for A2A message mapping and task/result shaping
- e2e protocol invocation against a generated app

Release gate:

- every new protocol projection must reuse the same semantic runtime as the local transport

## Milestone 8+: Full-System Confidence

Required tests:

- cross-protocol interop suites
- upgrade-path regressions
- determinism regressions
- performance baselines for large graphs and large generated apps

Release gate:

- no new protocol or pack ships without at least one generated-app e2e scenario

## Milestone 9: Reusable Building Blocks

Current wedge:

- `packages/packs-core` now provides pack selection, dependency resolution, deterministic composition, and conflict detection
- built-in `auth`, `tenant`, `workflow`, `connector`, `billing`, `commerce`, and `revenueOps` packs now expand graphs before CLI validation, inspection, and scaffolding
- integration and e2e coverage now exercise one external pack registry loaded through `--pack-registry`
- integration and e2e coverage now also exercise one graph module that exports an inline pack registry
- unit coverage now exercises the public `createDurableEntityPack` and `createLinkedEntityPack` authoring DSLs directly
- integration coverage now proves one packed graph can scaffold, build, and typecheck as a generated app
- e2e coverage now proves pack-provided capabilities, tasks, artifacts, and views are exposed through generated app surfaces

Required tests:

- unit tests for pack dependency resolution and collision rules
- integration tests for packed graph inspection and scaffold flows
- e2e tests for one generated app composed from reusable packs

Release gate:

- a reusable pack must be composable, deterministic, and verifiable through generated-app tests

## Milestone 10: Brief-To-App

Current wedge:

- `packages/brief` now provides a deterministic brief model and compiler for short product briefs
- unit coverage now exercises brief validation, compile defaults, pack inference, and pack-aware policy derivation
- integration coverage now exercises `brief:check`, `brief:graph`, and `brief:scaffold`
- integration coverage now also exercises inferred-pack inspection from brief-level application hints and module-level pack options
- integration coverage now also exercises zero-entity starter briefs that compile entirely through inferred packs
- integration coverage now also exercises ESM brief modules that carry inline custom pack registries
- unit and integration coverage now also exercise local relation shorthand inside brief entities
- unit coverage now also proves generated human-surface routes prefer capability schemas over raw resource fields
- integration coverage now also proves scaffolded brief apps project relation-derived write inputs into generated forms
- unit and integration coverage now also prove scaffolded human surfaces emit related-record links from graph relations
- brief fixtures now prove one short SaaS brief can compile into a pack-expanded graph and a generated app that still builds and typechecks

Required tests:

- unit tests for brief validation and compile-time naming/default rules
- integration tests for `brief:*` CLI commands
- integration or e2e tests for `brief -> scaffold -> build/typecheck`

Release gate:

- a short brief must compile deterministically into a valid App Graph and a verifiable generated app

## Quality Rules

- Every bug fix should add or tighten at least one automated test.
- Every new graph feature should have fixture coverage.
- Every new compiler feature should have deterministic snapshot coverage.
- Every new surface should have at least one black-box end-to-end test.
- Generated example apps are test assets, not just demos.

## First Test Wave

The next practical testing wave should add:

1. deeper CRUD fixtures with multiple resource-scoped capabilities on the generated human surface
2. integration tests for generated control-plane execution paths
3. regression fixtures for graph upgrade and regeneration stability
4. snapshot coverage for richer graph and compiler fixtures
5. browser-level smoke tests for generated applications that also cover policy-aware states
