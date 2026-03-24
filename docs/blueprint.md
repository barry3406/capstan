# Blueprint

Capstan's blueprint defines the path from today's seed repository to the full
framework. It exists to answer four questions at all times:

1. What are we building right now?
2. What does "done" mean for this milestone?
3. Which tests must exist before we move on?
4. What comes after this without changing direction?

## North Star

Capstan reaches its intended shape when a coding agent can:

1. take a short product brief
2. materialize or update an `App Graph`
3. scaffold and evolve a coherent application
4. verify that application through structured feedback
5. release it through machine-readable workflows
6. leave behind software that both humans and other agents can operate

That means Capstan's complete loop is:

`intent -> graph -> projection -> verification -> release -> operation -> evolution`

## System Map

Capstan has five kernels and one source of truth:

- `App Graph`: `Domain + Resource + Capability + Task + Policy + Artifact + View`
- `Graph`: modeling, validation, diffs, introspection
- `Harness`: execution host, tasks, memory, approvals, event stream
- `Surface`: human UI projection and AI control-plane projection
- `Feedback`: type checks, tests, assertions, evals, diagnostics
- `Release`: preview, deploy, health, rollback, traceability

## Completion Standard

Capstan is not complete when it can generate code. Capstan is complete when it
can reliably generate, verify, ship, and expose agent-operable software.

## Milestone Ladder

## Milestone 0: Foundation

Status:

- completed

Goal:

- establish the repo, naming, source-of-truth model, and first CLI loop

Core features:

- project manifesto and architecture docs
- `npm workspaces` monorepo
- first `App Graph` model
- graph validation CLI
- first graph-to-skeleton compiler

Primary packages:

- `packages/app-graph`
- `packages/compiler`
- `packages/cli`

Exit criteria:

- the repository has one obvious structure
- invalid graphs fail with clear diagnostics
- a valid graph can scaffold a deterministic application skeleton

Testing gates:

- unit: validator coverage for key uniqueness, reference checks, and empty-state guards
- unit: compiler coverage for generated file plans and naming transforms
- integration: CLI graph validation from JSON and ESM inputs
- integration: CLI scaffold command produces a compiling example app

## Milestone 1: Graph Kernel

Status:

- completed

Goal:

- make the `App Graph` stable enough to drive all later work

Core features:

- richer field types and constraints
- graph versioning
- graph normalization
- graph diffing
- machine-readable graph metadata
- graph introspection API

Primary packages:

- `packages/app-graph`
- `packages/cli`

Exit criteria:

- graphs can evolve with versioned changes
- Capstan can explain what changed between two graph revisions
- generated apps can consume normalized graph output instead of raw input

Testing gates:

- unit: normalization rules, diff algorithm, version upgrade helpers
- integration: CLI diff and inspect commands
- integration: graph upgrade path from older fixtures

## Milestone 2: Compiler Loop

Status:

- completed

Goal:

- turn the graph into a deterministic, low-entropy application substrate

Core features:

- stable application layout
- generated registries for resources, capabilities, tasks, policies, artifacts, and views
- generated coding-agent guide and starter prompt in scaffolded apps
- generated capability handlers and control plane
- template boundaries for hand-authored code versus generated code
- idempotent regeneration

Primary packages:

- `packages/compiler`
- `packages/cli`

Exit criteria:

- repeated scaffold runs are stable
- regeneration does not clobber user-owned code paths
- generated applications remain readable and type-safe

Testing gates:

- unit: template renderers and naming behavior
- unit: deterministic output snapshots
- integration: scaffold -> build -> typecheck loop for fixture graphs
- integration: regeneration tests over partially customized apps

## Milestone 3: Human Surface

Status:

- in progress
- projected routes, handler-backed actions, browser-level workflow coverage, policy-aware runtime states, and multi-resource human workflows are now live

Goal:

- project the graph into a usable human-facing application

Core features:

- web app shell
- list/detail/form projections for resources
- basic navigation and workspace layout
- capability-triggered actions
- placeholder policy-aware states
- generated empty/loading/error states

Primary packages:

- `packages/surface-web`
- `packages/compiler`
- `packages/cli`

Exit criteria:

- a generated application can support a real human workflow
- views are derived from graph semantics instead of ad hoc page code

Testing gates:

- unit: view projection helpers
- integration: generated web app boots and renders projected routes
- e2e: create/edit/list/detail flows on generated fixtures
- e2e: capability actions are reachable from the human surface

## Milestone 4: Agent Surface

Status:

- in progress
- generated control-plane discovery now includes `search`, `execute`, `task`, and `artifact` for local agent consumers
- local task runs now support `startTask`, `getTaskRun`, and `listTaskRuns` as the first task-lifecycle wedge
- task runs now expose richer stable statuses such as `approval_required`, `input_required`, and `blocked`
- task runs now persist artifact records, and artifact surfaces can resolve the latest produced payloads
- generated apps now also emit a standalone agent manifest projection for transport-friendly capability discovery
- generated transport adapters now support optional auth/policy hooks with `allow`, `approve`, `deny`, and `redact` decisions

Goal:

- make generated software natively consumable by agents

Core features:

- AI-first control plane with `search`, `execute`, `task`, and `artifact`
- capability discovery
- structured execution results
- task status model
- transport adapters for local use
- transport-level auth and policy hooks

Primary packages:

- `packages/surface-agent`
- `packages/compiler`
- `packages/cli`

Exit criteria:

- another agent can discover and invoke capabilities without scraping the UI
- actions and tasks expose stable semantics and errors

Testing gates:

- unit: capability search and matching behavior
- integration: execute path from generated control plane to capability handler
- integration: task lifecycle fixtures
- integration: transport auth hook fixtures
- e2e: agent-consumer workflow against a generated app

## Milestone 5: Feedback Kernel

Status:

- in progress
- `packages/feedback` now provides the first generated-app verify loop
- `capstan verify <app-dir> [--json]` now checks structure, surface contracts, TypeScript health, generated builds, generated assertions, and runtime smoke
- runtime smoke now exercises generated control-plane discovery/execution, transport discovery/execution, and human-surface browser mounting
- failure output now includes structured diagnostics and repair hints for coding agents
- the first broken-app e2e loop now proves Capstan can fail, explain, and then pass again after a repair
- generated apps now ship with graph-derived assertions plus a user-owned assertion hook for domain-specific regression checks

Goal:

- close the repair loop for coding agents

Core features:

- framework-level test runners
- structured diagnostics
- contract checks for capabilities and policies
- smoke tests for generated apps
- visual and behavior assertions
- eval harness for regressions

Primary packages:

- `packages/feedback`
- `packages/cli`

Exit criteria:

- Capstan can explain failures in a way that a coding agent can repair
- regressions are caught before release

Testing gates:

- unit: diagnostic formatters and assertion helpers
- integration: scaffold -> verify pipeline over fixture apps
- integration: failure snapshots and repair-oriented output
- integration: build and smoke verification over generated apps
- e2e: broken generated app fails with actionable diagnostics

## Milestone 6: Release Kernel

Status:

- in progress
- generated apps now emit `capstan.release.json`, `capstan.release-env.json`, `capstan.migrations.json`, plus a generated release module
- `capstan release:plan <app-dir> [--json]` now produces preview/release plans, safety gates, rollback steps, and trace metadata
- release plans now block when verify fails or required health checks/artifacts are missing
- release plans now also block on environment snapshot drift and unsafe or pending migration plans
- `capstan release:run <app-dir> <preview|release> [--json]` now executes framework-managed release steps and persists run traces under `.capstan/release-runs/`
- `capstan release:history` and `capstan release:rollback` now expose persisted run history and framework-managed rollback runs based on prior successful traces

Goal:

- make preview and release part of the framework contract

Core features:

- environment schema
- secret schema
- preview environments
- release plans
- release execution reports
- release history
- health checks
- rollback plans
- release traces

Primary packages:

- `packages/release`
- `packages/cli`

Exit criteria:

- generated apps can produce a machine-readable release contract
- Capstan can block unsafe release attempts before deployment
- release plans can reason about environment inputs and migration safety before promotion
- Capstan can execute a framework-managed preview or release run and persist a trace artifact
- Capstan can select a prior successful run as a rollback source and persist a rollback trace

Testing gates:

- unit: environment and release plan validation
- integration: preview plan generation for fixture apps
- integration: health and rollback contract checks
- integration: release-run execution and trace persistence
- integration: release history and rollback source selection
- e2e: preview and simulated release flow

## Milestone 7: Harness Runtime

Status:

- in progress
- `packages/harness` now provides a first durable task host with persisted run state under `.capstan/harness/runs/`
- harness events now stream into `.capstan/harness/events.ndjson` and can be replayed into consistent run state
- CLI commands now support `harness:start`, `harness:list`, `harness:get`, `harness:pause`, `harness:resume`, `harness:request-approval`, `harness:approve`, `harness:request-input`, `harness:provide-input`, `harness:complete`, `harness:fail`, `harness:cancel`, `harness:retry`, `harness:events`, and `harness:replay`
- harness runs now support explicit `input_required` checkpoints so human operators can attach structured follow-up input before resuming agent work
- harness runs can now be compacted into persisted summaries under `.capstan/harness/summaries/` so long histories can be handed back to agents as bounded runtime context
- persisted summaries can now be read back, listed across runs, and promoted into runtime memory artifacts under `.capstan/harness/memory/`
- summary and memory reads now auto-refresh when newer runtime events exist, and list views expose freshness so operators can spot stale runtime context

Goal:

- turn Capstan from a compiler-centric system into a real agent runtime

Core features:

- task lifecycle host
- durable execution
- pause/resume
- retries and replay
- approvals and human handoff
- memory/compaction boundaries
- event stream for external operators

Primary packages:

- `packages/harness`
- `packages/cli`

Exit criteria:

- long-running tasks survive process boundaries
- humans can inspect, intervene, and resume agent work
- runtime events are structured and replayable

Testing gates:

- unit: state-machine transitions and event serialization
- integration: durable task replay and retry flows
- integration: approval checkpoints and intervention paths
- e2e: long-running workflow with interruption and recovery

## Milestone 8: Multi-Surface Interop

Status:

- in progress
- generated agent manifests now advertise both the existing in-process transport and a first preview `http_rpc` projection
- generated apps now emit `src/agent-surface/http.ts`, which maps HTTP and RPC-shaped requests onto the stable agent transport runtime
- the first protocol-facing wedge reuses existing transport auth and execution semantics instead of forking a second runtime path
- generated manifests now also advertise preview `mcp` and `a2a` projections
- generated apps now emit `src/agent-surface/mcp.ts` and `src/agent-surface/a2a.ts`, both of which reuse the same control-plane runtime
- cross-protocol tests now prove one generated app can be invoked consistently through HTTP, MCP, and A2A-shaped adapters

Goal:

- expose Capstan applications through multiple agent-consumable protocols

Core features:

- MCP projection
- A2A projection
- HTTP/RPC projection
- transport-level auth hooks
- protocol-level capability discovery

Primary packages:

- `packages/surface-agent`
- `packages/harness`
- `packages/release`

Exit criteria:

- the same application graph can drive multiple external control-plane surfaces
- protocol adapters stay projections, not alternate sources of truth

Testing gates:

- unit: adapter serializers and protocol mapping logic
- integration: generated app exposed through each transport
- e2e: cross-protocol capability invocation against one fixture app

## Milestone 9: Reusable Building Blocks

Status:

- in progress
- `packages/packs-core` now provides the first deterministic pack kernel for graph composition
- built-in `auth`, `tenant`, `workflow`, `connector`, `billing`, `commerce`, and `revenueOps` packs now expand graphs into reusable resources, capabilities, tasks, policies, artifacts, and views
- graph commands can now load external pack registries through `--pack-registry`, so custom packs can participate in the same deterministic composition loop
- graph modules can now export inline `packRegistry` / `packs`, so one module can carry both a graph and its custom extensions
- `packages/packs-core` now exposes `createDurableEntityPack` and `createLinkedEntityPack`, public pack authoring DSLs for single-resource and linked multi-resource durable packs
- CLI inspect/scaffold flows now operate on pack-expanded graphs, and generated apps can be scaffolded from a graph plus reusable packs
- workflow-packed apps now prove reusable packs can contribute durable task and artifact behavior, not just CRUD structure
- connector-packed apps now prove reusable packs can contribute external sync tasks and sync-report artifacts through the same runtime
- billing-packed apps now prove reusable packs can contribute multi-resource subscription and invoice flows plus collection receipts through the same runtime
- commerce-packed apps now prove reusable packs can contribute multi-resource catalog and order flows plus fulfillment receipts through the same runtime
- revenue-ops-packed apps now prove starter packs can layer on top of multiple dependent domain packs and still expose one durable runtime surface through the same declarative pack model

Goal:

- make Capstan composable across domains

Core features:

- auth pack
- organization/tenant pack
- workflow pack
- connector pack
- domain starter packs
- extension model

Primary packages:

- `packages/packs-*`
- `packages/compiler`
- `packages/cli`

Exit criteria:

- a new application can be composed from graph primitives and reusable packs
- packs remain deterministic and testable

Testing gates:

- unit: pack composition rules
- integration: scaffolded apps from multiple pack combinations
- e2e: end-to-end flows on at least two distinct domain packs

## Milestone 10: Full Capstan

Status:

- in progress
- `packages/brief` now provides the first deterministic brief model for short product descriptions
- CLI commands now cover `brief:check`, `brief:inspect`, `brief:graph`, and `brief:scaffold`
- brief compilation now produces pack-aware App Graphs that can flow directly into scaffolded applications
- brief compilation now also infers built-in packs from higher-level `application.profile` and `application.modules` hints
- inferred module selections can now carry pack options, so brief authors can tune starter modules without dropping into raw `packs`
- starter briefs can now rely entirely on inferred packs without declaring explicit entities or raw pack keys
- brief modules can now also export inline `packRegistry` / `packs`, so product intent and custom extension packs can travel together
- brief entities can now use local relation shorthand, so richer domain structure fits inside shorter product briefs
- brief-derived capability schemas now also drive human-surface field projection, so generated forms and views follow the same relation-aware defaults
- brief-derived relations now also expand into default write-input schemas, so generated forms capture linked-resource references without extra manual schema work
- generated human surfaces now also project related-record links from resource relations, so cross-resource navigation starts to emerge from the same brief-driven graph
- generated human surfaces now also project relation-scoped list/detail routes from resource relations, so target-resource capability/view skeletons stay tied to source-resource context by default
- generated agent surfaces now also project resource and relation skeletons, and local/transport control planes expose a `resource` query for machine-readable cross-resource navigation
- generated route actions now also carry machine-readable `execution` contracts, and local/transport control planes expose `executeAction` so relation-scoped actions can be invoked with explicit route context
- task-backed route actions now also carry machine-readable `taskStart` contracts, and local/transport control planes expose `startTaskAction` so durable workflow runs inherit the same route and relation scope
- durable task-backed route actions now also project harness-aware `workflow` starter recipes, so agents can discover observe/recover commands and relation-scoped starter input envelopes before a run exists
- generated workflow projections now also expose `getWorkflowRun`/`advanceWorkflowRun` control-plane contracts, so local and transport adapters can supervise approval, input, retry, and cancel transitions without dropping to CLI orchestration
- generated workflow projections now also expose `listWorkflowRuns` discovery contracts with route-aware default filters, so agents can find runs waiting on approval, input, retry, or block resolution before targeting one run id
- generated `task()` results now also expose `workflowAttention` summaries for durable tasks, so agents can detect blocked approvals/input/retry work from a task-level query before enumerating individual runs
- generated `search()` task hits now also carry those `workflowAttention` summaries, so task discovery can surface stuck durable work without a separate `task()` read
- generated `resource()` results now also expose resource-scoped workflow attention queues, so route-contextual durable runs can be supervised from the resource surface they belong to
- those `workflowAttention` summaries now also carry grouped queue lanes, so task/resource/search reads can surface approval/input/block/failure slices directly
- generated control planes now also expose a top-level `listAttentionItems` inbox, so agents can enumerate attention-worthy workflow runs across tasks and resource scopes before targeting a specific task or route
- durable workflow projections now also expose route-aware `attention` inbox presets, so agents can reuse machine-readable `listAttentionItems` filters directly from the route action recipe
- generated control planes now also expose grouped `listAttentionQueues` views, and durable workflow projections advertise route-aware queue presets so agents can discover approval/input/block/failure lanes without post-processing raw inbox items
- generated human surfaces now also project those durable route-aware attention queue lanes and open them against shared control-plane workflow state, so operators can supervise live approval/input/block work from the same route shell
- generated human operator consoles now also expose a top-level attention inbox plus grouped queue lanes, so humans can discover stuck durable work globally before drilling into one route
- those human operator consoles now also project task-scoped and resource-scoped attention presets, so operators can jump from the global inbox into reusable supervision lanes without rebuilding filters by hand
- those operator consoles now also project route-scoped attention presets, so humans can keep drilling from global or resource-level supervision into one concrete route flow before using the route-local attention lanes
- those route-scoped presets now also hand off breadcrumb context into the route-local attention result surface, inheriting related task/resource preset context so human supervision retains its upper-level trail while drilling down
- those route-local attention breadcrumbs now also expose clickable handoff controls, so operators can reopen the exact parent task/resource/route preset from the place where they inspected one queue lane
- those human operator consoles now also pin the active attention trail into a reusable supervision workspace, so the same preset can be refreshed or reopened after route changes and global inbox detours
- those pinned supervision workspaces now also keep a small saved history with resume and clear controls, so humans can recover older attention trails without rebuilding them
- those saved supervision workspaces now also persist through browser reloads, so the generated human surface can restore the active trail and its history without recomputing filters by hand
- those persisted supervision workspaces now also expose fixed named slots, so operators can save, reopen, clear, and switch a few durable attention lanes without depending on recency ordering alone
- those named slots now also auto-fill from task/resource/route attention presets via a fixed Primary/Secondary/Watchlist mapping, while manual slot saves remain sticky until an operator replaces or clears them
- those named slots now also project live attention summaries, new-since-open deltas, and highest-priority queue shortcuts, so operators can see which persistent lane is hot and which one changed before reopening the whole workspace
- the first revenue-ops SaaS brief fixture now proves `brief -> graph -> app` works on top of reusable packs

Goal:

- achieve the full harness-first framework loop

Core features:

- brief-to-graph workflow
- graph-to-app projection
- human and agent surfaces
- durable harness runtime
- feedback and release kernels
- reusable packs
- agent-readable repository and runtime

Exit criteria:

- a short brief can become a working application
- humans can use the application
- agents can operate the application
- future agents can safely evolve the application through Capstan itself

Testing gates:

- unit: all core kernels maintain required coverage thresholds
- integration: end-to-end pipeline from graph to release
- e2e: full lifecycle scenarios across at least three fixture domains
- system: performance, determinism, and upgrade-path regression suites

## Current Priorities

The critical path from today's state is:

1. deepen the brief-to-graph wedge so short product briefs can express richer domain structure
2. keep generated human and agent surfaces deterministic as briefs and packs compose
3. strengthen the agent repair loop across brief, graph, scaffold, verify, and release
4. keep determinism and upgrade-path regressions green

## Build Order Rule

Capstan should always prefer the next milestone that:

1. reduces ambiguity in the source of truth
2. makes generated software more deterministic
3. improves the agent repair loop
4. strengthens release confidence

If a feature does not improve one of those, it is probably not on the critical
path.
