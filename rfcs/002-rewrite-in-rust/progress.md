---
date: "2026-02-20"
---

# Lix Engine Rust Implementation Progress

## Summary

Rust Phase 5 execution-core work is now in place at the Rust crate level (`packages/sdk-rust-engine-node/native/lix-engine/src/lib.rs`) with deterministic routing/planning plus a host-orchestrated execution pipeline (`execute_with_host`).

Current state is **partially complete toward full Rust ownership**:

- Implemented in Rust: statement routing, execute planning, callback-oriented execution flow, validation-path guardrails for `state`/`state_all` mutations, passthrough preservation, plugin change detection orchestration, and deterministic Rust error-code mapping.
- Still not fully moved: semantic SQL rewrite + full mutation materialization/validation parity (JSON Schema + CEL) are not yet fully ported end-to-end from SDK preprocessor behavior.
- Verification status: `pnpm --filter @lix-js/sdk-rust-engine-node test` passes (Rust unit tests, Rust build, TS typecheck, Vitest).

## Progress

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
   - Replace planner-only invocation with `execute_with_host` invocation path from SDK rust mode.
   - Keep SDK-owned SQLite lifecycle and callback contracts unchanged.

2. **Port read rewrite parity from SDK preprocessor to Rust**
   - Implement AST-level SELECT rewrite behavior equivalent to current SDK rewrite pipeline.
   - Add parity fixtures for virtual table/view rewrite outputs and passthrough invariants.

3. **Port write mutation materialization and physical SQL generation**
   - Implement mutation extraction/materialization in Rust for INSERT/UPDATE/DELETE flows.
   - Ensure generated physical SQL preserves SQLite dialect behavior and deterministic ordering.

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
   - Keep rust/legacy toggle and rollback path until parity gates are green.
   - Require package test suites + RFC Phase 5 acceptance tests before marking complete.
