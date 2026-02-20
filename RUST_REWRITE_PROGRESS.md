# Lix Rust Rewrite Progress

Tracking against `RUST_REWRITE_PLAN.md` (Phase 0 only).

- Last updated: `2026-02-19T18:18:10Z`
- Phase: `Phase 0`
- Overall status: `completed` (Phase 0)

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

## Planning Phase (/feature-plan)

- Context exploration completed from `RUST_REWRITE_PLAN.md`, `rfcs/002-rewrite-in-rust/index.md`, SDK entrypoints/tests, and MCP brain search.
- Blocking decisions: none unresolved for Phase 0 scope.
- Decision event logged:
  - `brain://event/evt_20260219_phase0_planning_decisions`
- Readiness checks (pre-implementation):
  - `pnpm --filter @lix-js/sdk exec vitest run src/lix/open-lix.test.ts` -> pass (`12/12`)
  - `pnpm --filter @lix-js/sdk exec tsc --noEmit` -> pass
- Readiness outcome: `READY` for Phase 0 implementation.

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

## Next Steps

1. Start Phase 1 by implementing Rust callback adapter wiring behind `rust_active` in SDK environment bootstrap while preserving SQLite lifecycle ownership in SDK.
2. Add side-by-side adapter-level tests for callback serialization/deserialization and deterministic error `code` propagation from Rust boundary to JS.
3. Keep `legacy` as default and retain `rust_shadow` optional until Phase 1 verification gates pass.
