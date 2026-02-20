import type { LixPlugin } from "../../plugin/lix-plugin.js";
import { createQuerySync } from "../../plugin/query-sync.js";
import type { LixEngine } from "../boot.js";
import {
	planRustExecute,
	toExecutePreprocessMode,
	type RustCallbackAdapterDependencies,
} from "./callback-adapter.js";
import type {
	RustDetectChangesRequest,
	RustDetectChangesResponse,
	RustExecuteRequest,
	RustExecuteResponse,
} from "./callback-contract.js";

type DetectChangesArgs = Parameters<NonNullable<LixPlugin["detectChanges"]>>[0];

export type RustHostBridge = RustCallbackAdapterDependencies;

export type RustExecuteWithHostRequest = {
	requestId: string;
	sql: string;
	params: readonly unknown[];
	pluginChangeRequests: readonly {
		pluginKey: string;
		before: Uint8Array;
		after: Uint8Array;
	}[];
};

export type RustExecuteWithHostResult = {
	statementKind: RustExecuteRequest["statementKind"];
	rows: readonly Record<string, unknown>[];
	rowsAffected: number;
	lastInsertRowId?: number;
	pluginChanges: readonly Record<string, unknown>[];
};

export type RustExecuteWithHost = (args: {
	request: RustExecuteWithHostRequest;
	host: {
		execute: (request: RustExecuteRequest) => RustExecuteResponse;
		detectChanges: (
			request: RustDetectChangesRequest
		) => RustDetectChangesResponse;
	};
}) => RustExecuteWithHostResult;

export function createRustHostBridge(args: {
	engine: Pick<LixEngine, "executeSync" | "getAllPluginsSync">;
	executeWithHost?: RustExecuteWithHost;
}): RustHostBridge {
	const engine = args.engine;
	const hostExecute = (request: RustExecuteRequest) => {
		const result = engine.executeSync({
			sql: request.sql,
			parameters: request.params,
			preprocessMode: toExecutePreprocessMode(request.statementKind),
		});

		return {
			rows: result.rows,
			rowsAffected: result.rowsAffected,
			lastInsertRowId: result.lastInsertRowId,
		};
	};

	return {
		execute: (request) => {
			if (args.executeWithHost) {
				const result = args.executeWithHost({
					request: {
						requestId: request.requestId,
						sql: request.sql,
						params: request.params,
						pluginChangeRequests: [],
					},
					host: {
						execute: hostExecute,
						detectChanges: (detectRequest) =>
							executeDetectChanges({
								engine,
								request: detectRequest,
							}),
					},
				});

				return {
					rows: result.rows,
					rowsAffected: result.rowsAffected,
					lastInsertRowId: result.lastInsertRowId,
				};
			}

				const plan = planRustExecute(request.sql);
				const result = engine.executeSync({
					sql: request.sql,
					parameters: request.params,
					preprocessMode: plan.preprocessMode,
				});

				const rowsAffected =
					plan.rowsAffectedMode === "rows_length"
						? result.rows.length
						: result.rowsAffected;
				return {
					rows: result.rows,
					rowsAffected,
					lastInsertRowId: result.lastInsertRowId,
				};
		},
		detectChanges: (request) => {
			return executeDetectChanges({ engine, request });
		},
	};
}

function executeDetectChanges(args: {
	engine: Pick<LixEngine, "getAllPluginsSync" | "executeSync">;
	request: RustDetectChangesRequest;
}) {
	const plugin = findPlugin({
		plugins: args.engine.getAllPluginsSync(),
		pluginKey: args.request.pluginKey,
	});

	if (!plugin.detectChanges) {
		throw new Error(
			`detect changes callback is unavailable for plugin ${args.request.pluginKey}`
		);
	}

	const querySync = createQuerySync({ engine: args.engine });
	const after = createSyntheticAfterFile(args.request) as DetectChangesArgs["after"];
	const before =
		args.request.before.length === 0
			? undefined
			: (createSyntheticBeforeFile(args.request) as DetectChangesArgs["before"]);

	const changes = plugin.detectChanges({ before, after, querySync });
	return { changes: changes as Record<string, unknown>[] };
}

function findPlugin(args: { plugins: LixPlugin[]; pluginKey: string }): LixPlugin {
	const plugin = args.plugins.find((candidate) => candidate.key === args.pluginKey);
	if (plugin) {
		return plugin;
	}
	throw new Error(`detect changes plugin not found: ${args.pluginKey}`);
}

function createSyntheticAfterFile(request: {
	requestId: string;
	pluginKey: string;
	after: Uint8Array;
}) {
	return {
		id: `${request.pluginKey}-after-${request.requestId}`,
		path: `/rust-callback/${request.pluginKey}.json`,
		metadata: {},
		hidden: false,
		data: request.after,
	};
}

function createSyntheticBeforeFile(request: {
	requestId: string;
	pluginKey: string;
	before: Uint8Array;
}) {
	return {
		id: `${request.pluginKey}-before-${request.requestId}`,
		path: `/rust-callback/${request.pluginKey}.json`,
		metadata: {},
		hidden: false,
		data: request.before,
	};
}
