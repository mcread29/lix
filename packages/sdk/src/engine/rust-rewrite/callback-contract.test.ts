import { describe, expect, test } from "vitest";
import {
	normalizeRustBoundaryError,
	RUST_REWRITE_CALLBACK_CONTRACT_VERSION,
	RUST_REWRITE_ERROR_CODES,
	RUST_REWRITE_ERROR_VERSIONING_POLICY,
	type RustDetectChangesRequest,
	type RustExecuteRequest,
	type RustHostCallbacks,
} from "./callback-contract.js";

describe("rust callback contract", () => {
	test("provides type-safe callback examples", async () => {
		const executeRequest = {
			requestId: "req-1",
			sql: "select 1",
			params: [],
			statementKind: "read_rewrite",
		} satisfies RustExecuteRequest;

		const detectChangesRequest = {
			requestId: "req-2",
			pluginKey: "json",
			before: new Uint8Array([1]),
			after: new Uint8Array([2]),
		} satisfies RustDetectChangesRequest;

		const callbacks: RustHostCallbacks = {
			execute: async (_request) => ({ rows: [], rowsAffected: 0 }),
			detectChanges: async (_request) => ({ changes: [] }),
		};

		await expect(callbacks.execute(executeRequest)).resolves.toMatchObject({
			rowsAffected: 0,
		});
		await expect(
			callbacks.detectChanges(detectChangesRequest)
		).resolves.toMatchObject({ changes: [] });
	});

	test("keeps deterministic code for known structured errors", () => {
		const normalized = normalizeRustBoundaryError({
			code: "LIX_RUST_PROTOCOL_MISMATCH",
			message: "Callback payload did not match schema",
			details: { callback: "execute" },
		});

		expect(normalized.code).toBe("LIX_RUST_PROTOCOL_MISMATCH");
		expect(normalized.message).toBe("Callback payload did not match schema");
	});

	test("maps sqlite failures to sqlite execution code", () => {
		const normalized = normalizeRustBoundaryError(
			new Error("SQLITE_ERROR: no such table: state")
		);

		expect(normalized.code).toBe("LIX_RUST_SQLITE_EXECUTION");
	});

	test("maps unknown data to unknown code", () => {
		const normalized = normalizeRustBoundaryError({ some: "value" });
		expect(normalized.code).toBe("LIX_RUST_UNKNOWN");
	});

	test("declares semver policy for taxonomy changes", () => {
		expect(RUST_REWRITE_CALLBACK_CONTRACT_VERSION).toBe("0.1.0");
		expect(RUST_REWRITE_ERROR_CODES).toContain("LIX_RUST_TIMEOUT");
		expect(RUST_REWRITE_ERROR_VERSIONING_POLICY).toMatchObject({
			addCode: "minor",
			removeCode: "major",
			renameCode: "major",
		});
	});
});
