import { expect, test } from "vitest";
import { openLix } from "../../../lix/open-lix.js";
import { serializeStatePk } from "../primary-key.js";
import { handleUntrackedDeleteBehavior } from "./delete-behavior.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function baseContext() {
	return {
		entity_id: "entity-1",
		schema_key: "demo_schema",
		file_id: "file-1",
		plugin_key: "demo_plugin",
		schema_version: "1.0",
		version_id: "global",
	} as const;
}

test("handles UI/T/TI branches with untracked tombstones", async () => {
	const lix = await openLix({});

	for (const tag of ["UI", "T", "TI"] as const) {
		const context = {
			...baseContext(),
			entity_id: `entity-${tag}`,
		};
		const handled = handleUntrackedDeleteBehavior({
			engine: lix.engine!,
			timestamp,
			primaryKey: serializeStatePk(tag, "file-1", context.entity_id, "global"),
			context,
		});

		expect(handled).toBe(true);

		const rows = lix.engine!.sqlite.exec({
			sql: "SELECT untracked, json(snapshot_content) AS snapshot_content FROM lix_internal_transaction_state WHERE entity_id = ? AND schema_key = ? AND file_id = ? AND version_id = ?",
			bind: [
				context.entity_id,
				context.schema_key,
				context.file_id,
				context.version_id,
			],
			returnValue: "resultRows",
			rowMode: "object",
			columnNames: [],
		}) as Array<{ untracked: number; snapshot_content: string | null }>;

		expect(rows).toEqual([{ untracked: 1, snapshot_content: null }]);
	}

	await lix.close();
});

test("handles U branch with direct untracked delete", async () => {
	const lix = await openLix({});
	const context = baseContext();

	lix.engine!.sqlite.exec({
		sql: `
			INSERT INTO lix_internal_state_all_untracked (
				entity_id,
				schema_key,
				file_id,
				version_id,
				plugin_key,
				snapshot_content,
				schema_version,
				created_at,
				updated_at,
				inherited_from_version_id,
				is_tombstone
			) VALUES (?, ?, ?, ?, ?, jsonb(?), ?, ?, ?, NULL, 0)
		`,
		bind: [
			context.entity_id,
			context.schema_key,
			context.file_id,
			context.version_id,
			context.plugin_key,
			JSON.stringify({ id: context.entity_id }),
			context.schema_version,
			timestamp,
			timestamp,
		],
		returnValue: "resultRows",
	});

	const handled = handleUntrackedDeleteBehavior({
		engine: lix.engine!,
		timestamp,
		primaryKey: serializeStatePk("U", "file-1", context.entity_id, "global"),
		context,
	});

	expect(handled).toBe(true);

	const rows = lix.engine!.sqlite.exec({
		sql: "SELECT entity_id FROM lix_internal_state_all_untracked WHERE entity_id = ? AND schema_key = ? AND file_id = ? AND version_id = ?",
		bind: [
			context.entity_id,
			context.schema_key,
			context.file_id,
			context.version_id,
		],
		returnValue: "resultRows",
		rowMode: "object",
		columnNames: [],
	});

	expect(rows).toEqual([]);

	await lix.close();
});
