import { describe, expect, test } from "vitest";

import { boot } from "../boot.js";
import {
	createInMemoryDatabase,
	importDatabase,
} from "../../database/sqlite/index.js";
import { newLixFile } from "../../lix/new-lix.js";

import {
	deserializeExecuteResponse,
	LIX_RUST_CALLBACK_EXECUTE,
} from "./callback-adapter.js";

type RolloutMode = "legacy" | "rust_active";

async function createEngine(mode: RolloutMode) {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {
			rustRewrite: { mode },
		},
	});

	return { engine, sqlite };
}

describe("rust rewrite parity", () => {
	test("read query parity between legacy and rust_active", async () => {
		const legacy = await createEngine("legacy");
		const active = await createEngine("rust_active");

		const sql = "select id, path from file order by id limit 1";
		const legacyResult = legacy.engine.executeSync({ sql, parameters: [] });

		const activeResponse = await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
			requestId: "parity-read",
			sql,
			paramsJson: "[]",
			statementKind: "passthrough",
		});
		const activeResult = deserializeExecuteResponse(activeResponse as any);

		expect(activeResult.rows).toEqual(legacyResult.rows);
		expect(activeResult.rowsAffected).toBe(activeResult.rows.length);

		legacy.sqlite.close();
		active.sqlite.close();
	});

	test("passthrough query parity between legacy and rust_active", async () => {
		const legacy = await createEngine("legacy");
		const active = await createEngine("rust_active");

		const sql = "pragma user_version";
		const legacyResult = legacy.engine.executeSync({ sql, parameters: [] });

		const activeResponse = await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
			requestId: "parity-passthrough",
			sql,
			paramsJson: "[]",
			statementKind: "read_rewrite",
		});
		const activeResult = deserializeExecuteResponse(activeResponse as any);

		expect(activeResult.rows).toEqual(legacyResult.rows);

		legacy.sqlite.close();
		active.sqlite.close();
	});

	test("write query parity between legacy and rust_active", async () => {
		const legacy = await createEngine("legacy");
		const active = await createEngine("rust_active");

		const sql =
			"insert into file (id, path, data, metadata, hidden) values (?, ?, zeroblob(0), json(?), 0)";
		const parameters = ["f-parity", "/parity.md", JSON.stringify({})] as const;

		legacy.engine.executeSync({ sql, parameters });
		await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
			requestId: "parity-write",
			sql,
			paramsJson: JSON.stringify(parameters),
			statementKind: "passthrough",
		});

		const legacyRows = legacy.sqlite.exec({
			sql: "select id, path from file where id = ?",
			bind: ["f-parity"],
			returnValue: "resultRows",
			rowMode: "object",
		}) as Array<Record<string, unknown>>;

		const activeRows = active.sqlite.exec({
			sql: "select id, path from file where id = ?",
			bind: ["f-parity"],
			returnValue: "resultRows",
			rowMode: "object",
		}) as Array<Record<string, unknown>>;

		expect(activeRows).toEqual(legacyRows);

		legacy.sqlite.close();
		active.sqlite.close();
	});
});
