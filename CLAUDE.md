# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Capstan

A harness-first framework for building agent-operable software. The core loop is: **brief → graph → scaffold → implement → verify → release → operate**. Everything is designed to be machine-readable and discoverable by both humans and AI agents.

## Commands

```bash
# Build all packages (must run before tests or CLI commands)
npm run build

# Run all tests (builds first, then runs vitest)
npm test

# Run a single test file
npm run build && npx vitest run tests/unit/app-graph.test.ts

# Run tests matching a pattern
npm run build && npx vitest run -t "pattern"

# Watch mode
npm run test:watch

# Type-check all packages
npm run typecheck

# CLI dev mode (builds all packages then runs CLI)
npm run dev -- <command>

# Example CLI commands
npm run brief:scaffold -- --brief path/to/brief.json --out ./my-app
npm run verify -- --app ./my-app
npm run graph:check -- --graph path/to/graph.json
```

Build order matters — packages must be built in dependency order. The `npm run build` script handles this. Always build before running tests or CLI commands.

## Architecture

### Monorepo Layout

Ten packages under `packages/`, all using npm workspaces with `@capstan/` scope. Each package has its own `tsconfig.json` extending `tsconfig.base.json`, builds to `dist/`, and exports from a single `src/index.ts`.

### Five Kernels

- **app-graph** — Core data model. Defines the App Graph schema (resources, capabilities, tasks, policies, artifacts, views) with validation, diffing, and introspection. No internal dependencies — everything else builds on this.
- **harness** — Durable task execution runtime. Manages task lifecycle, approvals, events, memory, compaction, and replay. No internal dependencies.
- **compiler** — Largest package (~9000 lines). Projects a validated App Graph into a full application: control plane, agent surface, human surface, capabilities, views, assertions, and generated AGENTS.md.
- **feedback** — Verification and diagnostics. Runs type checks, schema validation, assertion checks, and DOM-based HTML verification (via jsdom).
- **release** — Release planning, rollout, rollback, and history tracking.

Supporting packages: **brief** (parses briefs, compiles to graphs), **packs-core** (composable packs: auth, tenant, workflow, etc.), **surface-web** and **surface-agent** (projection helpers for human and AI interfaces).

### Package Dependency Flow

```
app-graph (leaf)  ←  packs-core  ←  brief
                  ←  compiler (also depends on surface-web, surface-agent)
                  ←  feedback  ←  release
cli depends on all packages
harness, surface-web, surface-agent are leaf packages
```

### CLI Entry Point

`packages/cli/src/index.ts` — routes all commands (`brief:*`, `graph:*`, `verify`, `release:*`, `harness:*`).

## TypeScript Conventions

- ESM only (`"type": "module"` everywhere, `NodeNext` module resolution)
- Strict mode with `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `noUncheckedIndexedAccess`
- Validation functions return `{ ok: boolean, issues: Issue[] }`
- Target: ES2022

## Working Rules (from AGENTS.md)

- Prefer one obvious implementation path over flexible but ambiguous patterns
- Keep files and folders predictable — repo structure is part of the product
- Make machine-readable contracts explicit instead of hiding behavior in prose
- Favor deterministic flows over clever implicit behavior
- Keep naming stable — renames should be rare and intentional

## Design Lens

When adding or changing a feature, ask:
1. How does an agent discover this?
2. How does an agent execute this?
3. How does an agent verify success or failure?
4. How does an agent recover or retry?
5. How does a human supervise or override it?

## Generated App Structure

After scaffolding, generated apps have framework-owned paths (regenerate, don't patch) and user-owned paths (safe to edit):

- **User-owned**: `src/capabilities/*.ts`, `src/views/*.ts`, `src/assertions/custom.ts`
- **Framework-owned**: `src/control-plane/**`, `src/agent-surface/**`, `src/human-surface/**`, `capstan.app.json`, `AGENTS.md`
