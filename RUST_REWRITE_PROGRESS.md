# Lix Rust Rewrite Progress

Tracking against `RUST_REWRITE_PLAN.md` (Phase 0 only).

- Last updated: `2026-02-19T18:05:15Z`
- Phase: `Phase 0`
- Overall status: `in_progress`

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

- Status: `pending`
- Planned artifacts:
  - `rfcs/002-rewrite-in-rust/phase-0/m0.2-parity-matrix.md`
- Verification target:
  - Every baseline scenario mapped to an executable fixture/test; uncovered gaps include owner + due date.

### M0.3 - Feature-Flag Rollout Modes + Verification

- Status: `pending`
- Planned artifacts:
  - SDK rollout-mode config/types/docs and tests validating `legacy` and `rust_active` operation with `rust_shadow` optional.
- Verification target:
  - Tests prove `legacy` and `rust_active` modes are selectable and valid when `rust_shadow` is not enabled.

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

## Next Steps

1. Complete M0.2 by producing the baseline parity matrix for read rewrite, write rewrite, validation failures, and passthrough statements.
2. Map each matrix scenario to an executable SDK fixture/test and explicitly record owner + due date for any uncovered gap.
3. Keep scope limited to Phase 0 and retain RFC 002 constraints (SQLite-only, SDK-owned SQLite lifecycle).
