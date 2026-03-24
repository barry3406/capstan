# 0-1 Stack

## Decision

Capstan's 0-1 implementation is TypeScript-first.

This is an execution choice, not a long-term dogma. The goal is to maximize
speed, agent legibility, and cohesion while the source-of-truth model and the
developer loop are still taking shape.

## Why TypeScript First

- Claude Code is highly effective in TypeScript-first repositories
- one language keeps the early loop fast and low-friction
- Node has the best default path for code generation and web projection
- it keeps the graph, compiler, CLI, and initial surfaces in one ecosystem

## Long-Term Boundary

Capstan should eventually distinguish between:

- `framework layer`: graph definitions, projections, code generation, policies,
  and human surfaces
- `host layer`: harness runtime, task engine, process control, durable
  execution, and system integrations

The framework layer can remain TypeScript-friendly.
The host layer may later move to a native runtime such as Rust if that becomes
the best path for stability and distribution.

## 0-1 Modules

### `packages/app-graph`

The first source-of-truth package.

Responsibilities:

- define the minimal `App Graph`
- validate graph shape and references
- provide shared types used by future compiler and surface packages

### `packages/compiler`

The first projection engine.

Responsibilities:

- turn an `App Graph` into a deterministic project skeleton
- generate stable folders for resources, capabilities, tasks, policies,
  artifacts, and views
- create the first AI-facing control plane entry points for generated apps

### `packages/cli`

The first operator entry point.

Responsibilities:

- inspect and validate graphs
- expose stable commands for humans and coding agents
- become the first shell of the Capstan harness

## Deferred Modules

These are expected later, but are not required for the first milestone:

- `surface-web`
- `surface-agent`
- `feedback`
- `release`
- `harness-host`

## 0-1 Tooling

- Node.js
- TypeScript
- npm workspaces
- plain `tsc` for compilation
- `tsx` for local TypeScript execution

## Working Rule

When a new module is introduced, it must answer:

1. Is this part of the source of truth?
2. Is this a projection from the graph?
3. Is this part of the harness host?
4. Can a coding agent discover and operate it with minimal ambiguity?
