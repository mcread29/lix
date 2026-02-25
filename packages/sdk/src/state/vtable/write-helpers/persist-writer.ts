import { internalQueryBuilder } from "../../../engine/internal-query-builder.js";
import type { LixEngine } from "../../../engine/boot.js";

export type PersistWriterArgs = {
	engine: Pick<LixEngine, "executeSync">;
	fileId: string;
	versionId: string;
	entityId: string;
	schemaKey: string;
	writer: string | null;
};

export function persistWriter(args: PersistWriterArgs): void {
	if (args.writer && args.writer.length > 0) {
		args.engine.executeSync(
			internalQueryBuilder
				.insertInto("lix_internal_state_writer")
				.values({
					file_id: args.fileId,
					version_id: args.versionId,
					entity_id: args.entityId,
					schema_key: args.schemaKey,
					writer_key: args.writer,
				})
				.onConflict((oc) =>
					oc
						.columns(["file_id", "version_id", "entity_id", "schema_key"])
						.doUpdateSet({ writer_key: args.writer as any })
				)
				.compile()
		);
		return;
	}

	args.engine.executeSync(
		internalQueryBuilder
			.deleteFrom("lix_internal_state_writer")
			.where("file_id", "=", args.fileId)
			.where("version_id", "=", args.versionId)
			.where("entity_id", "=", args.entityId)
			.where("schema_key", "=", args.schemaKey)
			.compile()
	);
}
