import { describe, expect, test } from "vitest";

import {
	loadRustEngineBinding,
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
	test("returns expected module path for supported target", async () => {
		const result = await loadRustEngineBinding();
		expect(result.target).toBe("linux-x64");
		expect(result.modulePath).toBe("@lix-js/sdk-rust-engine-node-linux-x64");
	});
});
