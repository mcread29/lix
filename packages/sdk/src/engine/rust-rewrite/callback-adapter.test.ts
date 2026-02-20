import { describe, expect, test } from "vitest";
import {
	createRustCallbackAdapter,
	deserializeDetectChangesResponse,
	deserializeExecuteRequest,
	deserializeExecuteResponse,
	routeRustExecuteStatementKind,
	serializeDetectChangesRequest,
	serializeExecuteRequest,
	toExecutePreprocessMode,
} from "./callback-adapter.js";

describe("rust callback adapter", () => {
	test("serializes and deserializes execute payloads", () => {
		const adapter = createRustCallbackAdapter({
			execute: (request) => ({
				rows: [{ echo: request.params[0] }],
				rowsAffected: 1,
			}),
			detectChanges: () => ({ changes: [] }),
		});

		const wireRequest = serializeExecuteRequest({
			requestId: "req-1",
			sql: "select ? as echo",
			params: ["hello"],
			statementKind: "read_rewrite",
		});

		const wireResponse = adapter.executeWire(wireRequest);
		const response = deserializeExecuteResponse(wireResponse);

		expect(response).toEqual({
			rows: [{ echo: "hello" }],
			rowsAffected: 1,
			lastInsertRowId: undefined,
		});
	});

	test("serializes and deserializes detectChanges payloads", () => {
		const adapter = createRustCallbackAdapter({
			execute: () => ({ rows: [], rowsAffected: 0 }),
			detectChanges: (request) => ({
				changes: [
					{
						pluginKey: request.pluginKey,
						beforeBytes: request.before.length,
						afterBytes: request.after.length,
					},
				],
			}),
		});

		const wireRequest = serializeDetectChangesRequest({
			requestId: "req-2",
			pluginKey: "json",
			before: new Uint8Array([1, 2]),
			after: new Uint8Array([3, 4, 5]),
		});

		const wireResponse = adapter.detectChangesWire(wireRequest);
		const response = deserializeDetectChangesResponse(wireResponse);

		expect(response.changes).toEqual([
			{ pluginKey: "json", beforeBytes: 2, afterBytes: 3 },
		]);
	});

	test("maps execute errors to deterministic rust boundary codes", () => {
		const adapter = createRustCallbackAdapter({
			execute: () => {
				throw new Error("SQLITE_ERROR: no such table: state");
			},
			detectChanges: () => ({ changes: [] }),
		});

		try {
			adapter.executeWire({
				requestId: "req-3",
				sql: "select 1",
				paramsJson: "[]",
				statementKind: "read_rewrite",
			});
			expect.fail("expected executeWire to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "LIX_RUST_SQLITE_EXECUTION" });
		}
	});

	test("uses protocol mismatch code for invalid serialized payloads", () => {
		const adapter = createRustCallbackAdapter({
			execute: () => ({ rows: [], rowsAffected: 0 }),
			detectChanges: () => ({ changes: [] }),
		});

		try {
			adapter.executeWire({
				requestId: "req-4",
				sql: "select 1",
				paramsJson: "{\"invalid\":true}",
				statementKind: "read_rewrite",
			});
			expect.fail("expected executeWire to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "LIX_RUST_PROTOCOL_MISMATCH" });
		}
	});

	test("routes read-rewrite SQL deterministically", () => {
		const sql = "select 1 as value";
		expect(routeRustExecuteStatementKind(sql)).toBe("read_rewrite");
		expect(routeRustExecuteStatementKind(sql)).toBe("read_rewrite");
		expect(toExecutePreprocessMode(routeRustExecuteStatementKind(sql))).toBe(
			"full"
		);
	});

	test("routes passthrough SQL deterministically", () => {
		const sql = "pragma user_version";
		expect(routeRustExecuteStatementKind(sql)).toBe("passthrough");
		expect(routeRustExecuteStatementKind(sql)).toBe("passthrough");
		expect(toExecutePreprocessMode(routeRustExecuteStatementKind(sql))).toBe(
			"none"
		);

		const request = deserializeExecuteRequest({
			requestId: "req-5",
			sql,
			paramsJson: "[]",
			statementKind: "read_rewrite",
		});
		expect(request.statementKind).toBe("passthrough");
	});
});
