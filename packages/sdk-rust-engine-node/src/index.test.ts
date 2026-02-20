import { describe, expect, test } from "vitest";

import {
	loadRustEngineBinding,
	planExecuteInRust,
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
