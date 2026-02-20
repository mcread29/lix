# RFC 002 Rust Rewrite Implementation Plan (Granular)

## Goals

- Implement RFC 002 as a phased, verifiable migration of the Lix Engine to Rust.
- Preserve `@lix-js/sdk` ownership of SQLite connections, transaction boundaries, and host runtime integration.
- Keep behavior compatibility for SDK consumers while introducing a Rust engine behind controlled rollout gates.

## Non-Goals

- No non-SQLite dialect support in initial implementation.
- No immediate multi-language binding rollout beyond Node-first integration.
- No breaking change to existing SDK high-level APIs.
- No broad rewrite of unrelated packages unless required for compatibility.

## Proposed Architecture Mapping

### Runtime boundaries

- **Rust engine**: parse, rewrite, validate, and orchestrate SQL flow.
- **SDK (`@lix-js/sdk`)**: own SQLite execution handle and expose callbacks to Rust.
- **Host callbacks**: `execute(sql, params)` and `detectChanges(pluginId, before, after)`.

### Repository mapping

- Primary integration seam: `@lix-js/sdk`.
- Downstream compatibility surface: `@lix-js/agent-sdk`, `@lix-js/react-utils`, plugin packages, website/inspector.
- Tooling gates: pnpm + Nx (`build`, `test`, `lint`, `ci`).
- Package/location decision for this plan:
  - Node binding package: `packages/sdk-rust-engine-node` (`@lix-js/sdk-rust-engine-node`).
  - Rust crate location: `packages/sdk-rust-engine-node/native/lix-engine` (colocated with Node binding).

## Phased Milestones (Granular and Testable)

Each milestone includes concrete deliverables and explicit verification evidence.

### Phase 0 - Contract and Baseline Freeze

#### M0.1 Callback contract spec

- Deliverables:
  - Contract doc for `execute` and `detectChanges` request/response shapes.
  - Error mapping spec (Rust internal error -> SDK-facing error).
  - JS-visible error taxonomy spec:
    - SDK surfaces stable `code` strings; `message` text is non-contractual.
    - Versioning policy: adding new codes is minor, removing/renaming codes is major.
- Verification:
  - Contract review sign-off recorded by SDK maintainers.
  - Schema examples compile/typecheck in SDK test harness.
  - Boundary tests assert deterministic `code` values for representative failure paths.

#### M0.2 Baseline parity matrix

- Deliverables:
  - Matrix covering read rewrite, write rewrite, validation failure, passthrough statements.
  - Fixture inventory linked to existing SDK tests.
- Verification:
  - Matrix maps every scenario to at least one executable test fixture.
  - Gap list has owner + due date for any missing fixture.

#### M0.3 Feature flag plan

- Deliverables:
  - Rollout modes defined: `legacy`, `rust_shadow` (optional), `rust_active`.
  - Decision: `rust_shadow` is optional for first rollout and not required to ship `rust_active` behind flag.
- Verification:
  - Configuration surface documented and testable through SDK initialization path.
  - Tests verify first rollout can run with `legacy` and `rust_active` even when `rust_shadow` is disabled.

### Phase 1 - Rust Engine Skeleton (SQLite-Only)

#### M1.1 Parser and statement router

- Deliverables:
  - Rust engine crate parses SQLite statements and classifies Query / Insert / Update / Delete / Other.
- Verification:
  - Unit tests for statement routing with representative SQL corpus.
  - Invalid SQL returns deterministic parse errors.

#### M1.2 Host bridge abstraction

- Deliverables:
  - Rust trait/interface for host callbacks with typed input/output.
- Verification:
  - Mock host tests verify callback invocation semantics and argument order.

#### M1.3 Read-path execution

- Deliverables:
  - Query rewrite + host execute integration for SELECT path.
- Verification:
  - Golden tests compare logical query result to expected physical query result.
  - Passthrough statements (for example PRAGMA) remain functional.

### Phase 2 - Write Path + Validation

#### M2.1 Mutation extraction

- Deliverables:
  - Insert/Update/Delete mutation extraction logic with deterministic shape.
- Verification:
  - Unit tests cover direct writes and subquery-based writes.

#### M2.2 Materialization pipeline

- Deliverables:
  - Affected-row materialization flow using host `execute` for subquery resolution.
- Verification:
  - Integration tests assert row materialization correctness across fixture mutations.

#### M2.3 Validation engine integration

- Deliverables:
  - JSON Schema + CEL validation execution before physical writes.
- Verification:
  - Negative tests block invalid writes and assert stable error `code` values and structured error fields.
  - Positive tests confirm valid writes proceed.

#### M2.4 Plugin change detection hook

- Deliverables:
  - `detectChanges` callback invoked for relevant file mutation rows (`lix_file` semantics).
- Verification:
  - Tests assert callback trigger conditions and payload determinism.

#### M2.5 Physical SQL emission

- Deliverables:
  - Rewritten physical SQL generation and execution pathway.
- Verification:
  - Integration tests compare side effects with baseline SDK behavior.

### Phase 3 - SDK Node Integration (NAPI-RS First)

#### M3.1 Binding package integration

- Deliverables:
  - Node binding integrated into monorepo package graph/build pipeline.
  - Package names/paths fixed for implementation:
    - `packages/sdk-rust-engine-node` (`@lix-js/sdk-rust-engine-node`)
    - `packages/sdk-rust-engine-node/native/lix-engine` (Rust crate)
  - Initial artifact matrix fixed for first release: Linux x64 only.
- Verification:
  - Build succeeds for binding package and SDK package on Linux x64.
  - Non-Linux targets explicitly marked as deferred in release notes.

#### M3.2 SDK adapter layer

- Deliverables:
  - SDK adapter marshals data/errors between JS and Rust.
- Verification:
  - Boundary contract tests cover nulls, numbers, blobs, and structured errors.

#### M3.3 Flagged runtime selection

- Deliverables:
  - SDK can choose legacy vs Rust execution path through feature flag.
- Verification:
  - Tests assert path selection behavior and fallback correctness.

#### M3.4 Compatibility validation

- Deliverables:
  - Parity run results for critical SDK workflows under Rust flag.
- Verification:
  - 100% pass on the agreed critical parity suite; non-critical failures require explicit owner-approved exceptions.

### Phase 4 - Hardening and Rollout

#### M4.1 Performance and stability gate

- Deliverables:
  - Benchmark/report for representative read/write workloads.
- Verification:
  - Throughput and latency regressions are <= 10% vs legacy on the representative benchmark suite, or have explicit owner-approved exceptions.

#### M4.2 Default-on readiness decision

- Deliverables:
  - Go/no-go checklist for enabling Rust path by default.
- Verification:
  - Checklist signed by SDK owners and release owner.

#### M4.3 Rollback rehearsal

- Deliverables:
  - Validated procedure for switching back to legacy engine path.
- Verification:
  - Rollback tested in CI/release simulation and documented.

#### M4.4 WASM follow-up assessment (deferred)

- Deliverables:
  - Feasibility note for WASM binding after Node path stabilizes.
  - Trigger fixed for reassessment: start only after M4.2 go decision and two consecutive SDK releases without Rust-engine critical incidents.
- Verification:
  - Decision recorded: proceed/defer with rationale and target release window.

## Dependency / Workstream Breakdown

- **Workstream A (Rust engine core)**: M1.x + M2.x.
- **Workstream B (SDK adapter + rollout control)**: M0.3 + M3.x + M4.2/M4.3.
- **Workstream C (verification framework)**: M0.2 + parity and boundary suites across phases.
- **Workstream D (packaging/runtime)**: M3.1 and optional M4.4.
- **Critical path**: M0.1 -> M1.1 -> M2.1/M2.2 -> M2.3/M2.4/M2.5 -> M3.2 -> M3.4 -> M4.2.

## Acceptance Criteria by Phase

- **Phase 0 complete** when contract + parity baseline + rollout mode definitions are approved and test-linked.
- **Phase 1 complete** when read path works through host bridge with deterministic parser/router behavior.
- **Phase 2 complete** when full write pipeline (extract/materialize/validate/detect/rewrite) passes integration parity checks.
- **Phase 3 complete** when SDK runs against Rust engine behind feature flag and critical parity suite passes 100% (with explicit handling for non-critical exceptions).
- **Phase 4 complete** when M4.1/M4.2/M4.3 pass; M4.4 remains deferred and is not a blocker for Phase 4 completion.

## Test and Validation Strategy

- Golden parity suites compare legacy and Rust paths for equivalent inputs/outputs/side effects.
- Boundary contract suites target JS <-> Rust marshaling correctness.
- Required verification commands for touched SDK and integration surface:
  - `pnpm --filter @lix-js/sdk lint`
  - `pnpm --filter @lix-js/sdk typecheck`
  - `pnpm --filter @lix-js/sdk test`
  - `pnpm --filter @lix-js/agent-sdk test`
  - `pnpm --filter @lix-js/react-utils test`
- Broad release gate before default-on: `pnpm ci`.

## Migration and Compatibility Notes

- Migration is internal and flag-driven; public SDK API remains stable.
- SQLite ownership stays in SDK; Rust engine never directly owns DB lifecycle.
- Legacy engine path remains available during rollout for rollback safety.

## Risks and Mitigations

- FFI marshaling drift -> enforce boundary contract tests and stable schema examples.
- Validation semantic mismatch (JSON Schema/CEL) -> golden failure/success fixtures from current behavior.
- Native binding packaging complexity -> Node-first scope, explicit supported-platform matrix.
- Behavioral regressions in write rewrite -> parity matrix with hard fail gates on critical scenarios.
- Performance regressions -> milestone M4.1 benchmark gate before default-on.

## Ownership Assumptions

- SDK maintainers own compatibility contract and rollout decision.
- Rust engine implementers own parser/rewrite/validation internals.
- Release/CI maintainers own final gate execution and publish readiness.

## Resolved Decisions (from prior open questions)

- **Monorepo location and naming**: resolved in `Repository mapping` and milestone `M3.1`.
- **JS-visible error taxonomy**: resolved in milestone `M0.1`.
- **Initial artifact matrix**: resolved in milestone `M3.1`.
- **`rust_shadow` mode**: resolved in milestone `M0.3`.
- **WASM reassessment trigger**: resolved in milestone `M4.4`.

## Remaining Open Questions

- [PENDING]
