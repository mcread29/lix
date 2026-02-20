import { describe, expect, test } from "vitest";
import type { LixPlugin } from "../../plugin/lix-plugin.js";
import type { LixEngine } from "../boot.js";
import { createRustHostBridge } from "./host-bridge.js";

describe("rust host bridge", () => {
	test("maps execute statement kind to expected preprocess mode", () => {
		const calls: Array<{
			preprocessMode: "full" | "none" | "vtable-select-only" | undefined;
		}> = [];
		const bridge = createRustHostBridge({
			engine: {
				executeSync: (args) => {
					calls.push({ preprocessMode: args.preprocessMode });
					return { rows: [], rowsAffected: 0 };
				},
				getAllPluginsSync: () => [],
			} as Pick<LixEngine, "executeSync" | "getAllPluginsSync">,
		});

		bridge.execute({
			requestId: "req-1",
			sql: "select 1",
			params: [],
			statementKind: "read_rewrite",
		});
		bridge.execute({
			requestId: "req-2",
			sql: "pragma user_version",
			params: [],
			statementKind: "passthrough",
		});
		bridge.execute({
			requestId: "req-3",
			sql: "insert into file (id, path, data, metadata, hidden) values (?, ?, ?, json(?), 0)",
			params: [],
			statementKind: "write_rewrite",
		});
		bridge.execute({
			requestId: "req-4",
			sql: "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values (?, ?, ?, ?, json(?), ?, json(?), 0)",
			params: [],
			statementKind: "read_rewrite",
		});

		expect(calls).toEqual([
			{ preprocessMode: "full" },
			{ preprocessMode: "none" },
			{ preprocessMode: "full" },
			{ preprocessMode: "full" },
		]);
	});

	test("uses execute metadata for write rows affected", () => {
		const bridge = createRustHostBridge({
			engine: {
				executeSync: () => ({ rows: [], rowsAffected: 2, lastInsertRowId: 41 }),
				getAllPluginsSync: () => [],
			} as Pick<LixEngine, "executeSync" | "getAllPluginsSync">,
		});

		const response = bridge.execute({
			requestId: "req-write",
			sql: "insert into file (id, path, data, metadata, hidden) values (?, ?, ?, json(?), 0)",
			params: [],
			statementKind: "write_rewrite",
		});

		expect(response.rowsAffected).toBe(2);
		expect(response.lastInsertRowId).toBe(41);
	});

	test("uses execute metadata for validation rows affected", () => {
		const bridge = createRustHostBridge({
			engine: {
				executeSync: () => ({ rows: [{ accepted: true }], rowsAffected: 3 }),
				getAllPluginsSync: () => [],
			} as Pick<LixEngine, "executeSync" | "getAllPluginsSync">,
		});

		const response = bridge.execute({
			requestId: "req-validation",
			sql: "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values (?, ?, ?, ?, json(?), ?, json(?), 0)",
			params: [],
			statementKind: "read_rewrite",
		});

		expect(response.rowsAffected).toBe(3);
	});

	test("bridges detectChanges through plugin callback", () => {
		const jsonPlugin: LixPlugin = {
			key: "json",
			detectChanges: ({ before, after }) => {
				const beforeValue = before
					? JSON.parse(new TextDecoder().decode(before.data ?? new Uint8Array()))
					: undefined;
				const afterValue = JSON.parse(
					new TextDecoder().decode(after.data ?? new Uint8Array())
				);
				if (beforeValue?.title === afterValue.title) {
					return [];
				}
				return [
					{
						entity_id: "entity-1",
						snapshot_content: { title: afterValue.title },
						schema: {
							"x-lix-key": "test_item",
							"x-lix-version": "1.0",
							"x-lix-primary-key": ["/id"],
							type: "object",
							properties: {
								id: { type: "string" },
								title: { type: "string" },
							},
							required: ["id", "title"],
							additionalProperties: false,
						},
					},
				];
			},
		};

		const bridge = createRustHostBridge({
			engine: {
				executeSync: () => ({ rows: [], rowsAffected: 0 }),
				getAllPluginsSync: () => [jsonPlugin],
			} as Pick<LixEngine, "executeSync" | "getAllPluginsSync">,
		});

		const response = bridge.detectChanges({
			requestId: "req-3",
			pluginKey: "json",
			before: new TextEncoder().encode(JSON.stringify({ title: "Before" })),
			after: new TextEncoder().encode(JSON.stringify({ title: "After" })),
		});

		expect(response.changes).toHaveLength(1);
		expect(response.changes[0]).toMatchObject({
			entity_id: "entity-1",
			snapshot_content: { title: "After" },
		});
	});

	test("throws deterministic detect changes message when plugin missing", () => {
		const bridge = createRustHostBridge({
			engine: {
				executeSync: () => ({ rows: [], rowsAffected: 0 }),
				getAllPluginsSync: () => [],
			} as Pick<LixEngine, "executeSync" | "getAllPluginsSync">,
		});

		expect(() =>
			bridge.detectChanges({
				requestId: "req-4",
				pluginKey: "json",
				before: new Uint8Array(),
				after: new Uint8Array(),
			})
		).toThrowError("detect changes plugin not found: json");
	});
});
