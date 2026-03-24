# Vision

Capstan exists to make software agent-operable by default.

In the Capstan model, an application is not primarily a collection of routes,
pages, or RPC handlers. It is a structured system of resources, capabilities,
tasks, policies, artifacts, and views that can be operated by both humans and
AI agents.

## Why This Matters

Modern software frameworks were designed for human developers and browser
clients. Leading coding agents can already write code, run tools, inspect
errors, and operate development environments, but most applications are still
opaque and high-entropy from the agent's perspective.

Capstan aims to change that by making the application itself legible,
executable, verifiable, and deployable for agents.

## Product Thesis

Capstan should make the following loop natural:

1. A human describes an intent
2. A coding agent instantiates or changes an application
3. The harness runs verification and produces structured feedback
4. The agent repairs and converges
5. The system is released with a machine-readable deployment contract
6. Other agents consume the resulting capabilities through AI-first surfaces and
   recoverable workflow recipes plus workflow supervision, discovery, inbox,
   queue, and queue-lane contracts, while human operators supervise the same
   durable work from shared attention lanes, a top-level inbox, and reusable
   task/resource/route attention presets in the generated human surface, with
   route drill-down preserving inherited task/resource breadcrumb context into
   local queue lanes, letting operators reopen parent supervision presets, and
   pinning the same trail into a reusable supervision workspace with saved
   history that can be resumed, cleared, and restored after reload, plus named
   workspace slots for a few durable supervision lanes that task/resource/route
   presets can auto-fill without overwriting manual overrides, with live slot
   summaries, new-since-open deltas, and highest-priority queue shortcuts for
   long-lived supervision

## North Star

Given a short product brief, an agent should be able to use Capstan to produce
an application that:

- is coherent and maintainable
- exposes low-entropy capability surfaces for other agents
- is verifiable without manual guesswork
- is deployable through structured release workflows
- remains understandable to humans
- ships with an agent-readable operating guide and starter prompt by default

## Core Principles

- Harness-first, not page-first
- Capability-first, not route-first
- Verification-first, not demo-first
- Structured release, not ad hoc deployment
- Human supervision, not human micromanagement

## What Capstan Is Not

Capstan is not:

- just a code generator
- just an AI SDK wrapper
- just a workflow engine
- just a web framework

Capstan should instead become the application substrate that coordinates these
concerns into one coherent system.
