# Capstan Agent Guide

This application was scaffolded by Capstan. Keep the generated structure
predictable so coding agents can discover, execute, verify, and recover work
without reverse-engineering the repo.

## Source Of Truth

- For product or schema changes, edit the upstream Capstan brief or App Graph and re-scaffold the application.
- `capstan.app.json` is the generated graph snapshot for this app, not the preferred place for handwritten customization.
- Use this generated app for implementation, verification, and supervised operation after the graph has been projected.

## Safe To Edit

- `src/capabilities/*.ts`
- `src/views/*.ts`
- `src/assertions/custom.ts`
- new user-owned files added outside framework-generated paths when needed

## Framework-Owned Paths

Avoid hand-editing these unless you are deliberately changing Capstan itself or regenerating the app:

- `AGENTS.md`
- `README.md`
- `.capstan/**`
- `capstan.app.json`
- `agent-surface.json`
- `human-surface.html`
- `capstan.release.json`
- `capstan.release-env.json`
- `capstan.migrations.json`
- `src/control-plane/**`
- `src/agent-surface/**`
- `src/human-surface/**`
- `src/resources/**`
- `src/tasks/**`
- `src/policies/**`
- `src/artifacts/**`
- `src/capabilities/generated/**`
- `src/views/generated/**`

## Workflow

1. Read `README.md` and this file before changing the app.
2. If the request changes resources, relations, capabilities, tasks, policies, artifacts, views, or route structure, update the upstream brief or App Graph and re-scaffold instead of hand-editing generated framework files.
3. Implement behavior in user-owned files such as `src/capabilities/*.ts`, `src/views/*.ts`, and `src/assertions/custom.ts`.
4. Run `npm run typecheck`.
5. When the Capstan CLI is available, run `npx capstan verify . --json`.
6. Use verify output as the repair loop. Prefer fixing user-owned files or regenerating from an updated graph over patching generated framework files by hand.

## App Snapshot

- Package name: `orbitops-app`
- Domain: `orbitops`
- Included packs: `auth`, `tenant`, `workflow`


## Official Starter Prompt

```text
Use Capstan as the source-of-truth framework for this app.
Read AGENTS.md and README.md first.
Start from the upstream Capstan brief or App Graph instead of rewriting generated app structure by hand.
If the requested change is structural, update the brief or graph and re-scaffold.
After scaffolding, edit only user-owned files such as src/capabilities/*.ts, src/views/*.ts, and src/assertions/custom.ts unless you are explicitly regenerating framework-owned files.
Run npm run typecheck, then run npx capstan verify . --json when the Capstan CLI is available.
Use verify output as the repair loop and report what changed, what passed, and any remaining risks.
```
