# Agent Framework Guide

Capstan's agent story is intentionally split into two layers:

- **Runtime layer** — durable runs, turns, tasks, sidecars, checkpoints, mailboxes, graph projections, and sandboxed execution
- **Framework layer** — the contracts developers define on top of that runtime

If you are building an agent application, the framework layer is the recommended entry point.

## Golden Path

Build agent apps in this order:

1. **Define capabilities** with `defineCapability()`
2. **Define workflows** with `defineWorkflow()`
3. **Define policies** with `defineAgentPolicy()`
4. **Define memory spaces** with `defineMemorySpace()`
5. **Define operator views** with `defineOperatorView()`
6. **Compose the app** with `defineAgentApp()`
7. **Attach the runtime** with `createHarness()` or a project-specific runtime adapter

This keeps behavior explicit, machine-readable, and easy for coding agents to discover.

## The Five Contracts

### Capability

Use capabilities to define **what the agent can do**.

Include:

- the job to be done
- the tools and tasks it may use
- the policies that govern it
- the memory spaces it relies on
- the artifacts and operator signals it emits

### Workflow

Use workflows to define **how durable work proceeds**.

Include:

- the entry capability
- the stages and transitions
- the trigger type
- retry and completion behavior
- concurrency semantics

### Policy

Use policies to define **how work is governed**.

Include:

- the affected capabilities, workflows, memory spaces, tools, or tasks
- the decision: `allow`, `require_approval`, or `deny`
- the reason and risk level

### Memory Space

Use memory spaces to define **where context is stored and recalled**.

Include:

- the scope
- the kinds of records allowed
- promotion rules
- retention rules
- retrieval behavior
- graph binding behavior

### Operator View

Use operator views to define **how humans supervise the same runtime graph**.

Include:

- the projection kind
- the scoped filters
- the supported actions

## Recommended Project Structure

The `agent` scaffold generates this shape:

```txt
app/
  agent/
    contracts.ts
    README.md
    capabilities/
    workflows/
    policies/
    memory/
    views/
    runtime.ts
    index.ts
  routes/
    api/
      agent/
        app.api.ts
```

Use that structure intentionally:

- keep contract definitions in their named folders
- keep the runtime adapter thin
- keep human supervision in operator views instead of ad hoc notes
- keep machine-readable behavior in contracts, not prose

## First Five Minutes

After scaffolding an agent app:

```bash
npm install
npx capstan dev
npx capstan verify --json
```

Then inspect:

- `/`
- `/.well-known/capstan.json`
- `/openapi.json`
- `/api/agent/app`

## Framework vs Runtime

Use the framework layer when you want a stable, declarative developer API.

Drop to the runtime layer only when you need:

- custom harness wiring
- control-plane inspection
- direct task runtime access
- mailbox or sidecar integration
- sandbox customization

The framework should be the default path. The runtime should remain available for advanced cases.
