---
date: "2026-02-20"
---

# Lix Engine Rust Implementation Progress

## Summary

Rust Phase 5 execution-core work is now in place at the Rust crate level (`packages/sdk-rust-engine-node/native/lix-engine/src/lib.rs`) with deterministic routing/planning plus a host-orchestrated execution pipeline (`execute_with_host`).

Current state is **partially complete toward full Rust ownership**:

- Implemented in Rust: statement routing, execute planning, callback-oriented execution flow, validation-path guardrails for `state`/`state_all` mutations, passthrough preservation, plugin change detection orchestration, and deterministic Rust error-code mapping.
- Still not fully moved: full entity-view rewrite parity + validation parity (JSON Schema + CEL) are not yet fully ported end-to-end from SDK preprocessor behavior.
- Verification status: `pnpm --filter @lix-js/sdk-rust-engine-node test` passes (Rust unit tests, Rust build, TS typecheck, Vitest).

## Progress

### 2026-02-20 SDK Runtime Wiring Update

Status: **Entry-point wired in SDK rust mode**

- SDK rust-active runtime now injects Rust runtime execution through `executeWithHostInRust` (TS binding for Rust `execute_with_host`) instead of relying only on planner-mode execution in the host bridge.
- Host callback contracts remain unchanged:
  - execute callback request/response shapes are preserved.
  - detectChanges callback request/response shapes are preserved.
- SDK SQLite ownership/lifecycle is unchanged; rust-mode still executes through SDK-owned `engine.executeSync`.
- Non-rust execution behavior remains unchanged (legacy mode path is untouched).
- Host bridge keeps planner fallback behavior when rust runtime module loading is unavailable.
- Added coverage for entrypoint dispatch and callback compatibility:
  - `packages/sdk-rust-engine-node/src/index.test.ts` now verifies read/write/validation/passthrough `executeWithHostInRust` dispatch and detect-changes orchestration.
  - `packages/sdk/src/engine/rust-rewrite/host-bridge.test.ts` now verifies execute_with_host callback compatibility and dispatch integration in SDK host bridge.
- Verified with:
  - `pnpm --filter @lix-js/sdk-rust-engine-node test`
  - `pnpm --filter @lix-js/sdk-rust-engine-node build`
  - `cd packages/sdk && node ./scripts/build.js --setup-only && pnpm exec vitest run src/engine/rust-rewrite/host-bridge.test.ts src/engine/boot.test.ts`
  - `pnpm --filter @lix-js/sdk typecheck`
  - `pnpm --filter @lix-js/sdk-rust-engine-node lint`

### 2026-02-20 Write Mutation Materialization + Physical SQL Update

Status: **Completed for state mutation paths (INSERT/UPDATE/DELETE)**

- Rust execution core now rewrites write mutations for `state`/`state_by_version`/`lix_internal_state_vtable` into deterministic mutation-row CTE SQL for:
  - `INSERT` materialization (`WITH "__lix_mutation_rows" ... VALUES ... INSERT ... SELECT ...`)
  - `UPDATE` materialization + deterministic key ordering (`ORDER BY entity_id, schema_key, file_id, version_id`)
  - `DELETE` materialization + deterministic key ordering.
- Rust router binary now exposes `rewrite` command, and Node bridge dispatch (`executeWithHostInRust`) executes rewritten SQL from Rust before host callback execution.
- SDK rust host bridge now bypasses JS preprocessing for Rust-native state mutation SQL, preserving fallback behavior for non-state write rewrites.
- Added/updated tests:
  - Rust unit coverage in `packages/sdk-rust-engine-node/native/lix-engine/src/lib.rs` for generated physical SQL in INSERT/UPDATE/DELETE scenarios.
  - Node bridge coverage in `packages/sdk-rust-engine-node/src/index.test.ts` for rewritten validation/write execution SQL.
  - SDK bridge expectations in `packages/sdk/src/engine/rust-rewrite/host-bridge.test.ts` for preprocess-mode behavior in Rust-native state mutation execution.
- Linked issue comment/status update:
  - Commented completion details for RFC step 3 scope (state mutation write paths) and marked status as in review for this milestone in this tracker.

### 2026-02-20 Rollout Gate Enforcement Update

Status: **Implemented (gate checks codified + CI-verifiable)**

- Added rollout gate checker script: `scripts/check-rust-rollout-gates.mjs`.
- Added root CI command: `pnpm ci:rust-rollout-gates`.
- Gate checker fails unless RFC Phase 5 completion criteria in this progress tracker are marked completed for:
  - read rewrite parity
  - write mutation materialization parity
  - JSON Schema + CEL validation parity
  - plugin change-detection parity
  - parity/integration test matrix
  - rollout safeguards.
- Rollback/toggle safeguards remain in place (`legacy` and `rust_active` modes); this gate is required before final full-ownership rollout.

### 1. SQL Parsing - `sqlparser-rs`

Status: **In progress (core complete, rewrite parity pending)**

- Rust uses `sqlparser` with `SQLiteDialect` to classify statements (`read_rewrite`, `write_rewrite`, `validation`, `passthrough`) and generate execute plans.
- `execute_with_host` parse-checks rewrite paths and preserves passthrough behavior for non-rewrite statements.
- Validation mutations are guarded to only allow `state`/`state_all` table targets.
- Remaining gap: full AST-level read/write rewrite parity with SDK preprocessor pipeline.

### 2. CEL Validation - `cel-rust`

Status: **Not started in Rust execution core**

- CEL runtime validation remains a planned part of the Rust-native execution flow.
- Current implementation does not yet compile/execute CEL expressions in Rust.

### 3. JSON Schema Validation - `jsonschema`

Status: **Not started in Rust execution core**

- JSON Schema evaluation/compiled schema validation is not yet implemented in Rust execution core.
- Current validation behavior in Rust is structural guardrail validation for validation-statement target tables.

### 4. Host Plugin Callbacks

Status: **Implemented (execution-core level)**

- Rust defines host callback contracts (`HostCallbacks`) for:
  - SQL execution (`execute`)
  - plugin diffing (`detect_changes`)
- `execute_with_host` orchestrates callback usage deterministically:
  - executes SQL through host callbacks,
  - invokes `detect_changes` on write/validation paths when `plugin_change_requests` are provided,
  - aggregates plugin changes into Rust result payload.
- Stable Rust error taxonomy constants are present and enforced in callback error mapping:
  - `LIX_RUST_SQLITE_EXECUTION`
  - `LIX_RUST_DETECT_CHANGES`
  - `LIX_RUST_REWRITE_VALIDATION`
  - `LIX_RUST_UNSUPPORTED_SQLITE_FEATURE`
  - `LIX_RUST_PROTOCOL_MISMATCH`
  - `LIX_RUST_TIMEOUT`
  - `LIX_RUST_UNKNOWN`

### Pipeline/Test Coverage Snapshot

Status: **Implemented with passing tests for core paths**

- Rust unit tests cover:
  - read path
  - write path
  - validation path
  - passthrough path
  - deterministic error-code mapping for execute and detect-changes failures
- Existing package tests remain green via `pnpm --filter @lix-js/sdk-rust-engine-node test`.

## Moving Forward

1. **Wire Rust execution entrypoint into SDK runtime path**
   - Completed for rust-active mode: planner-only invocation path is now replaced with `execute_with_host`-style runtime entrypoint wiring (`executeWithHostInRust`) with fallback retention.
   - SDK-owned SQLite lifecycle and callback contracts remain unchanged.

2. **Port read rewrite parity from SDK preprocessor to Rust**
   - Implement AST-level SELECT rewrite behavior equivalent to current SDK rewrite pipeline.
   - Add parity fixtures for virtual table/view rewrite outputs and passthrough invariants.

3. **Port write mutation materialization and physical SQL generation**
   - Completed for state mutation paths (`state`/`state_by_version`/`lix_internal_state_vtable`) in Rust execution core.
   - Deterministic mutation ordering and physical SQL generation added for INSERT/UPDATE/DELETE.

4. **Implement Rust-native validation engine (JSON Schema + CEL)**
   - Load schema/CEL context from host-executed metadata queries.
   - Validate mutation rows in-memory before physical write execution.
   - Preserve stable error taxonomy, especially `LIX_RUST_REWRITE_VALIDATION`.

5. **Complete plugin change-detection parity**
   - Trigger `detect_changes` only for relevant file mutations (`lix_file`-equivalent semantics).
   - Match SDK callback payload semantics and deterministic aggregation order.

6. **Expand parity and integration test matrix**
   - Add end-to-end tests covering read/write/validation/passthrough against real host callbacks.
   - Add deterministic error-code assertions for parser, callback, validation, and SQLite failures.
   - Add cross-check tests against legacy SDK execution outputs for representative workloads.

7. **Finalize rollout safeguards and completion criteria**
   - Completed: CI-verifiable rollout gate command added (`pnpm ci:rust-rollout-gates`) with explicit criteria checks.
   - Keep rust/legacy toggle and rollback path until parity gates are green.
