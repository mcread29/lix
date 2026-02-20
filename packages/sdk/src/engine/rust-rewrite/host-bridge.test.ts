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
			{ preprocessMode: "none" },
		]);
	});

	test("uses execute_with_host callback contracts for all dispatch kinds", () => {
		const executeCalls: Array<{
			statementKind: string;
			preprocessMode: "full" | "none" | "vtable-select-only" | undefined;
		}> = [];
		const detectCalls: Array<{ pluginKey: string; requestId: string }> = [];

		const bridge = createRustHostBridge({
			engine: {
				executeSync: (args) => {
					const statementKind =
						args.sql.includes("insert into state")
							? "validation"
							: args.sql.includes("insert into file")
								? "write_rewrite"
								: args.sql.includes("pragma")
									? "passthrough"
									: "read_rewrite";
					executeCalls.push({
						statementKind,
						preprocessMode: args.preprocessMode,
					});
					return {
						rows: statementKind === "passthrough" ? [{ user_version: 1 }] : [],
						rowsAffected:
							statementKind === "write_rewrite" ||
							statementKind === "validation"
								? 2
								: 0,
					};
				},
				getAllPluginsSync: () => [],
			} as Pick<LixEngine, "executeSync" | "getAllPluginsSync">,
			executeWithHost: ({ request, host }) => {
				const plan =
					request.sql.includes("insert into state")
						? "validation"
						: request.sql.includes("insert into file")
							? "write_rewrite"
							: request.sql.includes("pragma")
								? "passthrough"
								: "read_rewrite";
				const executeResponse = host.execute({
					requestId: request.requestId,
					sql: request.sql,
					params: request.params,
					statementKind: plan,
				});
				if (plan === "write_rewrite" || plan === "validation") {
					for (const pluginRequest of request.pluginChangeRequests) {
						host.detectChanges({
							requestId: request.requestId,
							pluginKey: pluginRequest.pluginKey,
							before: pluginRequest.before,
							after: pluginRequest.after,
						});
						detectCalls.push({
							requestId: request.requestId,
							pluginKey: pluginRequest.pluginKey,
						});
					}
				}
				return {
					statementKind: plan,
					rows: executeResponse.rows,
					rowsAffected:
						plan === "read_rewrite" || plan === "passthrough"
							? executeResponse.rows.length
							: executeResponse.rowsAffected,
					lastInsertRowId: executeResponse.lastInsertRowId,
					pluginChanges: [],
				};
			},
		});

		bridge.execute({
			requestId: "read-1",
			sql: "select 1",
			params: [],
			statementKind: "passthrough",
		});
		bridge.execute({
			requestId: "pass-1",
			sql: "pragma user_version",
			params: [],
			statementKind: "read_rewrite",
		});
		bridge.execute({
			requestId: "write-1",
			sql: "insert into file (id, path, data, metadata, hidden) values (?, ?, ?, json(?), 0)",
			params: [],
			statementKind: "passthrough",
		});
		bridge.execute({
			requestId: "validation-1",
			sql: "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values (?, ?, ?, ?, json(?), ?, json(?), 0)",
			params: [],
			statementKind: "passthrough",
		});

		expect(executeCalls).toEqual([
			{ statementKind: "read_rewrite", preprocessMode: "none" },
			{ statementKind: "passthrough", preprocessMode: "none" },
			{ statementKind: "write_rewrite", preprocessMode: "full" },
			{ statementKind: "validation", preprocessMode: "none" },
		]);
		expect(detectCalls).toEqual([]);
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

	test("keeps callback request/response shapes when execute_with_host is configured", () => {
		const hostExecuteRequests: Array<Record<string, unknown>> = [];
		const hostDetectRequests: Array<Record<string, unknown>> = [];
		const plugin: LixPlugin = {
			key: "json",
			detectChanges: () => [],
		};

		const bridge = createRustHostBridge({
			engine: {
				executeSync: () => ({ rows: [], rowsAffected: 5, lastInsertRowId: 17 }),
				getAllPluginsSync: () => [plugin],
			} as Pick<LixEngine, "executeSync" | "getAllPluginsSync">,
			executeWithHost: ({ request, host }) => {
				hostExecuteRequests.push({
					requestId: request.requestId,
					sql: request.sql,
					params: request.params,
					statementKind: "write_rewrite",
				});
				const executeResponse = host.execute({
					requestId: request.requestId,
					sql: request.sql,
					params: request.params,
					statementKind: "write_rewrite",
				});
				hostDetectRequests.push({
					requestId: request.requestId,
					pluginKey: "json",
					before: new Uint8Array(),
					after: new Uint8Array(),
				});
				const detectResponse = host.detectChanges({
					requestId: request.requestId,
					pluginKey: "json",
					before: new Uint8Array(),
					after: new Uint8Array(),
				});
				return {
					statementKind: "write_rewrite",
					rows: executeResponse.rows,
					rowsAffected: executeResponse.rowsAffected,
					lastInsertRowId: executeResponse.lastInsertRowId,
					pluginChanges: detectResponse.changes,
				};
			},
		});

		const response = bridge.execute({
			requestId: "shape-1",
			sql: "insert into file (id, path, data, metadata, hidden) values (?, ?, ?, json(?), 0)",
			params: [],
			statementKind: "passthrough",
		});

		expect(response).toMatchObject({
			rows: [],
			rowsAffected: 5,
			lastInsertRowId: 17,
		});
		expect(hostExecuteRequests).toEqual([
			{
				requestId: "shape-1",
				sql: "insert into file (id, path, data, metadata, hidden) values (?, ?, ?, json(?), 0)",
				params: [],
				statementKind: "write_rewrite",
			},
		]);
		expect(hostDetectRequests).toEqual([
			{
				requestId: "shape-1",
				pluginKey: "json",
				before: new Uint8Array(),
				after: new Uint8Array(),
			},
		]);
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
