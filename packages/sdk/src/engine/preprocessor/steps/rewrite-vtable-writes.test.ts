import { expect, test } from "vitest";
import { parse as parseStatements } from "../sql-parser/parse.js";
import { compile } from "../sql-parser/compile.js";
import {
	extractInsertMutationRows,
	isVtableWriteStatement,
	resolveStateWriteVersionId,
	resolveWriteTargetTable,
	rewriteVtableWrites,
} from "./rewrite-vtable-writes.js";
import type { PreprocessorTraceEntry } from "../types.js";
import type { StatementNode } from "../sql-parser/nodes.js";
import { openLix } from "../../../lix/open-lix.js";

const compileSql = (sql: string): string => compile(parseStatements(sql)).sql;

test("leaves non-target SQL unchanged", () => {
	const sql = `
		SELECT id, name
		FROM version
		WHERE id = 'global'
	`;
	const statements = parseStatements(sql);

	const rewritten = rewriteVtableWrites({
		statements,
		parameters: [],
	});

	expect(compile(rewritten).sql).toEqual(compileSql(sql));
});

test("keeps parse/compile roundtrip valid", () => {
	const sql = `
		INSERT INTO state_by_version (
			entity_id,
			schema_key,
			file_id,
			version_id,
			plugin_key,
			snapshot_content,
			schema_version,
			untracked
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const statements = parseStatements(sql);

	const rewritten = rewriteVtableWrites({
		statements,
		parameters: [],
	});

	expect(() => compile(rewritten)).not.toThrow();
	expect(compile(rewritten).sql).toEqual(compileSql(sql));
});

test("emits deterministic trace payload", () => {
	const sql = `UPDATE state SET snapshot_content = ? WHERE entity_id = ?`;
	const traceA: PreprocessorTraceEntry[] = [];
	const traceB: PreprocessorTraceEntry[] = [];

	rewriteVtableWrites({
		statements: parseStatements(sql),
		parameters: [],
		trace: traceA,
	});
	rewriteVtableWrites({
		statements: parseStatements(sql),
		parameters: [],
		trace: traceB,
	});

	expect(traceA).toHaveLength(1);
	expect(traceA).toEqual(traceB);
	expect(traceA[0]).toEqual({
		step: "rewrite_vtable_writes",
		payload: {
			rewritten: false,
			rewritten_count: 0,
			target_statement_count: 1,
		},
	});
});

function firstStatement(sql: string): StatementNode {
	const statements = parseStatements(sql);
	const [segmented] = statements;
	if (!segmented) {
		throw new Error("expected a segmented statement");
	}
	const [segment] = segmented.segments;
	if (!segment || segment.node_kind === "raw_fragment") {
		throw new Error("expected a parsed statement segment");
	}
	return segment;
}

test("detects INSERT/UPDATE/DELETE targets for supported write tables", () => {
	const insert = firstStatement("INSERT INTO state DEFAULT VALUES");
	const update = firstStatement(
		"UPDATE state_by_version SET schema_key = schema_key WHERE entity_id = 'a'"
	);
	const del = firstStatement(
		"DELETE FROM lix_internal_state_vtable WHERE entity_id = 'a'"
	);

	expect(resolveWriteTargetTable(insert)).toBe("state");
	expect(resolveWriteTargetTable(update)).toBe("state_by_version");
	expect(resolveWriteTargetTable(del)).toBe("lix_internal_state_vtable");
	expect(isVtableWriteStatement(insert)).toBe(true);
	expect(isVtableWriteStatement(update)).toBe(true);
	expect(isVtableWriteStatement(del)).toBe(true);
});

test("does not flag non-target or unsupported statements", () => {
	const select = firstStatement("SELECT * FROM state");
	const insertOther = firstStatement("INSERT INTO version (id) VALUES ('x')");

	expect(resolveWriteTargetTable(select)).toBeNull();
	expect(resolveWriteTargetTable(insertOther)).toBeNull();
	expect(isVtableWriteStatement(select)).toBe(false);
	expect(isVtableWriteStatement(insertOther)).toBe(false);
});

test("normalizes target table names across case and qualifiers", () => {
	const insertQualified = firstStatement(
		'INSERT INTO main."STATE_BY_VERSION" DEFAULT VALUES'
	);
	const deleteUpper = firstStatement("DELETE FROM STATE WHERE entity_id = 'x'");

	expect(resolveWriteTargetTable(insertQualified)).toBe("state_by_version");
	expect(resolveWriteTargetTable(deleteUpper)).toBe("state");
});

test("resolves active version id for state writes", () => {
	const versionId = resolveStateWriteVersionId({
		targetTable: "state",
		getActiveVersionId: () => "branch-a",
	});
	expect(versionId).toBe("branch-a");
});

test("returns null for state writes when active version is unavailable", () => {
	const nullVersion = resolveStateWriteVersionId({
		targetTable: "state",
		getActiveVersionId: () => null,
	});
	const emptyVersion = resolveStateWriteVersionId({
		targetTable: "state",
		getActiveVersionId: () => "",
	});

	expect(nullVersion).toBeNull();
	expect(emptyVersion).toBeNull();
});

test("does not resolve version for tables with explicit version_id", () => {
	expect(
		resolveStateWriteVersionId({ targetTable: "state_by_version" })
	).toBeUndefined();
	expect(
		resolveStateWriteVersionId({ targetTable: "lix_internal_state_vtable" })
	).toBeUndefined();
});

test("extracts normalized rows for INSERT ... VALUES", () => {
	const statement = firstStatement(
		"INSERT INTO state_by_version (entity_id, schema_key, version_id) VALUES (?, ?, ?), (?, ?, ?)"
	);
	if (statement.node_kind !== "insert_statement") {
		throw new Error("expected insert statement");
	}

	const extracted = extractInsertMutationRows(statement);
	expect(extracted.supported).toBe(true);
	if (!extracted.supported) {
		throw new Error("expected supported extraction");
	}
	expect(extracted.columns).toEqual([
		"entity_id",
		"schema_key",
		"version_id",
	]);
	expect(extracted.rows).toHaveLength(2);
	expect(extracted.rows[0]?.defaultColumns).toEqual([]);
	expect(Object.keys(extracted.rows[0]?.values ?? {})).toEqual([
		"entity_id",
		"schema_key",
		"version_id",
	]);
});

test("extracts normalized rows for INSERT ... DEFAULT VALUES", () => {
	const statement = firstStatement("INSERT INTO state DEFAULT VALUES");
	if (statement.node_kind !== "insert_statement") {
		throw new Error("expected insert statement");
	}

	const extracted = extractInsertMutationRows(statement);
	expect(extracted).toEqual({
		supported: true,
		columns: [],
		rows: [{ values: {}, defaultColumns: [] }],
	});
});

test("returns fallback for INSERT ... VALUES without explicit columns", () => {
	const statement = firstStatement("INSERT INTO state_by_version VALUES (?, ?, ?)");
	if (statement.node_kind !== "insert_statement") {
		throw new Error("expected insert statement");
	}

	expect(extractInsertMutationRows(statement)).toEqual({
		supported: false,
		reason: "insert_columns_required",
	});
});

test("returns fallback for INSERT row shape mismatch", () => {
	const statement = firstStatement(
		"INSERT INTO state_by_version (entity_id, schema_key) VALUES (?)"
	);
	if (statement.node_kind !== "insert_statement") {
		throw new Error("expected insert statement");
	}

	expect(extractInsertMutationRows(statement)).toEqual({
		supported: false,
		reason: "insert_row_shape_mismatch",
	});
});

test("rewrites supported INSERT into transaction-table physical SQL", async () => {
	const lix = await openLix({});
	const activeVersion = await lix.db
		.selectFrom("active_version")
		.select("version_id")
		.executeTakeFirstOrThrow();

	const statements = parseStatements(`
		INSERT INTO state_by_version (
			entity_id,
			schema_key,
			file_id,
			version_id,
			plugin_key,
			snapshot_content,
			schema_version,
			untracked
		) VALUES (
			'version-tip-1',
			'lix_version_tip',
			'lix',
			'${activeVersion.version_id}',
			'lix_sdk',
			'{"id":"version-tip-1","commit_id":"c1","working_commit_id":"c1"}',
			'1.0',
			0
		)
	`);
	const rewritten = rewriteVtableWrites({
		statements,
		parameters: [],
		getEngine: () => lix.engine!,
	});

	const sql = compile(rewritten).sql;
	expect(sql).toContain("INSERT INTO lix_internal_transaction_state");
	expect(sql).not.toContain("INSERT INTO state_by_version");

	await lix.close();
});

test("falls back when state insert cannot resolve active version", async () => {
	const lix = await openLix({});
	const sql =
		"INSERT INTO state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, untracked) VALUES (?, ?, ?, ?, ?, ?, ?)";
	const statements = parseStatements(sql);

	const rewritten = rewriteVtableWrites({
		statements,
		parameters: [
			"entity-1",
			"lix_key_value",
			"lix",
			"lix_sdk",
			JSON.stringify({ key: "a", value: "b" }),
			"1.0",
			0,
		],
		getEngine: () => lix.engine!,
		getActiveVersionId: () => null,
	});

	expect(compile(rewritten).sql).toEqual(compileSql(sql));

	await lix.close();
});

test("throws for rewritten INSERT when validation fails", async () => {
	const lix = await openLix({});
	const statements = parseStatements(`
		INSERT INTO state_by_version (
			entity_id,
			schema_key,
			file_id,
			version_id,
			plugin_key,
			snapshot_content,
			schema_version,
			untracked
		) VALUES (
			'version-tip-1',
			'lix_version_tip',
			'lix',
			'missing-version',
			'lix_sdk',
			'{"id":"version-tip-1","commit_id":"c1","working_commit_id":"c1"}',
			'1.0',
			0
		)
	`);

	expect(() =>
		rewriteVtableWrites({
			statements,
			parameters: [],
			getEngine: () => lix.engine!,
		})
	).toThrow(/Version with id 'missing-version' does not exist/);

	await lix.close();
});
