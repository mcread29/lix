import type { LixEngine } from "../../../engine/boot.js";
import { internalQueryBuilder } from "../../../engine/internal-query-builder.js";
import { parseStatePk } from "../primary-key.js";
import { insertTransactionState } from "../../transaction/insert-transaction-state.js";

export type UntrackedDeleteContext = {
	entity_id: string;
	schema_key: string;
	file_id: string;
	plugin_key: string;
	schema_version: string;
	version_id: string;
};

/**
 * Applies source-tag-aware untracked delete behavior.
 *
 * Returns `true` when a source-tag branch handled the mutation.
 */
export function handleUntrackedDeleteBehavior(args: {
	engine: Pick<LixEngine, "executeSync" | "hooks" | "runtimeCacheRef">;
	timestamp: string;
	primaryKey: string;
	context: UntrackedDeleteContext;
}): boolean {
	const parsed = parseStatePk(args.primaryKey);

	if (parsed.tag === "UI") {
		insertUntrackedDeletionTombstone(args);
		return true;
	}

	if (parsed.tag === "T" || parsed.tag === "TI") {
		insertUntrackedDeletionTombstone(args);
		return true;
	}

	if (parsed.tag === "U") {
		args.engine.executeSync(
			internalQueryBuilder
				.deleteFrom("lix_internal_state_all_untracked")
				.where("entity_id", "=", args.context.entity_id)
				.where("schema_key", "=", args.context.schema_key)
				.where("file_id", "=", args.context.file_id)
				.where("version_id", "=", args.context.version_id)
				.compile()
		);
		return true;
	}

	return false;
}

function insertUntrackedDeletionTombstone(args: {
	engine: Pick<LixEngine, "executeSync" | "hooks" | "runtimeCacheRef">;
	timestamp: string;
	context: UntrackedDeleteContext;
}): void {
	insertTransactionState({
		engine: args.engine,
		timestamp: args.timestamp,
		data: [
			{
				entity_id: args.context.entity_id,
				schema_key: args.context.schema_key,
				file_id: args.context.file_id,
				plugin_key: args.context.plugin_key,
				snapshot_content: null,
				schema_version: args.context.schema_version,
				version_id: args.context.version_id,
				untracked: true,
			},
		],
	});
}
