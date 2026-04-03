# Testing Strategy

Capstan has two products at once:

- the framework itself
- the applications the framework scaffolds, verifies, and helps operate

That means we do not only test package internals. We also test whether
generated software remains correct, stable, recoverable, and agent-operable.

## Quality Goals

The test strategy should protect five things:

1. shared contract correctness
2. executable runtime behavior
3. recoverability of long-running work
4. human and agent surface agreement
5. structured release confidence

## Test Layers

### Unit Tests

Purpose:

- protect local logic inside a package or module

Typical targets:

- contract normalization and naming
- policy and auth helpers
- task state transitions
- queue and supervision helpers
- release validation helpers

Expected traits:

- fast
- deterministic
- no network
- minimal fixture setup

### Integration Tests

Purpose:

- verify a command, runtime boundary, or cross-package contract end to end

Typical targets:

- scaffold or verify commands over fixture apps
- runtime contract agreement across HTTP, MCP, A2A, and manifests
- semantic ops persistence across runtime, SQLite store, and CLI projections
- harness lifecycle behavior across persistence boundaries
- generated surface projections over real runtime state
- build and release commands over fixture apps

Expected traits:

- may touch the filesystem
- use explicit fixture apps and fixture contracts
- focus on behavior across boundaries, not just local logic

### Generated-App Tests

Purpose:

- prove that scaffolded output is a working product, not just valid source text

Typical targets:

- generated app build and typecheck
- generated operator surface projections and action wiring
- generated control-plane discovery and execution
- generated assertions, smoke checks, and verify output

Expected traits:

- black-box mindset over generated output
- validate both human and machine surfaces
- guard against drift between templates and runtime behavior

### End-To-End Tests

Purpose:

- verify complete operator and agent workflows from the outside

Typical targets:

- scaffold -> run -> operate a generated app
- execute long-running work with approval, input, retry, and resume
- verify a broken app, repair it, and verify again
- preview or release an app through a framework-managed flow

Expected traits:

- exercise real system seams
- prefer realistic supervision and recovery flows
- validate behavior, not just status codes

## Fixtures And Artifacts

Capstan should maintain explicit fixtures instead of ad hoc samples.

Recommended categories:

- `tests/fixtures/contracts`: capability, task, and policy inputs
- `tests/fixtures/apps`: scaffolded or hand-authored fixture apps
- `tests/fixtures/broken-apps`: intentionally failing repair scenarios
- `tests/fixtures/harness`: long-running workflow and recovery scenarios
- golden snapshots for manifests, diagnostics, release records, and surface
  projections

## Tooling

Tooling may evolve, but the test layers should stay stable.

Current default posture:

- unit and integration: Bun and Vitest where appropriate
- browser-level operator flows: Playwright
- snapshots: versioned golden files for diagnostics, manifests, and generated
  projections

## Performance Benchmarks

Capstan keeps a committed benchmark suite under `benchmarks/`.

Purpose:

- protect hot paths that can regress without changing public APIs
- make framework performance budgets explicit and reviewable
- fail CI when measured latency drifts beyond committed thresholds

Current benchmark gates cover:

- React SSR render hot paths
- page runtime document and navigation payload generation
- route scanning and route matching on a synthetic mid-sized app tree
- in-memory runtime request handling for document, navigation, and scoped
  not-found responses

Working rules:

- benchmark scenarios should stay deterministic and synthetic
- scenarios should isolate framework overhead, not network conditions
- every committed scenario must have a budget
- budget changes should be reviewed like any other runtime contract

## Coverage By Kernel

### Contract

Required coverage:

- capability, task, policy, and artifact contract agreement
- manifest and projection input stability
- generated contract drift detection
- protocol-level agreement across HTTP, MCP, A2A, and OpenAPI

Release gate:

- no new contract surface ships without generated-app proof that humans and
  agents see the same semantics

### Harness

Required coverage:

- durable runs, checkpoints, approvals, input requests, retries, and replay
- artifact persistence and event streaming
- browser, shell, and filesystem sandbox boundary behavior
- recurring execution behavior when it reuses harness contracts

Release gate:

- no long-running runtime feature ships without recovery-path tests

### Surface

Required coverage:

- generated human surface route, field, and action projection
- top-level attention inbox and grouped queue-lane behavior
- task/resource/route drill-down continuity and breadcrumb behavior
- generated control-plane discovery, execution, and error contracts
- semantic ops event, incident, and health views over real runtime state

Release gate:

- no new operator or agent surface ships without proving it remains a
  projection of shared runtime state

### Feedback

Required coverage:

- `capstan verify --json` success and failure paths
- structured diagnostic output and repair-checklist snapshots
- generated-app assertions and runtime smoke checks
- break -> verify -> repair -> verify loops on realistic fixtures

Release gate:

- common failures must be explainable in structured, actionable terms

### Release

Required coverage:

- build outputs and deployment-manifest validation
- environment and migration contract checks
- preview, release, rollback, and history flows
- linkage between verification outcomes and release records

Release gate:

- no release feature ships without failure-path coverage and traceable output

## Default Release Gates

Capstan should not promote a milestone unless:

- at least one generated app proves the intended loop end to end
- new runtime behavior has a recovery-path test where recovery matters
- new surface behavior has generated-app coverage, not just local unit tests
- new release behavior has validation, execution, and rollback coverage
- generated diagnostics remain structured enough for an agent to act on

## Working Rule

When deciding whether to add a test, ask:

1. Does this protect the shared contract?
2. Does this prove real execution instead of template output only?
3. Does this cover recovery or supervision where recovery or supervision
   matters?
4. Would a regression here break an agent's ability to converge without manual
   guesswork?

If the answer is yes, the test belongs on the critical path.
