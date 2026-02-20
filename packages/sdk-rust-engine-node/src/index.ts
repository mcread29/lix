export type RustEngineBindingTarget = "linux-x64";

export type RustEngineBindingLoadResult = {
	target: RustEngineBindingTarget;
	modulePath: string;
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
		modulePath: "@lix-js/sdk-rust-engine-node-linux-x64",
	};
}
