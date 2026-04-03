# Roadmap

## Purpose

Capstan exists to make applications agent-operable by default.

This roadmap is not a feature wish list. It is an ordering of work that makes
one loop more deterministic:

1. A human expresses intent
2. A coding agent reads the application contract and makes a change
3. The harness executes work and keeps long-running runs recoverable
4. Feedback verifies the result and explains failures in structured form
5. Release turns the result into deployable software with explicit contracts
6. Humans and other agents operate the same system through shared surfaces

If a milestone does not make that loop more legible, executable, verifiable,
recoverable, or easier to supervise, it is not on the critical path.

## Planning Filter

Every proposed milestone should answer five questions:

1. How does an agent discover this?
2. How does an agent execute this?
3. How does it verify success or failure?
4. How does it recover or retry?
5. How does a human supervise or override it?

Work that improves only visual novelty, package count, or framework parity does
not outrank work that reduces entropy in those five dimensions.

## Product Shape Today

Capstan already has working pieces across five kernels, but they are not yet
equally mature.

### Graph

- `defineAPI()`, `definePolicy()`, `defineModel()`, file-based routing, and
  generated manifests establish the machine-readable contract of an app
- HTTP, MCP, A2A, and OpenAPI projections already come from shared capability
  definitions
- resources, capabilities, tasks, policies, artifacts, and views are the
  current vocabulary for describing an application

### Harness

- `@zauso-ai/capstan-ai` provides `think()`, `generate()`, memory, and agent
  loops
- harness runtime foundations already exist for durable runs, events,
  checkpoints, artifacts, browser automation, and filesystem sandboxes
- recurring agent work is supported through cron-oriented runtime pieces

### Surface

- React SSR, streaming, loaders, layouts, and SPA navigation provide the human
  application shell
- generated control-plane and human-surface foundations already exist in
  scaffolded app output
- approval and policy semantics already influence what humans and agents can do

### Feedback

- `capstan verify --json` provides structured diagnostics for coding agents
- cross-protocol checks, runtime smoke checks, and generated-app assertions are
  already part of the quality loop
- the repo already treats verification as a first-class product capability, not
  just a test command

### Release

- `capstan build` and `capstan start` already produce explicit deployable output
- deployment manifests, standalone bundles, and first-party targets for
  Node, Docker, Vercel, Cloudflare, and Fly are now part of the current
  release contract
- `capstan verify --deployment` now checks target-specific artifacts and
  runtime risks before shipping

## What Capstan Is Actually Building

Capstan is not trying to become a generic CRUD generator, a thin AI SDK
wrapper, or a page-first framework with agent extras bolted on later.

The core product is:

- a machine-readable application contract
- a harness that can run and recover agent work
- shared human and machine surfaces over that contract
- a feedback system that closes the repair loop
- a release layer that keeps deployments explicit and operable

Frontend ergonomics matter, but only insofar as they strengthen that loop.

## Near-Term Priorities

### 1. Contract Convergence

Capstan needs one coherent application contract that the runtime, scaffolder,
verifier, and generated surfaces all agree on.

Priority work:

- converge file-based apps, generated apps, manifests, and verification onto
  one machine-readable model
- make resources, capabilities, tasks, policies, artifacts, and views
  discoverable from the same source
- reduce drift between generated files, runtime behavior, docs, and repair
  guidance
- make contract snapshots and diffs stable enough for tooling, CI, and agents

### 2. Operator Surfaces

The next surface milestone is not "generic admin UI." It is a first-party
operator surface for supervision.

Priority work:

- generate a human surface from capabilities, tasks, policies, approvals,
  artifacts, and views
- provide a top-level attention inbox and grouped queue lanes for durable work
- support task-scoped, resource-scoped, and route-scoped drill-down without
  losing breadcrumb context
- expose approve, provide-input, retry, cancel, and inspect flows through the
  same runtime contracts that agents use
- later, factor stable pieces into embeddable control-plane widgets

### 3. Durable Harness Execution

The harness has to become a dependable runtime for long-running agent work, not
just a local utility.

Priority work:

- make checkpoints, approvals, input requests, retries, replay, and recovery
  semantics more explicit
- tighten browser, shell, and filesystem runtime contracts
- improve run inspection, event streaming, artifact capture, and compaction
- make recovery paths legible to both operators and coding agents

### 4. Feedback And Repair

Capstan wins when agents can converge without guesswork.

Priority work:

- expand structured verification around contract drift, runtime drift, surface
  drift, and release drift
- keep generated-app assertions and runtime smoke tests as first-class product
  behavior
- produce better repair checklists and more actionable failure categories for
  agents
- add stronger regression coverage for long-running workflows and supervised
  operator flows

### 5. Structured Release

Release should become the final contract, not an afterthought after `build`.

Priority work:

- make environment shape, secret requirements, migrations, and rollout gates
  explicit
- support preview, promote, rollback, and release history as structured flows
- connect verification outcomes and deployment contracts to runtime release
  records
- keep platform targets, deployment verification, and release records aligned
  as preview/promote/rollback land

## Supporting Work

The following work still matters, but it is supporting work unless it directly
strengthens the main loop.

### Frontend Runtime Polish

- finish SSG where it improves generated previews or operator-facing apps
- continue SPA router polish, cache behavior, and loading/error ergonomics
- add RSC, server actions, or partial prerendering only when they reduce
  entropy instead of increasing framework complexity

### Protocol And Integration Breadth

- continue improving MCP, A2A, OpenAPI, and transport-level execution quality
- deepen external tool and connector stories where they help real operator or
  agent workflows
- prefer shared runtime semantics over protocol-specific feature forks

## De-Prioritized Narratives

The following are no longer good anchors for the roadmap:

- generic CRUD page generation as a product identity
- standalone surface package proliferation as a strategy
- feature-parity chasing with Next.js when it does not improve agent operation
- adding more abstractions before the graph, harness, surface, feedback, and
  release loop is tighter

## Success Definition

Capstan succeeds when a short brief lets a coding agent produce or change an
application that:

- is legible as resources, capabilities, tasks, policies, artifacts, and views
- can be executed by agents through low-entropy machine surfaces
- can be supervised by humans through a shared operator surface
- can explain failures in structured terms and suggest concrete repair paths
- can recover long-running work without ad hoc manual debugging
- can be promoted through a machine-readable release workflow

That is the roadmap: not "more features," but a tighter, more operable loop.
