# Vision

Capstan exists to make software agent-operable by default.

In the Capstan model, an application is not primarily a collection of pages,
routes, or RPC handlers. It is a structured system of resources, capabilities,
tasks, policies, artifacts, and views that can be discovered, executed,
verified, recovered, and supervised by both humans and AI agents.

## Why This Matters

Modern frameworks optimize for human developers and browser clients. Coding
agents can already write code, inspect logs, run tools, and operate runtime
environments, but most applications remain high-entropy from their
perspective.

Capstan aims to lower that entropy by making the application itself
machine-readable and operationally explicit.

## Product Thesis

Capstan should make the following loop natural:

1. A human expresses intent
2. A coding agent reads the application contract and makes a change
3. The harness executes work and keeps long-running runs recoverable
4. Feedback verifies the result and explains failures in structured form
5. Release turns the result into deployable software with explicit contracts
6. Humans and other agents operate the same system through shared surfaces

## North Star

Given a change request, a workflow description, or a short product brief, an
agent should be able to use Capstan to produce or evolve an application that:

- is legible as resources, capabilities, tasks, policies, artifacts, and views
- exposes low-entropy machine surfaces for other agents
- can be supervised by humans without rebuilding context by hand
- can explain failures in structured terms and suggest repair paths
- can recover long-running work without ad hoc debugging
- can be promoted through a machine-readable release workflow

## Core Principles

- Contract-first, not route-first
- Capability-first, not CRUD-first
- Shared surfaces, not duplicated human-versus-agent stacks
- Recovery-first, not best-effort runtime behavior
- Verification-first, not demo-first
- Structured release, not ad hoc deployment
- Human supervision, not human micromanagement

## What Capstan Is Not

Capstan is not:

- a generic CRUD generator
- just a code generator
- just an AI SDK wrapper
- just a workflow engine
- just a web framework with agent integrations bolted on later

Capstan should instead become the application substrate that coordinates
contract, execution, supervision, verification, and release into one coherent
system.
