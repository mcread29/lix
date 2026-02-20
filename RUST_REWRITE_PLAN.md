# RFC 002 Rust Rewrite Plan (Phase 5 - Full Engine Execution)

This plan covers the remaining work to make the Rust engine the primary execution path, per RFC 002 Goal 2 (portable Rust engine with JS bindings and host callbacks).
Prior phases (0-4) are archived in `RUST_REWRITE_PLAN_ARCHIVE_20260220.md`.

## Phase 5 Goals

- Move execution ownership into Rust (parse/rewrite/validate/orchestrate in Rust).
- Keep SDK ownership of SQLite lifecycle; Rust calls host callbacks for actual SQL execution and plugin change detection.
- Replace CLI planner usage with a native binding (NAPI-RS) that exposes the Rust engine API to JS.
- Maintain deterministic boundary/error marshalling and parity with legacy path.

## Phase 5 - Full Rust Engine Execution + Node Binding

### M5.1 - Rust Engine Execution Core

- Deliverables:
  - Implement Rust `engine.execute(sql, params, host)` pipeline (parse, rewrite, validate, orchestrate).
  - Wire validation and change detection inside Rust (JSON Schema + CEL + `detectChanges`).
  - Preserve existing SQL dialect (SQLite) and passthrough behavior for non-rewrite statements.
- Verification:
  - Unit tests cover read, write, validation, and passthrough with deterministic error codes.
  - Integration tests cover materialization, validation failures, and plugin change detection.

### M5.2 - Host Callback Bridge (Rust <-> JS)

- Deliverables:
  - Rust host trait matches RFC interface: `execute(sql, params)` and `detectChanges(pluginId, before, after)`.
  - Explicit marshaling for parameters, rows, blobs, and error surfaces.
  - Stable error taxonomy enforced in Rust and preserved through bindings.
- Verification:
  - Boundary parity suite for nulls, integers (including large), floats, blobs, JSON values, and error codes.
  - Deterministic serialization tests for all callback request/response envelopes.

### M5.3 - NAPI-RS Binding (Node)

- Deliverables:
  - Replace CLI planner invocation with NAPI-RS binding exporting `createEngine` and `execute`.
  - Provide `HostCallbacks` implementation backed by JS for SQLite execution.
  - Platform build pipeline for Linux x64 (extend later as needed).
- Verification:
  - `pnpm --filter @lix-js/sdk-rust-engine-node test`
  - `pnpm --filter @lix-js/sdk-rust-engine-node build`
  - End-to-end binding test calls Rust engine and asserts callback invocation sequence.

### M5.4 - SDK Integration (Rust Active Path)

- Deliverables:
  - `rust_active` uses Rust engine execution, not JS execution.
  - Legacy path remains available for rollback.
  - Rust engine output mapped into existing SDK result shapes.
- Verification:
  - SDK integration tests run both `legacy` and `rust_active` in parity.
  - `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/*.test.ts` (expanded suite).

### M5.5 - Parity + Regression Gate

- Deliverables:
  - Full parity suite for critical flows with Rust execution: reads, writes, validation errors, plugin change detection.
  - Performance benchmark comparison vs legacy with strict gate.
- Verification:
  - `pnpm --filter @lix-js/sdk bench` with documented comparison.
  - Update `rfcs/002-rewrite-in-rust/phase-4/m4.1-benchmark-gate.md` with measured outcome.
  - Update `rfcs/002-rewrite-in-rust/phase-4/m4.2-default-on-checklist.md` with go/no-go decision.

### M5.6 - Multi-language Binding Follow-up (Deferred)

- Deliverables:
  - WASM binding feasibility note + C FFI/PyO3 outline.
- Verification:
  - Decision recorded; not blocking Phase 5 completion.

## Acceptance Criteria (Phase 5)

- Rust engine executes full read/write/validation flow and drives host callbacks.
- SDK `rust_active` uses Rust execution path end-to-end.
- Parity suite passes 100% for critical workflows.
- Benchmark gate and go/no-go checklist updated with evidence.

## Required Verification Commands

- `pnpm --filter @lix-js/sdk-rust-engine-node test`
- `pnpm --filter @lix-js/sdk-rust-engine-node build`
- `pnpm --filter @lix-js/sdk exec tsc --noEmit`
- `pnpm --filter @lix-js/sdk lint`
- `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/*.test.ts`
- `pnpm --filter @lix-js/sdk bench`
- `pnpm ci` (before default-on)

## Notes

- SDK retains SQLite ownership; Rust engine uses callbacks to execute SQL and detect plugin changes.
- Error codes remain stable; messages are informational.
- Rollback is always available via `legacy` mode until default-on decision.
