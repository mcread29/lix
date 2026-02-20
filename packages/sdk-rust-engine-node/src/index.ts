import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RustEngineBindingTarget = "linux-x64";
export type RustEngineStatementKind =
	| "read_rewrite"
	| "write_rewrite"
	| "passthrough";

export type RustEngineBindingLoadResult = {
	target: RustEngineBindingTarget;
	executablePath: string;
};

export function resolveRustEngineBindingTarget(
	platform = process.platform,
	arch = process.arch
): RustEngineBindingTarget {
	if (platform === "linux" && arch === "x64") {
		return "linux-x64";
	}

	throw new Error(
		`unsupported rust engine target: ${platform}-${arch}; only linux-x64 is enabled in this rollout`
	);
}

export async function loadRustEngineBinding(): Promise<RustEngineBindingLoadResult> {
	const target = resolveRustEngineBindingTarget();

	return {
		target,
		executablePath: resolveRustEngineRouterBinaryPath(),
	};
}

export function routeStatementKindInRust(sql: string): RustEngineStatementKind {
	const executablePath = resolveRustEngineRouterBinaryPath();
	const result = spawnSync(executablePath, ["route", sql], {
		encoding: "utf-8",
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(
			`rust router failed with status ${result.status}: ${result.stderr.trim()}`
		);
	}

	const output = result.stdout.trim();
	if (
		output !== "read_rewrite" &&
		output !== "write_rewrite" &&
		output !== "passthrough"
	) {
		throw new Error(`invalid rust statement kind: ${output}`);
	}

	return output;
}

export function resolveRustEngineRouterBinaryPath(): string {
	const fromEnv = process.env.LIX_RUST_ENGINE_ROUTER_BIN;
	if (fromEnv && existsSync(fromEnv)) {
		return fromEnv;
	}

	const packageRoot = path.resolve(
		fileURLToPath(new URL(".", import.meta.url)),
		".."
	);
	const binaryName = "lix-engine-router";
	const candidates = [
		path.join(packageRoot, "target", "release", binaryName),
		path.join(packageRoot, "target", "debug", binaryName),
		path.join(
			packageRoot,
			"native",
			"lix-engine",
			"target",
			"release",
			binaryName
		),
		path.join(
			packageRoot,
			"native",
			"lix-engine",
			"target",
			"debug",
			binaryName
		),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		"rust engine router binary not found; run `pnpm --filter @lix-js/sdk-rust-engine-node build`"
	);
}
