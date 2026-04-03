# Blueprint

Capstan's blueprint defines the execution order from today's repository to the
intended product shape. It exists to answer four questions at all times:

1. What are we building right now?
2. What does done mean for the current milestone?
3. Which tests must exist before we move on?
4. What comes next without changing direction?

## North Star

Capstan reaches its intended shape when a coding agent can:

1. read a change request, workflow description, or short brief
2. discover the application's machine-readable contract
3. scaffold or evolve a coherent application
4. execute and recover work through the harness
5. verify the result through structured diagnostics
6. release it through machine-readable workflows
7. leave behind software that both humans and other agents can operate

That means Capstan's complete loop is:

`intent -> contract -> execution -> verification -> release -> operation -> evolution`

## System Map

Capstan has five kernels and one source of truth:

- `Source of truth`: `Domain + Resource + Capability + Task + Policy + Artifact + View`
- `Graph`: contract modeling, validation, introspection, diffs, projections
- `Harness`: execution host, durable runs, memory, approvals, event streams
- `Surface`: human operator surfaces and machine control-plane surfaces
- `Feedback`: type checks, tests, assertions, diagnostics, repair guidance
- `Release`: build outputs, environment contracts, migrations, rollout, rollback

## Completion Standard

Capstan is not complete when it can generate code.
Capstan is complete when it can reliably describe, execute, verify, recover,
release, and supervise agent-operable software.

## Current Execution Order

### Milestone 1: Contract Convergence

Status:

- in progress

Goal:

- establish one coherent application contract that runtime, scaffolder,
  verifier, and generated surfaces all agree on

Core features:

- shared vocabulary for resources, capabilities, tasks, policies, artifacts,
  and views
- stable manifests and projection inputs
- contract snapshots, diffs, and introspection
- reduced drift between file-based apps, generated apps, runtime behavior, and
  verification

Exit criteria:

- the same contract can drive runtime behavior, generated surfaces, and verify
- protocol adapters do not silently fork capability semantics
- generated artifacts stay aligned with the contract they were built from

Testing gates:

- unit: contract normalization, naming, and diff stability
- integration: scaffold/change/verify loops over fixture apps
- integration: manifest/runtime/projection agreement checks

### Milestone 2: Operator Surfaces

Status:

- in progress

Goal:

- provide a first-party operator surface built from the same contracts that
  agents use

Core features:

- generated human surface from capabilities, tasks, policies, approvals,
  artifacts, and views
- top-level attention inbox plus grouped queue lanes for durable work
- task-scoped, resource-scoped, and route-scoped supervision drill-down
- action execution, approval, provide-input, retry, cancel, and inspect flows
- later, focused embeddable control-plane widgets

Exit criteria:

- a human operator can discover and supervise durable work without rebuilding
  filters by hand
- operator surfaces stay projections of shared runtime state, not a second
  source of truth
- human and agent execution paths remain contract-compatible

Testing gates:

- integration: generated human surface route and action projections
- integration: attention inbox and queue-lane behavior
- integration: route-scoped drill-down and breadcrumb continuity
- e2e: operator flow across inspect, approve, provide-input, retry, and resume

### Milestone 3: Durable Harness

Status:

- in progress

Goal:

- make the harness a dependable runtime for long-running agent work

Core features:

- durable runs, checkpoints, artifacts, and event streams
- approvals, input requests, retries, replay, and recovery semantics
- browser, shell, filesystem, and memory coordination
- recurring execution for agent jobs

Exit criteria:

- long-running work can survive process boundaries and operator intervention
- harness state is inspectable by both operators and coding agents
- recovery and replay semantics are explicit rather than best-effort

Testing gates:

- unit: state-machine transitions and recovery helpers
- integration: checkpoint, approval, input, retry, and replay flows
- integration: browser and filesystem sandbox boundary behavior
- e2e: interrupted run that resumes and converges

### Milestone 4: Feedback And Repair

Status:

- in progress

Goal:

- make common failures structured, actionable, and repairable for coding agents

Core features:

- contract, runtime, and projection verification
- generated-app assertions and runtime smoke checks
- structured failure categories and repair hints
- regression coverage for durable runs and supervised operator flows

Exit criteria:

- Capstan can explain common failures without forcing manual log archaeology
- verify output is actionable enough for an agent to converge
- generated-app regressions are caught before release

Testing gates:

- integration: `capstan verify --json` success and failure flows
- golden: structured diagnostic output and repair checklist snapshots
- integration: generated build, manifest, and runtime smoke verification
- e2e: scaffold -> break -> verify -> repair -> verify

### Milestone 5: Structured Release

Status:

- partially shipped

Goal:

- turn release into an explicit framework contract instead of a post-build
  afterthought

Core features:

- deployable build outputs and explicit deployment manifests
- environment shape, secret requirements, and migration contracts
- preview, promote, rollback, and release-history flows
- linkage between verification outcomes and release records

Exit criteria:

- unsafe release attempts can be blocked before deploy
- release records explain what was verified, what changed, and how to roll back
- default Node and Docker deployment paths remain crisp and operable

Testing gates:

- unit: environment and release-contract validation
- integration: build output and deployment-manifest validation
- integration: preview/release/rollback flows over fixture apps
- e2e: verify-gated release path with persisted traceability

## Supporting Work

The following work matters, but it is supporting work unless it directly
strengthens the main loop above.

### Frontend Runtime Refinement

- continue streaming SSR, navigation, cache, and loading/error polish
- ship SSG, RSC, server actions, or partial prerendering only when they reduce
  entropy for generated or operator-facing apps

### Protocol Breadth

- keep improving MCP, A2A, OpenAPI, and transport-level execution quality
- prefer shared runtime semantics over protocol-specific behavior forks

### Tooling And Scaffolding

- keep `create-capstan-app`, generated guides, and docs aligned with runtime
  reality
- make initial project structure easier for both humans and coding agents to
  inspect and evolve

## De-Prioritized Narratives

The following are no longer useful anchors for the blueprint:

- generic CRUD generation as product identity
- package proliferation as a roadmap strategy
- feature-parity chasing with page-first frameworks
- adding new abstraction layers before the core loop is tighter

## Next Questions

- What should the stable application contract artifact look like?
- Which supervision flows belong in the first-party operator surface by
  default?
- Which harness semantics must be stable before wider ecosystem expansion?
- How much release structure should be framework-managed versus adapter-owned?
