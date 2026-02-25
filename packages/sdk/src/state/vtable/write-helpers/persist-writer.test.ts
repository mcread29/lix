import { expect, test } from "vitest";
import { internalQueryBuilder } from "../../../engine/internal-query-builder.js";
import { openLix } from "../../../lix/open-lix.js";
import { persistWriter } from "./persist-writer.js";

test("upserts and deletes state writer rows", async () => {
	const lix = await openLix({});

	persistWriter({
		engine: lix.engine!,
		fileId: "file-1",
		versionId: "global",
		entityId: "entity-1",
		schemaKey: "demo_schema",
		writer: "writer-a",
	});

	const inserted = lix.engine!.executeSync(
		internalQueryBuilder
			.selectFrom("lix_internal_state_writer")
			.selectAll()
			.where("file_id", "=", "file-1")
			.where("version_id", "=", "global")
			.where("entity_id", "=", "entity-1")
			.where("schema_key", "=", "demo_schema")
			.compile()
	).rows;

	expect(inserted).toHaveLength(1);
	expect(inserted[0]?.writer_key).toBe("writer-a");

	persistWriter({
		engine: lix.engine!,
		fileId: "file-1",
		versionId: "global",
		entityId: "entity-1",
		schemaKey: "demo_schema",
		writer: null,
	});

	const afterDelete = lix.engine!.executeSync(
		internalQueryBuilder
			.selectFrom("lix_internal_state_writer")
			.selectAll()
			.where("file_id", "=", "file-1")
			.where("version_id", "=", "global")
			.where("entity_id", "=", "entity-1")
			.where("schema_key", "=", "demo_schema")
			.compile()
	).rows;

	expect(afterDelete).toHaveLength(0);

	await lix.close();
});
