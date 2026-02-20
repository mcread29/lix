import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RustEngineBindingTarget = "linux-x64";
export type RustEngineStatementKind =
	| "read_rewrite"
	| "write_rewrite"
	| "validation"
	| "passthrough";

export type RustEnginePreprocessMode = "full" | "none";

export type RustEngineRowsAffectedMode = "rows_length" | "sqlite_changes";

export type RustEngineExecutePlan = {
	statementKind: RustEngineStatementKind;
	preprocessMode: RustEnginePreprocessMode;
	rowsAffectedMode: RustEngineRowsAffectedMode;
};

export type RustEnginePluginChangeRequest = {
	pluginKey: string;
	before: Uint8Array;
	after: Uint8Array;
};

export type RustEngineExecuteWithHostRequest = {
	requestId: string;
	sql: string;
	params: readonly unknown[];
	pluginChangeRequests: readonly RustEnginePluginChangeRequest[];
};

export type RustEngineHostExecuteRequest = {
	requestId: string;
	sql: string;
	params: readonly unknown[];
	statementKind: RustEngineStatementKind;
};

export type RustEngineHostExecuteResponse = {
	rows: readonly Record<string, unknown>[];
	rowsAffected: number;
	lastInsertRowId?: number;
};

export type RustEngineHostDetectChangesRequest = {
	requestId: string;
	pluginKey: string;
	before: Uint8Array;
	after: Uint8Array;
};

export type RustEngineHostDetectChangesResponse = {
	changes: readonly Record<string, unknown>[];
};

export type RustEngineHostCallbacks = {
	execute: (
		request: RustEngineHostExecuteRequest
	) => RustEngineHostExecuteResponse;
	detectChanges: (
		request: RustEngineHostDetectChangesRequest
	) => RustEngineHostDetectChangesResponse;
};

export type RustEngineExecuteWithHostResult = {
	statementKind: RustEngineStatementKind;
	rows: readonly Record<string, unknown>[];
	rowsAffected: number;
	lastInsertRowId?: number;
	pluginChanges: readonly Record<string, unknown>[];
};

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
		output !== "validation" &&
		output !== "passthrough"
	) {
		throw new Error(`invalid rust statement kind: ${output}`);
	}

	return output;
}

export function planExecuteInRust(sql: string): RustEngineExecutePlan {
	const executablePath = resolveRustEngineRouterBinaryPath();
	const result = spawnSync(executablePath, ["plan", sql], {
		encoding: "utf-8",
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(
			`rust planner failed with status ${result.status}: ${result.stderr.trim()}`
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout.trim());
	} catch {
		throw new Error("rust planner returned invalid JSON");
	}

	if (!isExecutePlan(parsed)) {
		throw new Error("invalid rust execute plan shape");
	}

	return parsed;
}

export function rewriteSqlForExecutionInRust(
	sql: string,
	statementKind?: RustEngineStatementKind
): string {
	const executablePath = resolveRustEngineRouterBinaryPath();
	const kind = statementKind ?? routeStatementKindInRust(sql);
	const result = spawnSync(executablePath, ["rewrite", kind, sql], {
		encoding: "utf-8",
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(
			`rust rewriter failed with status ${result.status}: ${result.stderr.trim()}`
		);
	}

	return result.stdout.trim();
}

export function executeWithHostInRust(args: {
	request: RustEngineExecuteWithHostRequest;
	host: RustEngineHostCallbacks;
}): RustEngineExecuteWithHostResult {
	const plan = planExecuteInRust(args.request.sql);
	const rewrittenSql = rewriteSqlForExecutionInRust(
		args.request.sql,
		plan.statementKind
	);
	const executeResponse = args.host.execute({
		requestId: args.request.requestId,
		sql: rewrittenSql,
		params: args.request.params,
		statementKind: plan.statementKind,
	});

	const pluginChanges: Record<string, unknown>[] = [];
	const shouldDispatchDetectChanges =
		plan.statementKind === "write_rewrite" || plan.statementKind === "validation";
	if (shouldDispatchDetectChanges) {
		for (const pluginRequest of args.request.pluginChangeRequests) {
			const detectResponse = args.host.detectChanges({
				requestId: args.request.requestId,
				pluginKey: pluginRequest.pluginKey,
				before: pluginRequest.before,
				after: pluginRequest.after,
			});
			pluginChanges.push(
				...(detectResponse.changes as ReadonlyArray<Record<string, unknown>>)
			);
		}
	}

	return {
		statementKind: plan.statementKind,
		rows: executeResponse.rows,
		rowsAffected:
			plan.rowsAffectedMode === "rows_length"
				? executeResponse.rows.length
				: executeResponse.rowsAffected,
		lastInsertRowId: executeResponse.lastInsertRowId,
		pluginChanges,
	};
}

function isExecutePlan(value: unknown): value is RustEngineExecutePlan {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;
	const statementKind = record.statementKind;
	const preprocessMode = record.preprocessMode;
	const rowsAffectedMode = record.rowsAffectedMode;

	const validStatementKind =
		statementKind === "read_rewrite" ||
		statementKind === "write_rewrite" ||
		statementKind === "validation" ||
		statementKind === "passthrough";
	const validPreprocessMode =
		preprocessMode === "full" || preprocessMode === "none";
	const validRowsAffectedMode =
		rowsAffectedMode === "rows_length" || rowsAffectedMode === "sqlite_changes";

	return validStatementKind && validPreprocessMode && validRowsAffectedMode;
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
