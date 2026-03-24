# Capstan Agent Guide

Capstan is an agent-first project. This repository should stay easy for coding
agents to read, modify, verify, and operate.

## Working Rules

- Prefer one obvious implementation path over flexible but ambiguous patterns.
- Keep files and folders predictable. Repo structure is part of the product.
- Make machine-readable contracts explicit instead of hiding behavior in prose.
- Favor deterministic flows over clever implicit behavior.
- Add documentation whenever a new core concept is introduced.
- Keep naming stable. Renames should be rare and intentional.

## Design Lens

When adding or changing a feature, ask:

1. How does an agent discover this?
2. How does an agent execute this?
3. How does an agent verify success or failure?
4. How does an agent recover or retry?
5. How does a human supervise or override it?

## Current Source Of Truth

Until code exists, the source of truth is:

- `README.md`
- `docs/vision.md`
- `docs/architecture/core.md`

Keep these documents aligned as the project evolves.
