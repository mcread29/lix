import type { LixPlugin } from "../../plugin/lix-plugin.js";
import { createQuerySync } from "../../plugin/query-sync.js";
import type { LixEngine } from "../boot.js";
import {
	toExecutePreprocessMode,
	type RustCallbackAdapterDependencies,
} from "./callback-adapter.js";

type DetectChangesArgs = Parameters<NonNullable<LixPlugin["detectChanges"]>>[0];

export type RustHostBridge = RustCallbackAdapterDependencies;

export function createRustHostBridge(args: {
	engine: Pick<LixEngine, "executeSync" | "getAllPluginsSync">;
}): RustHostBridge {
	const engine = args.engine;

	return {
		execute: (request) => {
			const result = engine.executeSync({
				sql: request.sql,
				parameters: request.params,
				preprocessMode: toExecutePreprocessMode(request.statementKind),
			});
			return {
				rows: result.rows,
				rowsAffected: result.rows.length,
			};
		},
		detectChanges: (request) => {
			const plugin = findPlugin({
				plugins: engine.getAllPluginsSync(),
				pluginKey: request.pluginKey,
			});

			if (!plugin.detectChanges) {
				throw new Error(
					`detect changes callback is unavailable for plugin ${request.pluginKey}`
				);
			}

			const querySync = createQuerySync({ engine: args.engine });
			const after = createSyntheticAfterFile(request) as DetectChangesArgs["after"];
			const before =
				request.before.length === 0
					? undefined
					: (createSyntheticBeforeFile(request) as DetectChangesArgs["before"]);

			const changes = plugin.detectChanges({ before, after, querySync });
			return { changes: changes as Record<string, unknown>[] };
		},
	};
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
