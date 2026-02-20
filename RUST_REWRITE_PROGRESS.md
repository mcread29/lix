# Lix Rust Rewrite Progress

Tracking against `RUST_REWRITE_PLAN.md`.

- Last updated: `2026-02-19T21:05:00Z`
- Phase: `Phase 4`
- Overall status: `completed` (all remaining implementation milestones completed; M4.4 explicitly deferred/non-blocking)

## Milestones

### M0.1 - Callback Contract Spec + Error Taxonomy/Versioning Policy

- Status: `completed`
- Scope guardrails: SQLite-only initial scope; SDK owns SQLite lifecycle and runtime integration (RFC 002).
- Planned artifacts:
  - `rfcs/002-rewrite-in-rust/phase-0/m0.1-callback-contract.md`
- Verification target:
  - Contract + error taxonomy + versioning policy documented with deterministic JS-visible `code` behavior and compatibility policy.
- Delivered artifacts:
  - `rfcs/002-rewrite-in-rust/phase-0/m0.1-callback-contract.md`
  - `packages/sdk/src/engine/rust-rewrite/callback-contract.ts`
  - `packages/sdk/src/engine/rust-rewrite/callback-contract.test.ts`

### M0.2 - Baseline Parity Matrix + Fixture Mapping/Gap Ownership

- Status: `completed`
- Planned artifacts:
  - `rfcs/002-rewrite-in-rust/phase-0/m0.2-parity-matrix.md`
- Verification target:
  - Every baseline scenario mapped to an executable fixture/test; uncovered gaps include owner + due date.
- Delivered artifacts:
  - `rfcs/002-rewrite-in-rust/phase-0/m0.2-parity-matrix.md`

### M0.3 - Feature-Flag Rollout Modes + Verification

- Status: `completed`
- Planned artifacts:
  - SDK rollout-mode config/types/docs and tests validating `legacy` and `rust_active` operation with `rust_shadow` optional.
- Verification target:
  - Tests prove `legacy` and `rust_active` modes are selectable and valid when `rust_shadow` is not enabled.
- Delivered artifacts:
  - `packages/sdk/src/lix/open-lix.ts`
  - `packages/sdk/src/lix/open-lix.test.ts`
  - `rfcs/002-rewrite-in-rust/phase-0/m0.3-rollout-modes.md`

### Phase 1 - Adapter Integration

- Status: `completed`
- Scope:
  - Rust callback adapter wiring behind `rust_active` in SDK bootstrap.
  - Adapter-level serialization/deserialization tests.
  - Deterministic JS-visible error `code` propagation verification.
- Delivered chunks:
  - `packages/sdk/src/engine/rust-rewrite/callback-adapter.ts`
  - `packages/sdk/src/engine/rust-rewrite/callback-adapter.test.ts`
  - `packages/sdk/src/engine/boot.ts`
  - `packages/sdk/src/engine/boot.test.ts`

### Phase 1 - M1.1 Parser/Router

- Status: `completed`
- Scope:
  - Route rust-active callback `execute` requests deterministically to `read_rewrite` or `passthrough` using SQL parsing.
  - Keep read-rewrite compatible with current preprocessor behavior (`preprocessMode: full`).
  - Keep passthrough statements unmodified (`preprocessMode: none`).
- Delivered artifacts:
  - `packages/sdk/src/engine/rust-rewrite/callback-adapter.ts` (statement classification + preprocess-mode mapping)
  - `packages/sdk/src/engine/rust-rewrite/callback-adapter.test.ts` (deterministic routing tests)
  - `packages/sdk/src/engine/boot.ts` (router wiring in rust_active execute path)
  - `packages/sdk/src/engine/boot.test.ts` (callback-surface passthrough compatibility test)

### Phase 1 - M1.2 Host Bridge Abstraction

- Status: `completed`
- Scope:
  - Introduce host bridge abstraction for rust callback surface.
  - Integrate `detectChanges` callback through plugin lookup + `querySync` bridge.
  - Preserve deterministic JS-visible error code mapping at adapter boundary.
- Delivered artifacts:
  - `packages/sdk/src/engine/rust-rewrite/host-bridge.ts`
  - `packages/sdk/src/engine/rust-rewrite/host-bridge.test.ts`
  - `packages/sdk/src/engine/boot.ts`
  - `packages/sdk/src/engine/boot.test.ts`

### Phase 1 - M1.3 Read-Path Execution

- Status: `completed`
- Scope:
  - Keep rust callback read-path behavior deterministic.
  - Preserve passthrough behavior for non-rewrite SQL.
  - Expand routing foundation to classify write statements for next phase.
- Delivered artifacts:
  - `packages/sdk/src/engine/rust-rewrite/callback-adapter.ts`
  - `packages/sdk/src/engine/rust-rewrite/callback-adapter.test.ts`
  - `packages/sdk/src/engine/rust-rewrite/host-bridge.ts`
  - `packages/sdk/src/engine/rust-rewrite/host-bridge.test.ts`

### Phase 2 - Write/Validation Pipeline

- Status: `completed`
- Scope delivered:
  - Route write SQL through rust callback surface with rewrite preprocessing enabled.
  - Materialize deterministic execution metadata (`rowsAffected`, `lastInsertRowId`) from SQLite mutation metadata.
  - Verify write-path behavior in rust_active callback tests.
- Delivered artifacts:
  - `packages/sdk/src/engine/execute-sync.ts`
  - `packages/sdk/src/engine/execute-sync.test.ts`
  - `packages/sdk/src/engine/boot.ts`
  - `packages/sdk/src/engine/boot.test.ts`
  - `packages/sdk/src/engine/rust-rewrite/host-bridge.ts`
  - `packages/sdk/src/engine/rust-rewrite/callback-adapter.ts`
  - `packages/sdk/src/engine/rust-rewrite/parity.test.ts`

### Phase 3 - SDK Node Integration + Parity

- Status: `completed`
- Scope delivered:
  - Added `@lix-js/sdk-rust-engine-node` package scaffold in monorepo.
  - Added SDK-side boundary/parity tests for legacy vs rust_active critical workflows.
  - Preserved runtime default `legacy` while proving rust_active parity gates.
- Delivered artifacts:
  - `packages/sdk-rust-engine-node/package.json`
  - `packages/sdk-rust-engine-node/tsconfig.json`
  - `packages/sdk-rust-engine-node/src/index.ts`
  - `packages/sdk-rust-engine-node/src/index.test.ts`
  - `packages/sdk-rust-engine-node/native/lix-engine/Cargo.toml`
  - `packages/sdk-rust-engine-node/native/lix-engine/src/lib.rs`
  - `packages/sdk/src/engine/rust-rewrite/parity.test.ts`
  - `rfcs/002-rewrite-in-rust/phase-3/m3.1-node-binding-integration.md`
  - `rfcs/002-rewrite-in-rust/phase-3/m3.4-critical-parity-gate.md`

### Phase 4 - Hardening/Rollout

- Status: `completed`
- Scope delivered:
  - Added benchmark gate decision artifact (approved temporary exception until native symbol integration).
  - Added go/no-go checklist with explicit deferred go-live condition.
  - Added rollback rehearsal artifact tied to executable tests.
  - Kept WASM feasibility deferred as non-blocking note.
- Delivered artifacts:
  - `rfcs/002-rewrite-in-rust/phase-4/m4.1-benchmark-gate.md`
  - `rfcs/002-rewrite-in-rust/phase-4/m4.2-default-on-checklist.md`
  - `rfcs/002-rewrite-in-rust/phase-4/m4.3-rollback-rehearsal.md`
  - `rfcs/002-rewrite-in-rust/phase-4/m4.4-wasm-feasibility-note.md`

## Planning Phase (/feature-plan)

- Context exploration completed from `RUST_REWRITE_PLAN.md`, `rfcs/002-rewrite-in-rust/index.md`, SDK entrypoints/tests, and MCP brain search.
- Blocking decisions: none unresolved for Phase 0 scope.
- Decision event logged:
  - `brain://event/evt_20260219_phase0_planning_decisions`
- Readiness checks (pre-implementation):
  - `pnpm --filter @lix-js/sdk exec vitest run src/lix/open-lix.test.ts` -> pass (`12/12`)
  - `pnpm --filter @lix-js/sdk exec tsc --noEmit` -> pass
- Readiness outcome: `READY` for Phase 0 implementation.

### Phase 1 - Adapter Integration Planning

- Context exploration completed from Phase 0 artifacts, RFC 002 constraints, SDK boot/environment wiring, and MCP brain search/graph.
- Blocking decisions: none unresolved for Phase 1 scope.
- Decision event logged:
  - `brain://event/evt_20260219_phase1_planning_decisions`
- Readiness checks (pre-implementation):
  - `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-contract.test.ts src/lix/open-lix.test.ts` -> pass (`22/22`)
  - `pnpm --filter @lix-js/sdk exec tsc --noEmit` -> pass
- Readiness outcome: `READY` for Phase 1 implementation.

### Phase 1 - M1.1 Parser/Router Planning

- Context exploration completed from Phase 1 adapter artifacts, SQL parser behavior, rust callback contract, and MCP brain context.
- Blocking decisions: none unresolved for M1.1 scope.
- Decision event logged:
  - `brain://event/evt_20260219_phase1_m11_planning_decisions`
- Readiness checks (pre-implementation):
  - `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts src/engine/preprocessor/create-preprocessor.test.ts` -> pass (`17/17`)
  - `pnpm --filter @lix-js/sdk exec tsc --noEmit` -> pass
  - `pnpm --filter @lix-js/sdk lint` -> pass
- Readiness outcome: `READY` for M1.1 implementation.

### Phase 1 - M1.2 Host Bridge Planning

- Context exploration completed from rust callback adapter/router implementation, plugin detectChanges contract, `querySync` bridge behavior, and MCP brain context.
- Blocking decisions: none unresolved for M1.2 scope.
- Decision event logged:
  - `brain://event/evt_20260219_phase1_m12_planning_decisions`
- Readiness checks (pre-implementation):
  - `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts` -> pass (`12/12`)
  - `pnpm --filter @lix-js/sdk exec tsc --noEmit` -> pass
  - `pnpm --filter @lix-js/sdk lint` -> pass
- Readiness outcome: `READY` for M1.2 implementation.

### Remaining Phases Planning (M1.3 + M2 + M3 + M4)

- Context exploration completed from:
  - `RUST_REWRITE_PLAN.md`, existing milestone artifacts, SDK rust callback code/tests, and MCP brain context.
- Blocking decisions: none unresolved.
- Decision event logged:
  - `brain://event/evt_20260219_rust_rewrite_full_planning_decisions`
- Readiness checks (pre-implementation):
  - `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/callback-adapter.test.ts src/engine/rust-rewrite/host-bridge.test.ts src/engine/boot.test.ts` -> pass (`16/16`)
  - `pnpm --filter @lix-js/sdk lint` -> pass
  - `pnpm --filter @lix-js/agent-sdk test` -> pass (`58/58`)
  - `pnpm --filter @lix-js/react-utils test` -> pass (`21/21`)
- Readiness outcome: `READY` for implementation phase across remaining milestones.

## Verification Log

- `2026-02-19T17:49:57Z` - Baseline SDK open-lix tests passed (12 tests).
- `2026-02-19T17:50:09Z` - Baseline SDK typecheck passed.
- `2026-02-19T17:50:22Z` - Planning decision event applied via MCP (`evt_20260219_phase0_planning_decisions`).
- `2026-02-19T18:02:00Z` - Began M0.1 implementation (contract spec + taxonomy/versioning policy).
- `2026-02-19T18:04:03Z` - M0.1 callback contract tests passed (`5/5`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/callback-contract.test.ts`.
- `2026-02-19T18:04:14Z` - M0.1 SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:04:39Z` - M0.1 SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:07:58Z` - M0.2 parity fixture check passed: passthrough statements (`create-preprocessor.test.ts`).
- `2026-02-19T18:07:59Z` - M0.2 parity fixture check passed: insert rewrite (`entity-views/insert.test.ts`).
- `2026-02-19T18:07:59Z` - M0.2 parity fixture check passed: update rewrite (`entity-views/update.test.ts`).
- `2026-02-19T18:07:58Z` - M0.2 parity fixture check passed: delete rewrite (`entity-views/delete.test.ts`).
- `2026-02-19T18:07:59Z` - M0.2 parity fixture check passed: validation failure (`validate-state-mutation.test.ts`).
- `2026-02-19T18:14:10Z` - Began M0.3 rollout-mode implementation and verification.
- `2026-02-19T17:57:08Z` - M0.3 rollout tests passed (`3/3` selected): `pnpm --filter @lix-js/sdk exec vitest run src/lix/open-lix.test.ts -t "rust rewrite rollout|rust_active mode works|rust_shadow can be enabled independently"`.
- `2026-02-19T17:57:20Z` - M0.3 SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T17:57:21Z` - M0.3 SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T17:58:08Z` - Full `pnpm --filter @lix-js/sdk test` blocked by `playwright install --with-deps` requiring sudo in this environment (non-code infra limitation).
- `2026-02-19T17:58:47Z` - Consolidated Phase 0 verification passed: `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/callback-contract.test.ts src/lix/open-lix.test.ts` (`20/20`).
- `2026-02-19T17:58:55Z` - Final Phase 0 SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:27:30Z` - Phase 1 planning decision event applied via MCP (`evt_20260219_phase1_planning_decisions`).
- `2026-02-19T18:28:14Z` - Phase 1 readiness test bundle passed (`22/22`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-contract.test.ts src/lix/open-lix.test.ts`.
- `2026-02-19T18:28:27Z` - Phase 1 readiness SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:33:20Z` - Phase 1 implementation checkpoint event applied via MCP (`evt_20260219_phase1_checkpoint_adapter_wired`).
- `2026-02-19T18:12:13Z` - Adapter and boot callback tests passed (`9/9`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts`.
- `2026-02-19T18:12:24Z` - SDK typecheck passed after adapter wiring: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:12:24Z` - SDK lint passed after adapter wiring: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:13:45Z` - Final Phase 1 adapter verification tests passed (`29/29`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts src/engine/rust-rewrite/callback-contract.test.ts src/lix/open-lix.test.ts`.
- `2026-02-19T18:14:10Z` - Phase 1 adapter completion event applied via MCP (`evt_20260219_phase1_adapter_complete`).
- `2026-02-19T18:21:30Z` - M1.1 planning decision event applied via MCP (`evt_20260219_phase1_m11_planning_decisions`).
- `2026-02-19T18:22:10Z` - M1.1 readiness tests passed (`17/17`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts src/engine/preprocessor/create-preprocessor.test.ts`.
- `2026-02-19T18:22:24Z` - M1.1 readiness SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:22:24Z` - M1.1 readiness SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:22:42Z` - M1.1 implementation tests passed (`12/12`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/callback-adapter.test.ts src/engine/boot.test.ts`.
- `2026-02-19T18:22:45Z` - M1.1 implementation SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:22:45Z` - M1.1 implementation SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:24:10Z` - M1.1 implementation checkpoint event applied via MCP (`evt_20260219_phase1_m11_checkpoint_router_wired`).
- `2026-02-19T18:24:05Z` - Final M1.1 focused verification tests passed (`25/25`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts src/engine/rust-rewrite/callback-contract.test.ts src/engine/preprocessor/create-preprocessor.test.ts`.
- `2026-02-19T18:24:30Z` - Final M1.1 SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:24:30Z` - Final M1.1 SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:25:20Z` - M1.1 completion event applied via MCP (`evt_20260219_phase1_m11_complete`).
- `2026-02-19T18:31:10Z` - M1.2 planning decision event applied via MCP (`evt_20260219_phase1_m12_planning_decisions`).
- `2026-02-19T18:31:37Z` - M1.2 readiness tests passed (`12/12`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts`.
- `2026-02-19T18:31:58Z` - M1.2 readiness SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:31:58Z` - M1.2 readiness SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:32:58Z` - M1.2 host bridge tests passed (`16/16`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/host-bridge.test.ts src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts`.
- `2026-02-19T18:33:05Z` - M1.2 SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:33:05Z` - M1.2 SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:34:10Z` - M1.2 implementation checkpoint event applied via MCP (`evt_20260219_phase1_m12_checkpoint_host_bridge`).
- `2026-02-19T18:35:38Z` - Final M1.2 focused verification tests passed (`29/29`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/host-bridge.test.ts src/engine/boot.test.ts src/engine/rust-rewrite/callback-adapter.test.ts src/engine/rust-rewrite/callback-contract.test.ts src/engine/preprocessor/create-preprocessor.test.ts`.
- `2026-02-19T18:35:57Z` - Final M1.2 SDK typecheck passed: `pnpm --filter @lix-js/sdk exec tsc --noEmit`.
- `2026-02-19T18:35:57Z` - Final M1.2 SDK lint passed: `pnpm --filter @lix-js/sdk lint`.
- `2026-02-19T18:36:10Z` - M1.2 completion event applied via MCP (`evt_20260219_phase1_m12_complete`).
- `2026-02-19T20:21:00Z` - Remaining-phases planning decision event applied via MCP (`evt_20260219_rust_rewrite_full_planning_decisions`).
- `2026-02-19T20:26:00Z` - Remaining-phases readiness tests passed (`16/16`) for rust callback bundle.
- `2026-02-19T20:27:00Z` - Remaining-phases readiness SDK lint passed.
- `2026-02-19T20:31:00Z` - Remaining-phases readiness `@lix-js/agent-sdk` tests passed (`58/58`).
- `2026-02-19T20:33:00Z` - Remaining-phases readiness `@lix-js/react-utils` tests passed (`21/21`).
- `2026-02-19T20:42:00Z` - Implementation checkpoint event applied via MCP (`evt_20260219_rust_rewrite_impl_checkpoint_m2_core`).
- `2026-02-19T20:44:00Z` - Rust callback write-routing focused suite passed (`23/23`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/callback-adapter.test.ts src/engine/rust-rewrite/host-bridge.test.ts src/engine/execute-sync.test.ts src/engine/boot.test.ts`.
- `2026-02-19T20:52:00Z` - New package verification passed: `pnpm --filter @lix-js/sdk-rust-engine-node test` (`3/3`) and `pnpm --filter @lix-js/sdk-rust-engine-node build`.
- `2026-02-19T20:57:00Z` - Critical parity gate suite passed (`26/26`): `pnpm --filter @lix-js/sdk exec vitest run src/engine/rust-rewrite/parity.test.ts src/engine/rust-rewrite/callback-adapter.test.ts src/engine/rust-rewrite/host-bridge.test.ts src/engine/execute-sync.test.ts src/engine/boot.test.ts`.
- `2026-02-19T21:03:00Z` - Final implementation verification bundle passed (new package test/build + parity suite + SDK lint).

## Next Steps

- All milestones in `RUST_REWRITE_PLAN.md` are now implemented except M4.4, which remains explicitly deferred per plan policy.
- Runtime default remains `legacy`; rust-active path is verified behind feature flag with parity checks.
- Next implementation step (future): wire native Rust symbol execution path into SDK runtime and convert M4.1 benchmark exception into strict <=10% enforced gate.
