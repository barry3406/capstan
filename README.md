# Capstan

Capstan is a framework for building agent-operable software.

Instead of starting from routes, controllers, and pages, Capstan starts from a
machine-readable application model. From that model, it scaffolds a human
surface, an agent control plane, durable workflow primitives, verification
hooks, and release contracts that stay aligned with each other.

`brief -> app graph -> scaffold -> implement -> verify -> release -> operate`

> Status: prototype. Capstan already supports an end-to-end loop in this repo,
> but the public API and scaffold shape are still evolving.

## What Capstan Is

Capstan is for teams that want coding agents to do more than generate files.

Capstan treats an application as an `App Graph`:

- `Domain`
- `Resource`
- `Capability`
- `Task`
- `Policy`
- `Artifact`
- `View`

From that graph, Capstan can project:

- a human-facing application shell
- an agent-facing control plane
- durable workflow and supervision contracts
- framework-owned verification hooks
- machine-readable release contracts

## Why It Exists

Modern frameworks are optimized for humans writing application code by hand.
Capstan is optimized for agents producing, operating, and repairing software
without losing human supervision.

Capstan aims to make applications:

- discoverable by coding agents
- executable through stable control-plane contracts
- verifiable through framework-owned checks and assertions
- operable by humans and agents from the same underlying model
- releasable through structured preview, rollout, and rollback workflows

## Five-Minute Mental Model

1. A human writes a Capstan brief or App Graph.
2. Capstan compiles that intent into a deterministic application skeleton.
3. A coding agent fills in user-owned business logic.
4. `verify` checks the generated app, TypeScript health, assertions, and smoke behavior.
5. `release:*` and `harness:*` operate the app through machine-readable contracts.
6. Human operators and coding agents supervise the same durable workflows through aligned surfaces.

If you only remember one thing, remember this:

Capstan is not "AI that writes a web app". Capstan is "a framework that makes
the app itself legible and operable for both AI agents and humans".

## What You Author

- a Capstan brief or App Graph
- user-owned capability handlers in `src/capabilities/*.ts`
- optional user-owned view modules in `src/views/*.ts`
- custom assertions in `src/assertions/custom.ts`
- optional pack registries and reusable packs

## What Capstan Generates

- `human-surface.html` and `src/human-surface/**`
- `agent-surface.json` and `src/agent-surface/**`
- `src/control-plane/**`
- `capstan.app.json`
- `capstan.release.json`
- `capstan.release-env.json`
- `capstan.migrations.json`
- typed registries for resources, tasks, policies, artifacts, and views
- a generated app-level `AGENTS.md` with coding-agent workflow guidance

## Quick Start

Capstan currently runs from this monorepo.

```bash
npm install
npm run brief:check -- ./tests/fixtures/briefs/starter-revenue-ops-saas-brief.json
npm run brief:inspect -- ./tests/fixtures/briefs/starter-revenue-ops-saas-brief.json
npm run brief:scaffold -- ./tests/fixtures/briefs/starter-revenue-ops-saas-brief.json ./output-app
npm run verify -- ./output-app --json
```

After scaffolding:

- inspect `./output-app/human-surface.html`
- inspect `./output-app/agent-surface.json`
- implement logic in `./output-app/src/capabilities/*.ts`
- add domain checks in `./output-app/src/assertions/custom.ts`

## Minimal Input Example

You can start from a short brief:

```json
{
  "version": 1,
  "domain": {
    "key": "starter-revenue-ops",
    "title": "Starter Revenue Operations Hub",
    "description": "A zero-entity Capstan brief that relies entirely on inferred starter packs."
  },
  "application": {
    "profile": "saas",
    "modules": [
      {
        "key": "revenueOps",
        "options": {
          "artifactKey": "starterRevenueOpsDigest"
        }
      }
    ]
  },
  "entities": []
}
```

Or drop to a lower-level App Graph:

```json
{
  "version": 1,
  "domain": {
    "key": "operations",
    "title": "Operations Console"
  },
  "resources": [
    {
      "key": "ticket",
      "title": "Ticket",
      "fields": {
        "title": { "type": "string", "required": true },
        "status": { "type": "string", "required": true }
      }
    }
  ],
  "capabilities": [
    {
      "key": "listTickets",
      "title": "List Tickets",
      "mode": "read",
      "resources": ["ticket"]
    }
  ],
  "views": [
    {
      "key": "ticketList",
      "title": "Ticket List",
      "kind": "list",
      "resource": "ticket",
      "capability": "listTickets"
    }
  ]
}
```

## Generated App Structure

Capstan-generated apps are split into user-owned paths and framework-owned
paths.

Safe to edit:

- `src/capabilities/*.ts`
- `src/views/*.ts`
- `src/assertions/custom.ts`
- new application files you add outside framework-generated paths

Treat as framework-owned:

- `src/control-plane/**`
- `src/agent-surface/**`
- `src/human-surface/**`
- `src/capabilities/generated/**`
- `src/views/generated/**`
- `human-surface.html`
- `agent-surface.json`
- `capstan.app.json`
- `capstan.release.json`
- `capstan.release-env.json`
- `capstan.migrations.json`

If the requested change is structural, update the brief or graph and
re-scaffold instead of patching generated framework files by hand.

## Current Capabilities

Today, Capstan already includes first working wedges of:

- `brief:check`, `brief:inspect`, `brief:graph`, and `brief:scaffold`
- `graph:check`, `graph:inspect`, `graph:diff`, and `graph:scaffold`
- reusable pack composition, including built-in `auth`, `tenant`, `workflow`, `connector`, `billing`, `commerce`, and `revenueOps` packs
- relation-aware human surfaces with multi-resource navigation
- agent-surface projections over local transport, HTTP/RPC, MCP, and A2A
- durable task workflows with approvals, input handoff, retries, replay, summaries, and memory artifacts
- workflow discovery, inbox, grouped queues, and human supervision workspaces
- `verify` with structure checks, TypeScript checks, assertions, build validation, and smoke coverage
- `release:plan`, `release:run`, `release:history`, and `release:rollback`

## Architecture At A Glance

Capstan has five kernels plus one source of truth:

- `App Graph`: the machine-readable application model
- `Graph`: modeling, validation, normalization, diffing, introspection
- `Harness`: task execution, approvals, replay, summaries, memory
- `Surface`: human UI projection and AI control-plane projection
- `Feedback`: verification, assertions, diagnostics, repair loops
- `Release`: preview, rollout, health checks, rollback, traceability

## For Claude Code / Coding Agents

Capstan is designed so a coding agent can follow one short, stable loop:

```text
Use Capstan as the source-of-truth framework.
Read AGENTS.md and README.md first.
Start from a Capstan brief or App Graph instead of handwritten app files.
Run check, inspect, scaffold, and verify in that order.
If the requested change is structural, update the brief or graph and regenerate the app.
After scaffolding, edit only user-owned files unless you are explicitly regenerating framework-owned output.
Use verify output as the repair loop and report what changed, what passed, and any remaining risks.
```

Scaffolded apps now also include a root `AGENTS.md` that repeats this workflow
inside the generated project.

## Intended Package UX

Once Capstan is published as an npm package, the intended happy path is:

```bash
npm install -D capstan
npx capstan brief:check ./app.brief.json
npx capstan brief:inspect ./app.brief.json
npx capstan brief:scaffold ./app.brief.json ./my-app
npx capstan verify ./my-app --json
```

Or, starting from a graph:

```bash
npx capstan graph:check ./app.graph.mjs
npx capstan graph:inspect ./app.graph.mjs
npx capstan graph:scaffold ./app.graph.mjs ./my-app
npx capstan verify ./my-app --json
```

## Repository Guide

- `AGENTS.md`: instructions for coding agents working in this repository
- `docs/vision.md`: product thesis and design principles
- `docs/architecture/core.md`: the current high-level architecture
- `docs/blueprint.md`: milestone-by-milestone build plan
- `docs/testing-strategy.md`: unit, integration, and e2e expectations
- `docs/roadmap.md`: execution path from prototype to broader framework
- `packages/app-graph`: App Graph schema, validation, diffing, introspection
- `packages/brief`: brief model and brief-to-graph compilation
- `packages/packs-core`: built-in packs and pack composition
- `packages/compiler`: graph-to-application projection
- `packages/surface-web`: human-surface projection helpers
- `packages/surface-agent`: agent-surface projection helpers
- `packages/feedback`: verification and repair-oriented diagnostics
- `packages/release`: release planning and execution contracts
- `packages/harness`: durable task runtime and workflow state
- `packages/cli`: Capstan CLI entry point

## Read Next

- [Vision](./docs/vision.md)
- [Core Architecture](./docs/architecture/core.md)
- [Blueprint](./docs/blueprint.md)
- [Testing Strategy](./docs/testing-strategy.md)
- [Roadmap](./docs/roadmap.md)
