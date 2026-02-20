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
	test("virtual table and view read parity fixtures between legacy and rust_active", async () => {
		const legacy = await createEngine("legacy");
		const active = await createEngine("rust_active");

		const fixtures = [
			"select count(*) as row_count from lix_internal_state_vtable where schema_key = 'lix_active_version' and version_id = 'global'",
			"select count(*) as row_count from state_by_version where schema_key = 'lix_active_version' and version_id = 'global'",
			"select count(*) as row_count from state where schema_key = 'lix_active_version'",
		] as const;

		for (const sql of fixtures) {
			const legacyResult = legacy.engine.executeSync({ sql, parameters: [] });
			const activeResponse = await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
				requestId: `parity-fixture-${sql.length}`,
				sql,
				paramsJson: "[]",
				statementKind: "passthrough",
			});
			const activeResult = deserializeExecuteResponse(activeResponse as any);
			expect(activeResult.rows).toEqual(legacyResult.rows);
			expect(activeResult.rowsAffected).toBe(activeResult.rows.length);
		}

		legacy.sqlite.close();
		active.sqlite.close();
	});

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

	test("validation path parity between legacy and rust_active for no-op updates", async () => {
		const legacy = await createEngine("legacy");
		const active = await createEngine("rust_active");

		const sql = "update state set metadata = json('{}') where 1 = 0";
		const legacyResult = legacy.engine.executeSync({ sql, parameters: [] });

		const activeResponse = await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
			requestId: "parity-validation-noop",
			sql,
			paramsJson: "[]",
			statementKind: "passthrough",
		});
		const activeResult = deserializeExecuteResponse(activeResponse as any);

		expect(activeResult.rows).toEqual(legacyResult.rows);
		expect(activeResult.rowsAffected).toBe(legacyResult.rowsAffected);

		legacy.sqlite.close();
		active.sqlite.close();
	});

	test("boundary value marshalling parity between legacy and rust_active", async () => {
		const legacy = await createEngine("legacy");
		const active = await createEngine("rust_active");

		const sql =
			"select ? as nullable_value, ? as large_integer, ? as fractional_value, ? as text_value, length(?) as blob_size";
		const parameters = [
			null,
			9007199254740991,
			-0.25,
			"boundary-text",
			new Uint8Array([0, 16, 255]),
		] as const;

		const legacyResult = legacy.engine.executeSync({ sql, parameters });

		const activeResponse = await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
			requestId: "parity-boundary",
			sql,
			paramsJson: JSON.stringify([
				parameters[0],
				parameters[1],
				parameters[2],
				parameters[3],
				Array.from(parameters[4]),
			]),
			statementKind: "passthrough",
		});
		const activeResult = deserializeExecuteResponse(activeResponse as any);

		expect(activeResult.rows).toEqual(legacyResult.rows);

		legacy.sqlite.close();
		active.sqlite.close();
	});

	test("rust_active execute callback keeps deterministic error surfaces", async () => {
		const active = await createEngine("rust_active");

		try {
			await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
				requestId: "parity-errors-1",
				sql: "select * from table_that_does_not_exist",
				paramsJson: "[]",
				statementKind: "read_rewrite",
			});
			expect.fail("expected sqlite execution error");
		} catch (error) {
			expect(error).toMatchObject({ code: "LIX_RUST_SQLITE_EXECUTION" });
		}

		try {
			await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
				requestId: "parity-errors-2",
				sql: "select 1",
				paramsJson: "{\"not\":\"an array\"}",
				statementKind: "read_rewrite",
			});
			expect.fail("expected protocol mismatch");
		} catch (error) {
			expect(error).toMatchObject({ code: "LIX_RUST_PROTOCOL_MISMATCH" });
		}

		try {
			await active.engine.call(LIX_RUST_CALLBACK_EXECUTE, {
				requestId: "parity-errors-3",
				sql: "update stateful set schema_key = 'x' where entity_id = 'e'",
				paramsJson: "[]",
				statementKind: "passthrough",
			});
			expect.fail("expected validation rewrite error");
		} catch (error) {
			expect(error).toMatchObject({ code: "LIX_RUST_REWRITE_VALIDATION" });
		}

		active.sqlite.close();
	});
});
