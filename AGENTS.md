# AGENTS Guide for `lix_fork`
This file is for coding agents working in this repository.
It captures practical build/test commands and code conventions observed in the codebase.

## Workspace Snapshot
- Package manager: `pnpm` (required: `>=10 <11`, lockfile v9).
- Runtime: Node.js `>=22`.
- Repo orchestrator: `nx` via root scripts.
- Module system: ESM (`"type": "module"` in packages).
- Main language: TypeScript.

## Important Rule Files
- Cursor rules: none found at `.cursorrules` or `.cursor/rules/`.
- Copilot instructions: none found at `.github/copilot-instructions.md`.
- Package-specific agent guidance exists at `packages/sdk/AGENTS.md`.
- When editing `packages/sdk`, follow both this file and `packages/sdk/AGENTS.md`.

## Install and Bootstrap
```bash
pnpm install
```
If you only need one package, prefer filtered commands after install.

## Root Commands (All Packages)
- Build all: `pnpm build`
- Test all: `pnpm test`
- Lint all: `pnpm lint`
- Format all: `pnpm format`
- CI gate: `pnpm ci` (runs lint, test, build)

These call Nx `run-many` under the hood.

## Run Commands for One Package
Use pnpm filter:
```bash
pnpm --filter <package-name> <script>
```
Examples:
```bash
pnpm --filter @lix-js/sdk test
pnpm --filter @lix-js/agent-sdk lint
pnpm --filter @lix-js/plugin-json build
```
Build a package and its dependencies first:
```bash
pnpm --filter <package-name>... build
```

## Running a Single Test (Vitest)
Preferred patterns:
```bash
# single test file
pnpm --filter @lix-js/sdk exec vitest run src/version/create-version.test.ts

# single test by name
pnpm --filter @lix-js/sdk exec vitest run src/version/create-version.test.ts -t "creates a new version"

# watch one file
pnpm --filter @lix-js/agent-sdk exec vitest src/create-lix-agent.test.ts
```
Notes:
- Many package `test` scripts also run type checking.
- `@lix-js/sdk` test script performs setup via `scripts/build.js --setup-only`.
- Some packages scope tests to `src/**/*.test.ts`; target file paths accordingly.

More single-test examples:
```bash
# plugin-md file test
pnpm --filter @lix-js/plugin-md exec vitest run src/parse-md.test.ts

# react-utils file test (jsdom)
pnpm --filter @lix-js/react-utils exec vitest run src/use-lix.test.ts

# plugin-json by test name
pnpm --filter @lix-js/plugin-json exec vitest run src -t "parses nested objects"
```

## Package Command Quick Reference
- `@lix-js/sdk`: `build`, `test`, `test:watch`, `typecheck`, `lint`, `format`, `bench`
- `@lix-js/agent-sdk`: `build`, `dev`, `test`, `test:watch`, `typecheck`, `lint`, `format`
- `@lix-js/react-utils`: `build`, `test`, `test:watch`, `lint`, `format`
- `@lix-js/plugin-prosemirror`: `build`, `test`, `watch`, `lint`, `lint:fix`, `format`
- `@lix-js/plugin-json`: `build`, `typecheck`, `test`, `watch`, `lint`, `lint:fix`, `format`
- `@lix-js/plugin-md`: `build`, `typecheck`, `test`, `watch`, `lint`, `lint:fix`, `format`
- `@lix-js/plugin-csv`: `build`, `test`, `lint`, `format`
- `@lix-js/website` / `@lix-js/inspector`: Vite (`dev`, `build`, `preview`)

## Linting and Formatting
- Prettier is used in multiple packages.
- Common Prettier settings (sdk + agent-sdk): tabs enabled (`useTabs: true`), trailing commas `es5`.
- Oxlint is used in several packages.
- Key enforced rule: no floating promises (`no-floating-promises`).
- Some packages use ESLint instead (notably `plugin-csv`).

Agent behavior:
- Run lint/format on touched packages before finishing.
- Do not reformat unrelated files.

## TypeScript and Module Conventions
- Use strict TypeScript patterns; avoid `any` unless unavoidable.
- Prefer `type` aliases over `interface` where either works (sdk guidance).
- Keep explicit return types on exported functions where practical.
- Use ESM-style relative imports with `.js` extensions in TS source.
- Use `import type` (or inline `type` imports) for type-only symbols.
- Prefer named exports over default exports unless a file already uses default.
- Prefer schema-backed input/output types for tool-like boundaries (e.g. `zod` + `z.infer`).

## Naming and File Organization
- File names are typically kebab-case.
- Keep tests close to implementation (`*.test.ts` colocated in `src`).
- Use descriptive verb-first operation names (`create-*`, `update-*`, `delete-*`, `apply-*`, `select-*`).
- Keep modules focused; split helpers rather than creating oversized files.

## Error Handling Guidelines
- Fail fast with clear errors for invalid state/inputs.
- Prefer guard clauses at function start over deep nesting.
- Do not silently swallow errors.
- If catching unknown values, normalize to `Error` before rethrow/log.
- Use broad `try/catch` only when there is intentional recovery/cleanup behavior.

## Async and Database Safety
- Always await async DB operations.
- Avoid floating promises; if fire-and-forget is intentional, mark it explicitly (`void`) and only for non-critical paths.
- For DB access in sdk/agent-sdk, prefer Kysely queries and typed results.
- In sdk tests, use real `openLix`/SQLite-backed flows (do not mock Lix internals).

## Testing Conventions
- Use Vitest (`test`, `describe`, `expect`) with behavior-focused test names.
- Use Arrange/Act/Assert structure.
- Cover success and failure paths for changes.
- Add or update colocated tests with code changes.
- Browser-specific tests exist in sdk (`*.browser.test.ts`) and can be slower.

## Practical Workflow for Agents
1. Identify target package(s) and run filtered commands.
2. Make minimal, focused edits that match local style.
3. Run package-level `test`, `lint`, and `typecheck` when available.
4. If change is cross-package, run `pnpm ci` before handoff.

## Contribution Hygiene
- Before PRs, repository guidance expects `pnpm run ci`.
- Changesets may be needed for versioned package changes (`npx changeset`).
- Avoid unrelated refactors in the same change.

## If Guidance Conflicts
Use this precedence:
1. Direct user task instructions
2. Package-local docs/config (including `packages/sdk/AGENTS.md`)
3. This root `AGENTS.md`
4. Existing code patterns in the touched files

When uncertain, follow the nearest existing pattern in the same package.
