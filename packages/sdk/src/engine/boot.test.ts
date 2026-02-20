import { expect, test } from "vitest";
import {
	createInMemoryDatabase,
	importDatabase,
} from "../database/sqlite/index.js";
import { newLixFile } from "../lix/new-lix.js";
import { boot } from "./boot.js";
import {
	deserializeDetectChangesResponse,
	deserializeExecuteResponse,
	LIX_RUST_CALLBACK_DETECT_CHANGES,
	LIX_RUST_CALLBACK_EXECUTE,
	serializeDetectChangesRequest,
} from "./rust-rewrite/callback-adapter.js";

test("boot installs engine and triggers plugin on file insert", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	// Seed with a fresh Lix snapshot
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	// Minimal plugin that matches *.md and emits one entity
	const pluginCode = `
      export const plugin = {
        key: 'test_plugin',
        detectChangesGlob: '*.md',
        detectChanges: ({ after }) => {
          return [{
            entity_id: 'e1',
            schema: {
              "x-lix-key": "test_item",
              "x-lix-version": "1.0",
              "x-lix-primary-key": ["/id"],
              "type": "object",
              "properties": { "id": {"type": "string"}, "title": {"type": "string"} },
              "required": ["id", "title"],
              "additionalProperties": false
            },
            snapshot_content: { id: 'e1', title: 'Hello' }
          }];
        }
      };
    `;

	const events: any[] = [];
	const engine = await boot({
		sqlite,
		emit: (ev) => events.push(ev),
		args: { providePluginsRaw: [pluginCode] },
	});

	// Sanity check: execSync should return rows as mapped objects including column names.
	const execResult = engine.executeSync({ sql: "select 1 as value" });
	expect(execResult.rows).toEqual([{ value: 1 }]);

	// Insert a markdown file; plugin should detect a change
	const data = new Uint8Array([1, 2, 3]);
	sqlite.exec({
		sql: `INSERT INTO file (id, path, data, metadata, hidden) VALUES (?, ?, ?, json(?), 0)`,
		bind: ["f1", "/doc.md", data, JSON.stringify({})],
		returnValue: "resultRows",
	});

	// Verify the plugin-produced entity exists
	const rows = sqlite.exec({
		sql: `SELECT COUNT(*) FROM state WHERE schema_key = 'test_item'`,
		returnValue: "resultRows",
	}) as any[];
	const count = Number(rows?.[0]?.[0] ?? 0);
	expect(count).toBeGreaterThan(0);

	// Verify a state_commit event was bridged
	expect(events.find((e) => e?.type === "state_commit")).toBeTruthy();
	sqlite.close();
});

test("execSync.rows returns a mapped object", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {},
	});

	const result = engine.executeSync({
		sql: "select 42 as answer, 'meaning' as label",
	});

	expect(result.rows).toEqual([{ answer: 42, label: "meaning" }]);
	sqlite.close();
});

test("legacy mode does not expose rust callback routes", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {
			rustRewrite: { mode: "legacy" },
		},
	});

	try {
		engine.call(LIX_RUST_CALLBACK_EXECUTE, {
			requestId: "legacy-1",
			sql: "select 1 as value",
			paramsJson: "[]",
			statementKind: "read_rewrite",
		});
		expect.fail("expected legacy call to throw");
	} catch (error) {
		expect(error).toMatchObject({ code: "LIX_CALL_UNKNOWN" });
	}

	sqlite.close();
});

test("rust_active mode exposes rust execute callback route", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {
			rustRewrite: { mode: "rust_active" },
		},
	});

	const response = await engine.call(LIX_RUST_CALLBACK_EXECUTE, {
		requestId: "active-1",
		sql: "select 7 as value",
		paramsJson: "[]",
		statementKind: "read_rewrite",
	});

	const decoded = deserializeExecuteResponse(response as any);
	expect(decoded.rows).toEqual([{ value: 7 }]);
	expect(decoded.rowsAffected).toBe(1);

	sqlite.close();
});

test("rust_active execute route supports passthrough SQL via callback surface", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {
			rustRewrite: { mode: "rust_active" },
		},
	});

	const response = await engine.call(LIX_RUST_CALLBACK_EXECUTE, {
		requestId: "active-2",
		sql: "pragma user_version",
		paramsJson: "[]",
		statementKind: "read_rewrite",
	});

	const decoded = deserializeExecuteResponse(response as any);
	expect(decoded.rows.length).toBe(1);
	expect(decoded.rows[0]).toHaveProperty("user_version");

	sqlite.close();
});

test("rust_active execute route handles write rewrite SQL", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {
			rustRewrite: { mode: "rust_active" },
		},
	});

	const response = await engine.call(LIX_RUST_CALLBACK_EXECUTE, {
		requestId: "active-3",
		sql: "insert into file (id, path, data, metadata, hidden) values (?, ?, zeroblob(0), json(?), 0)",
		paramsJson: JSON.stringify([
			"f-rust-write",
			"/write.md",
			JSON.stringify({}),
		]),
		statementKind: "read_rewrite",
	});

	const decoded = deserializeExecuteResponse(response as any);
	expect(decoded.rowsAffected).toBeGreaterThan(0);

	const rows = sqlite.exec({
		sql: "select id, path from file where id = ?",
		bind: ["f-rust-write"],
		returnValue: "resultRows",
		rowMode: "object",
	}) as Array<Record<string, unknown>>;
	expect(rows).toEqual([{ id: "f-rust-write", path: "/write.md" }]);

	sqlite.close();
});

test("rust_active detectChanges route returns deterministic boundary code", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {
			rustRewrite: { mode: "rust_active" },
		},
	});

	const request = serializeDetectChangesRequest({
		requestId: "active-detect-1",
		pluginKey: "json",
		before: new Uint8Array([1]),
		after: new Uint8Array([2]),
	});

	try {
		await engine.call(LIX_RUST_CALLBACK_DETECT_CHANGES, request);
		expect.fail("expected detect changes call to throw");
	} catch (error) {
		expect(error).toMatchObject({ code: "LIX_RUST_DETECT_CHANGES" });
	}

	sqlite.close();
});

test("rust_active detectChanges route bridges plugin callback response", async () => {
	const sqlite = await createInMemoryDatabase({ readOnly: false });
	const blob = await newLixFile();
	const buf = new Uint8Array(await blob.arrayBuffer());
	importDatabase({ db: sqlite, content: buf });

	const pluginCode = `
      export const plugin = {
        key: 'json',
        detectChanges: ({ before, after }) => {
          const beforeValue = before?.data ? JSON.parse(new TextDecoder().decode(before.data)) : null
          const afterValue = JSON.parse(new TextDecoder().decode(after.data))
          if (beforeValue?.title === afterValue.title) return []
          return [{
            entity_id: 'entity-1',
            schema: {
              "x-lix-key": "test_item",
              "x-lix-version": "1.0",
              "x-lix-primary-key": ["/id"],
              "type": "object",
              "properties": { "id": {"type": "string"}, "title": {"type": "string"} },
              "required": ["id", "title"],
              "additionalProperties": false
            },
            snapshot_content: { id: 'entity-1', title: afterValue.title }
          }]
        }
      }
    `;

	const engine = await boot({
		sqlite,
		emit: () => {},
		args: {
			rustRewrite: { mode: "rust_active" },
			providePluginsRaw: [pluginCode],
		},
	});

	const before = new TextEncoder().encode(JSON.stringify({ title: "Before" }));
	const after = new TextEncoder().encode(JSON.stringify({ title: "After" }));
	const request = serializeDetectChangesRequest({
		requestId: "active-detect-2",
		pluginKey: "json",
		before,
		after,
	});

	const response = await engine.call(LIX_RUST_CALLBACK_DETECT_CHANGES, request);
	const decoded = deserializeDetectChangesResponse(response as any);

	expect(decoded.changes).toHaveLength(1);
	expect(decoded.changes[0]).toMatchObject({
		entity_id: "entity-1",
		snapshot_content: { title: "After" },
	});

	sqlite.close();
});
