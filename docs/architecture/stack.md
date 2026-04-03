# 0-1 Stack

## Decision

Capstan's 0-1 implementation is TypeScript-first.

This is an execution choice, not a long-term dogma. The goal is to maximize
agent legibility, shared tooling, and iteration speed while the application
contract and the product loop are still converging.

## Why TypeScript First

- coding agents are highly effective in TypeScript-first repositories
- one language keeps runtime, scaffolding, verification, and docs close
- the current web and tooling stack is fastest to evolve in TypeScript
- early package boundaries stay easier to change while the kernel model settles

## Current Architectural Shape

Capstan's conceptual architecture has five kernels plus one source of truth.
Those kernels do not have to map one-to-one to package names.

### Source Of Truth

The working application vocabulary is:

`Domain + Resource + Capability + Task + Policy + Artifact + View`

Today that vocabulary is materialized through framework definitions, generated
contracts, manifests, and scaffolded application output. A tighter unified
contract is still an active priority.

### Contract Layer

Primary packages today:

- `@zauso-ai/capstan-core`
- `@zauso-ai/capstan-router`
- `@zauso-ai/capstan-db`
- `@zauso-ai/capstan-auth`

Responsibilities:

- define capabilities, policies, routes, models, and runtime contracts
- keep human and agent projections grounded in shared semantics
- expose enough structure for verification, scaffolding, and release tooling

### Harness Layer

Primary packages today:

- `@zauso-ai/capstan-ai`
- `@zauso-ai/capstan-cron`

Responsibilities:

- run agent work, including durable or recurring execution
- coordinate browser, shell, filesystem, memory, and tool use
- support checkpoints, approvals, interventions, artifacts, and replay

### Surface Layer

Primary packages today:

- `@zauso-ai/capstan-agent`
- `@zauso-ai/capstan-react`
- `@zauso-ai/capstan-dev`
- `@zauso-ai/capstan-cli`

Responsibilities:

- expose shared machine surfaces such as HTTP, MCP, A2A, and OpenAPI
- provide the human application shell and operator-facing surfaces
- support local development, runtime inspection, and operational commands

### Feedback And Release Layer

Primary packages today:

- `@zauso-ai/capstan-core`
- `@zauso-ai/capstan-cli`
- generated app assertions and contracts

Responsibilities:

- verify type, contract, runtime, and generated-surface behavior
- produce structured diagnostics and repair-oriented output
- build deployable output and keep release inputs explicit

### Scaffolding Layer

Primary package today:

- `create-capstan-app`

Responsibilities:

- establish the default project structure
- generate agent-readable guides and starter workflows
- keep new applications aligned with the framework's current contract

## Long-Term Boundary

Capstan should eventually distinguish between:

- `framework layer`: contract definition, projections, verification, release
  contracts, and developer tooling
- `host layer`: durable execution, process control, sandboxing, and system
  integrations

The framework layer can remain TypeScript-friendly.
The host layer may later move to a lower-level runtime such as Rust if that
becomes the best path for stability, portability, or distribution.

## Working Rule

When a new package or boundary is proposed, it must answer:

1. Does this tighten the shared application contract?
2. Does this reduce entropy in execution, verification, recovery, or
   supervision?
3. Could this remain a module inside an existing package instead of becoming a
   new package?
4. Can a coding agent discover and operate it with minimal ambiguity?

Package proliferation is not a strategy. Clearer contracts are.
