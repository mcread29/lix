import { describe, expect, test } from "vitest";

import {
	executeWithHostInRust,
	loadRustEngineBinding,
	planExecuteInRust,
	rewriteSqlForExecutionInRust,
	routeStatementKindInRust,
	resolveRustEngineRouterBinaryPath,
	resolveRustEngineBindingTarget,
} from "./index.js";

describe("resolveRustEngineBindingTarget", () => {
	test("resolves linux x64 target", () => {
		expect(resolveRustEngineBindingTarget("linux", "x64")).toBe("linux-x64");
	});

	test("throws for unsupported target", () => {
		expect(() => resolveRustEngineBindingTarget("darwin", "arm64")).toThrow(
			"unsupported rust engine target"
		);
	});
});

describe("loadRustEngineBinding", () => {
	test("returns expected router executable for supported target", async () => {
		const result = await loadRustEngineBinding();
		expect(result.target).toBe("linux-x64");
		expect(result.executablePath).toBe(resolveRustEngineRouterBinaryPath());
	});
});

describe("routeStatementKindInRust", () => {
	test("routes read/write/passthrough statements", () => {
		expect(routeStatementKindInRust("select 1 as value")).toBe("read_rewrite");
		expect(
			routeStatementKindInRust(
				"insert into file (id, path, data, metadata, hidden) values ('id', '/p', zeroblob(0), json('{}'), 0)"
			)
		).toBe("write_rewrite");
		expect(routeStatementKindInRust("pragma user_version")).toBe("passthrough");
	});

	test("routes validation statements", () => {
		expect(
			routeStatementKindInRust(
				"insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values ('entity-1', 'schema', 'file-1', 'json', json('{}'), '1.0', json('{}'), 0)"
			)
		).toBe("validation");
	});
});

describe("planExecuteInRust", () => {
	test("returns plan with preprocess and rows affected policy", () => {
		expect(planExecuteInRust("select 1 as value")).toEqual({
			statementKind: "read_rewrite",
			preprocessMode: "full",
			rowsAffectedMode: "rows_length",
		});

		expect(
			planExecuteInRust(
				"insert into file (id, path, data, metadata, hidden) values ('id', '/p', zeroblob(0), json('{}'), 0)"
			)
		).toEqual({
			statementKind: "write_rewrite",
			preprocessMode: "full",
			rowsAffectedMode: "sqlite_changes",
		});

		expect(planExecuteInRust("pragma user_version")).toEqual({
			statementKind: "passthrough",
			preprocessMode: "none",
			rowsAffectedMode: "rows_length",
		});
	});
});

describe("executeWithHostInRust", () => {
	test("dispatches read_rewrite with rows_length policy", () => {
		const executeCalls: Array<Record<string, unknown>> = [];
		const detectCalls: Array<Record<string, unknown>> = [];

		const result = executeWithHostInRust({
			request: {
				requestId: "read-1",
				sql: "select 1 as value",
				params: [],
				pluginChangeRequests: [],
			},
			host: {
				execute: (request) => {
					executeCalls.push(request as Record<string, unknown>);
					return {
						rows: [{ value: 1 }],
						rowsAffected: 99,
					};
				},
				detectChanges: (request) => {
					detectCalls.push(request as Record<string, unknown>);
					return { changes: [] };
				},
			},
		});

		expect(result.statementKind).toBe("read_rewrite");
		expect(result.rowsAffected).toBe(1);
		expect(executeCalls[0]).toMatchObject({
			requestId: "read-1",
			sql: "select 1 as value",
			statementKind: "read_rewrite",
		});
		expect(detectCalls).toHaveLength(0);
	});

	test("dispatches write_rewrite and detects plugin changes", () => {
		const detectCalls: Array<Record<string, unknown>> = [];
		const before = new Uint8Array([1]);
		const after = new Uint8Array([2]);

		const result = executeWithHostInRust({
			request: {
				requestId: "write-1",
				sql: "insert into file (id, path, data, metadata, hidden) values (?, ?, zeroblob(0), json(?), 0)",
				params: ["f-1", "/f.md", "{}"],
				pluginChangeRequests: [{ pluginKey: "json", before, after }],
			},
			host: {
				execute: () => ({
					rows: [],
					rowsAffected: 2,
					lastInsertRowId: 42,
				}),
				detectChanges: (request) => {
					detectCalls.push(request as Record<string, unknown>);
					return { changes: [{ type: "file_update" }] };
				},
			},
		});

		expect(result.statementKind).toBe("write_rewrite");
		expect(result.rowsAffected).toBe(2);
		expect(result.lastInsertRowId).toBe(42);
		expect(result.pluginChanges).toEqual([{ type: "file_update" }]);
		expect(detectCalls[0]).toMatchObject({
			requestId: "write-1",
			pluginKey: "json",
		});
	});

	test("dispatches validation with sqlite_changes policy", () => {
		const executeCalls: Array<Record<string, unknown>> = [];
		const result = executeWithHostInRust({
			request: {
				requestId: "validation-1",
				sql: "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values ('e1', 'schema', 'f1', 'json', json('{}'), '1.0', json('{}'), 0)",
				params: [],
				pluginChangeRequests: [],
			},
			host: {
				execute: (request) => {
					executeCalls.push(request as Record<string, unknown>);
					return {
						rows: [{ accepted: true }],
						rowsAffected: 3,
					};
				},
				detectChanges: () => ({ changes: [] }),
			},
		});

		expect(result.statementKind).toBe("validation");
		expect(result.rowsAffected).toBe(3);
		expect(executeCalls[0]?.sql).toContain("WITH \"__lix_mutation_rows\"");
		expect(executeCalls[0]?.sql).toContain("INSERT INTO state_by_version");
	});

	test("dispatches passthrough without detectChanges", () => {
		let detectCalled = false;
		const result = executeWithHostInRust({
			request: {
				requestId: "pass-1",
				sql: "pragma user_version",
				params: [],
				pluginChangeRequests: [
					{
						pluginKey: "json",
						before: new Uint8Array([1]),
						after: new Uint8Array([2]),
					},
				],
			},
			host: {
				execute: () => ({
					rows: [{ user_version: 7 }],
					rowsAffected: 44,
				}),
				detectChanges: () => {
					detectCalled = true;
					return { changes: [] };
				},
			},
		});

		expect(result.statementKind).toBe("passthrough");
		expect(result.rowsAffected).toBe(1);
		expect(detectCalled).toBe(false);
	});
});

describe("rewriteSqlForExecutionInRust", () => {
	test("rewrites state updates into deterministic mutation SQL", () => {
		const rewritten = rewriteSqlForExecutionInRust(
			"update state set untracked = 1 where schema_key = 'lix_key_value'",
			"validation"
		);
		const normalized = rewritten.toLowerCase();
		expect(normalized).toContain("with \"__lix_mutation_rows\" as");
		expect(normalized).toContain("update state_by_version set untracked = 1");
		expect(normalized).toContain(
			"order by entity_id, schema_key, file_id, version_id"
		);
	});
});
