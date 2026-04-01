# Contributing to Capstan

Thanks for your interest in Capstan! Here's how to get started.

## Quick Start

```bash
git clone https://github.com/barry3406/capstan.git
cd capstan
npm install
npm run build        # Build all 9 runtime packages
npm run test:new     # Run 1052 tests (~17s)
```

## Branch Strategy

- Create feature branches from `main`
- Keep PRs focused on a single change

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `test:` adding/updating tests
- `chore:` maintenance (deps, CI, versions)

## Code Style

- ESM only, `.js` extensions in relative imports
- `import type` for type-only imports
- Strict TypeScript (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`)
- Target: ES2022, NodeNext module resolution

## Testing

- Write tests with `bun:test` for new code
- Run `npm run test:new` before submitting
- Edge cases and error paths required, not just happy paths

## Documentation Sync

When changing user-facing framework behavior, update ALL of the following in the same commit (see CLAUDE.md for details):

- `packages/create-capstan/src/templates.ts` (scaffolded AGENTS.md)
- `README.md`, `README.zh-CN.md`, `README.zh-TW.md`
- Relevant files in `docs/`

## Pull Request Process

1. Ensure CI passes (`npm run build && npm run test:new`)
2. Update docs if applicable
3. Describe what, why, and how in the PR description
4. Link related issues

## Questions?

Open a [GitHub Discussion](https://github.com/barry3406/capstan/discussions).
