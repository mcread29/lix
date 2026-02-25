# Design Log #0001: Current State of Lix

## Background

Lix is positioned as an embeddable version control system for apps and AI workflows. The repository is a TypeScript monorepo orchestrated with `nx` and `pnpm`, with the SDK as the core package and multiple plugins/utilities around it.

Key observed sources:

- Product positioning and examples: `README.md`
- Core SDK package metadata and scripts: `packages/sdk/package.json`
- Supporting packages: `packages/*/package.json`
- SDK usage examples: `packages/sdk/README.md`

## Problem

There is no baseline design log that captures the current architecture and package landscape. Without this baseline, future design logs have no common reference point for:

- current package boundaries,
- maturity stage signals,
- current API interaction patterns,
- and known unknowns that require follow-up.

## Questions and Answers

### Q1: What is the current product stage?

**Answer:** Root docs describe Lix as alpha (`README.md`), while SDK docs describe beta (`packages/sdk/README.md`). We should treat this as an active transition and avoid assuming v1 stability.

### Q2: What is the monorepo center of gravity?

**Answer:** `@lix-js/sdk` is the core runtime package. Most other packages are plugins (`plugin-json`, `plugin-md`, `plugin-csv`, `plugin-prosemirror`), integrations (`react-utils`, `agent-sdk`), tooling/UI (`inspector`, `website`), or protocol schema (`server-protocol-schema`).

### Q3: What usage shape is stable enough to reference today?

**Answer:** The observed usage pattern is:

- Open a Lix instance via `openLix({...})`
- Insert files through SQL (`lix.db.insertInto("file").values({ path, data }).execute()`)
- Query working changes (`selectWorkingDiff({ lix }).selectAll().execute()`)

This should be treated as a current operational pattern, not a hard API contract.

### Q4: What is still unclear and should be answered in later logs?

**Answer:**

- Exact public type contracts for `openLix` options and plugin interfaces.
- Canonical merge/conflict model and invariants across plugins.
- Formal compatibility guarantees across SDK and plugin version lines.

## Design

This initial log defines a lightweight baseline model with four layers:

```mermaid
flowchart TD
  A[Applications / Agents] --> B[@lix-js/sdk]
  B --> C[Plugin Layer]
  C --> D[(SQL Backing Store)]

  C --> C1[@lix-js/plugin-json]
  C --> C2[@lix-js/plugin-md]
  C --> C3[@lix-js/plugin-csv]
  C --> C4[@lix-js/plugin-prosemirror]

  B --> E[@lix-js/react-utils]
  B --> F[@lix-js/agent-sdk]
  B --> G[@lix-js/inspector]
```

Baseline package inventory (current snapshot):

- Core: `@lix-js/sdk`
- Agent integration: `@lix-js/agent-sdk`
- React integration: `@lix-js/react-utils`
- Plugins: `@lix-js/plugin-json`, `@lix-js/plugin-md`, `@lix-js/plugin-csv`, `@lix-js/plugin-prosemirror`
- Tooling/UI: `@lix-js/inspector`, `@lix-js/website`
- Protocol schema: `@lix-js/server-protocol-schema`

Validation rules for future design logs based on this baseline:

- Every new design log should reference this file when discussing package boundaries.
- API changes must cite exact file paths for touched public exports.
- Any breaking change proposal must explicitly state migration expectations for plugin packages.

## Implementation Plan

### Phase 1: Establish baseline docs

- Create initial state log (`design-log/0001-state-of-lix.md`).
- Create index (`design-log/index.md`) with stable, sortable IDs.

### Phase 2: Fill contract gaps

- Add follow-up logs for public SDK type contracts.
- Add follow-up logs for plugin interface contracts and compatibility rules.

### Phase 3: Track implementation outcomes

- As implementation work starts, append an `Implementation Results` section to each relevant design log.
- Document deviations and include test/lint/build outcomes.

## Examples

✅ Good baseline reference:

- "See Design Log #0001 for current package boundaries before proposing cross-package refactors."

✅ Good API pattern (observed):

```ts
const lix = await openLix({
  environment: new InMemoryEnvironment(),
  providePlugins: [json],
});

await lix.db
  .insertInto("file")
  .values({ path: "/settings.json", data: new TextEncoder().encode("{}") })
  .execute();

const diff = await selectWorkingDiff({ lix }).selectAll().execute();
```

❌ Bad baseline reference:

- "Lix architecture is obvious from package names, no need for design logs."

❌ Bad change proposal pattern:

- "Update plugin behavior" without naming affected packages, paths, or compatibility impact.

## Trade-offs

- This baseline is intentionally broad; it improves shared context but does not replace package-level deep dives.
- Capturing a snapshot now risks becoming stale; we accept this because it creates a concrete anchor for future updates.
- We avoid claiming exact API signatures in this log until contract-focused logs verify them from source exports.
