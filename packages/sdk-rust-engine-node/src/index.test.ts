import { describe, expect, test } from "vitest";

import {
	loadRustEngineBinding,
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
});
