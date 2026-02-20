import { describe, expect, test, vi } from "vitest";
import type { SqliteWasmDatabase } from "../database/sqlite/create-in-memory-database.js";
import { createExecuteSync } from "./execute-sync.js";
import type { PreprocessorResult } from "./preprocessor/types.js";

describe("createExecuteSync", () => {
	test("passes through bound parameters unchanged", async () => {
		const exec = vi.fn((args: { sql: string }) => {
			if (args.sql.includes("total_changes()") && args.sql.includes("last_insert_rowid()")) {
				return [{ total_changes: 0, last_insert_row_id: 0 }];
			}
			if (args.sql.includes("total_changes()")) {
				return [{ total_changes: 0 }];
			}
			return [];
		});
		const sqlite = { exec } as unknown as SqliteWasmDatabase;
		const preprocess = vi.fn(({ sql, parameters }: PreprocessorResult) => ({
			sql,
			parameters,
		}));

		const executeSync = createExecuteSync({
			engine: {
				sqlite,
				hooks: {} as any,
				runtimeCacheRef: {} as any,
				preprocessQuery: preprocess as any,
			},
		});

		const parameters = [1, "two", { three: 3 }];

		executeSync({ sql: "SELECT ?", parameters });

		expect(preprocess).toHaveBeenCalledWith(
			expect.objectContaining({ sql: "SELECT ?", parameters, mode: "full" })
		);
		expect(exec).toHaveBeenCalledWith(
			expect.objectContaining({ bind: parameters })
		);
	});

	test("passes preprocessing mode through when provided", async () => {
		const exec = vi.fn((args: { sql: string }) => {
			if (args.sql.includes("total_changes()") && args.sql.includes("last_insert_rowid()")) {
				return [{ total_changes: 0, last_insert_row_id: 0 }];
			}
			if (args.sql.includes("total_changes()")) {
				return [{ total_changes: 0 }];
			}
			return [];
		});
		const sqlite = { exec } as unknown as SqliteWasmDatabase;
		const preprocess = vi.fn(({ sql, parameters }: PreprocessorResult) => ({
			sql,
			parameters,
		}));

		const executeSync = createExecuteSync({
			engine: {
				sqlite,
				hooks: {} as any,
				runtimeCacheRef: {} as any,
				preprocessQuery: preprocess as any,
			},
		});

		const sql = "SELECT 1";
		const parameters = [] as any;

		executeSync({ sql, parameters, preprocessMode: "vtable-select-only" });

		expect(preprocess).toHaveBeenCalledWith(
			expect.objectContaining({ sql, parameters, mode: "vtable-select-only" })
		);
		expect(exec).toHaveBeenCalledWith(
			expect.objectContaining({ sql, bind: parameters })
		);
	});

	test("bypasses the preprocessor when specified", async () => {
		const exec = vi.fn((args: { sql: string }) => {
			if (args.sql.includes("total_changes()") && args.sql.includes("last_insert_rowid()")) {
				return [{ total_changes: 0, last_insert_row_id: 0 }];
			}
			if (args.sql.includes("total_changes()")) {
				return [{ total_changes: 0 }];
			}
			return [];
		});
		const sqlite = { exec } as unknown as SqliteWasmDatabase;
		const preprocess = vi.fn();

		const executeSync = createExecuteSync({
			engine: {
				sqlite,
				hooks: {} as any,
				runtimeCacheRef: {} as any,
				preprocessQuery: preprocess as any,
			},
		});

		const sql = "SELECT 1";
		const parameters = [] as any;

		executeSync({ sql, parameters, preprocessMode: "none" });

		expect(preprocess).not.toHaveBeenCalled();
		expect(exec).toHaveBeenCalledWith(
			expect.objectContaining({ sql, bind: parameters })
		);
	});

	test("returns sqlite metadata for mutation statements", async () => {
		let totalChanges = 5;
		const exec = vi.fn((args: { sql: string }) => {
			if (args.sql.includes("total_changes()") && args.sql.includes("last_insert_rowid()")) {
				return [{ total_changes: totalChanges, last_insert_row_id: 99 }];
			}
			if (args.sql.includes("total_changes()")) {
				return [{ total_changes: totalChanges }];
			}
			totalChanges += 2;
			return [];
		});
		const sqlite = { exec } as unknown as SqliteWasmDatabase;
		const preprocess = vi.fn(({ sql, parameters }: PreprocessorResult) => ({
			sql,
			parameters,
		}));

		const executeSync = createExecuteSync({
			engine: {
				sqlite,
				hooks: {} as any,
				runtimeCacheRef: {} as any,
				preprocessQuery: preprocess as any,
			},
		});

		const result = executeSync({ sql: "insert into file values (?)", parameters: [] });

		expect(result.rowsAffected).toBe(2);
		expect(result.lastInsertRowId).toBe(99);
	});

	test("normalizes binary bind parameters to Uint8Array", async () => {
		const exec = vi.fn((args: { sql: string; bind?: unknown[] }) => {
			if (args.sql.includes("total_changes()") && args.sql.includes("last_insert_rowid()")) {
				return [{ total_changes: 0, last_insert_row_id: 0 }];
			}
			if (args.sql.includes("total_changes()")) {
				return [{ total_changes: 0 }];
			}
			return [];
		});
		const sqlite = { exec } as unknown as SqliteWasmDatabase;
		const preprocess = vi.fn(({ sql, parameters }: PreprocessorResult) => ({
			sql,
			parameters,
		}));

		const executeSync = createExecuteSync({
			engine: {
				sqlite,
				hooks: {} as any,
				runtimeCacheRef: {} as any,
				preprocessQuery: preprocess as any,
			},
		});

		const bytes = new Uint8Array([1, 2, 3]);
		executeSync({
			sql: "insert into file (data) values (?)",
			parameters: [bytes],
		});

		expect(exec).toHaveBeenCalledWith(
			expect.objectContaining({
				bind: [bytes],
			})
		);
	});
});
