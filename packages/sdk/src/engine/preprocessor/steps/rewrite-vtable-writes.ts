import type { PreprocessorStep } from "../types.js";
import type {
	ExpressionNode,
	InsertStatementNode,
	ObjectNameNode,
	RawFragmentNode,
	SegmentedStatementNode,
	StatementNode,
	TableReferenceNode,
	UpdateStatementNode,
	DeleteStatementNode,
} from "../sql-parser/nodes.js";
import {
	normalizeIdentifierValue,
	sqlStringLiteral,
} from "../sql-parser/ast-helpers.js";
import { validateStateWriteMutation } from "../../../state/vtable/write-helpers/validate-state-write.js";
import { LixStoredSchemaSchema } from "../../../stored-schema/schema-definition.js";
import { setHasOpenTransaction } from "../../../state/vtable/vtable.js";

const TARGET_WRITE_TABLES = new Set([
	"state",
	"state_by_version",
	"lix_internal_state_vtable",
]);

export type VtableWriteTargetTable =
	| "state"
	| "state_by_version"
	| "lix_internal_state_vtable";

export type ResolveStateWriteVersionIdArgs = {
	targetTable: VtableWriteTargetTable;
	getActiveVersionId?: () => string | null;
};

export type NormalizedInsertMutationRow = {
	readonly values: Readonly<Record<string, ExpressionNode>>;
	readonly defaultColumns: readonly string[];
};

export type ExtractInsertMutationRowsResult =
	| {
			readonly supported: true;
			readonly columns: readonly string[];
			readonly rows: readonly NormalizedInsertMutationRow[];
		}
	| {
			readonly supported: false;
			readonly reason:
				| "insert_source_not_supported"
				| "insert_columns_required"
				| "insert_row_shape_mismatch";
		};

/**
 * Extracts a normalized row/column representation for insert rewrites.
 * Supports only:
 * - INSERT ... VALUES (...) with explicit column list
 * - INSERT ... DEFAULT VALUES
 */
export function extractInsertMutationRows(
	statement: InsertStatementNode
): ExtractInsertMutationRowsResult {
	const columns = statement.columns.map((column) =>
		normalizeIdentifierValue(column.value)
	);

	if (statement.source.node_kind === "insert_default_values") {
		return {
			supported: true,
			columns,
			rows: [
				{
					values: {},
					defaultColumns: columns,
				},
			],
		};
	}

	if (statement.source.node_kind !== "insert_values") {
		return {
			supported: false,
			reason: "insert_source_not_supported",
		};
	}

	if (columns.length === 0) {
		return {
			supported: false,
			reason: "insert_columns_required",
		};
	}

	const normalizedRows: NormalizedInsertMutationRow[] = [];
	for (const row of statement.source.rows) {
		if (row.length !== columns.length) {
			return {
				supported: false,
				reason: "insert_row_shape_mismatch",
			};
		}
		const values: Record<string, ExpressionNode> = {};
		for (let index = 0; index < columns.length; index += 1) {
			const column = columns[index];
			const expression = row[index];
			if (!column || !expression) {
				return {
					supported: false,
					reason: "insert_row_shape_mismatch",
				};
			}
			values[column] = expression;
		}
		normalizedRows.push({
			values,
			defaultColumns: [],
		});
	}

	return {
		supported: true,
		columns,
		rows: normalizedRows,
	};
}

type ResolvedInsertRow = {
	readonly entityIdSql: string;
	readonly schemaKeySql: string;
	readonly fileIdSql: string;
	readonly pluginKeySql: string;
	readonly schemaVersionSql: string;
	readonly versionIdSql: string;
	readonly snapshotSql: string;
	readonly metadataSql: string;
	readonly untrackedSql: string;
};

/**
 * Resolves write version ids for tables that do not carry explicit `version_id`
 * in their public SQL surface.
 *
 * - `state` writes require `active_version` and return `null` when unavailable.
 * - `state_by_version` / `lix_internal_state_vtable` keep their explicit version.
 */
export function resolveStateWriteVersionId(
	args: ResolveStateWriteVersionIdArgs
): string | null | undefined {
	if (args.targetTable !== "state") {
		return undefined;
	}
	const value = args.getActiveVersionId?.() ?? null;
	if (typeof value !== "string" || value.length === 0) {
		return null;
	}
	return value;
}

export function isVtableWriteStatement(statement: StatementNode): boolean {
	if (statement.node_kind === "insert_statement") {
		return resolveInsertTargetTable(statement) !== null;
	}
	if (statement.node_kind === "update_statement") {
		return resolveUpdateTargetTable(statement) !== null;
	}
	if (statement.node_kind === "delete_statement") {
		return resolveDeleteTargetTable(statement) !== null;
	}
	return false;
}

export function resolveWriteTargetTable(
	statement: StatementNode
): VtableWriteTargetTable | null {
	if (statement.node_kind === "insert_statement") {
		return resolveInsertTargetTable(statement);
	}
	if (statement.node_kind === "update_statement") {
		return resolveUpdateTargetTable(statement);
	}
	if (statement.node_kind === "delete_statement") {
		return resolveDeleteTargetTable(statement);
	}
	return null;
}

function resolveInsertTargetTable(
	statement: InsertStatementNode
): VtableWriteTargetTable | null {
	return normalizeObjectNameToTarget(statement.target);
}

function resolveUpdateTargetTable(
	statement: UpdateStatementNode
): VtableWriteTargetTable | null {
	return normalizeTableReferenceToTarget(statement.target);
}

function resolveDeleteTargetTable(
	statement: DeleteStatementNode
): VtableWriteTargetTable | null {
	return normalizeTableReferenceToTarget(statement.target);
}

function normalizeTableReferenceToTarget(
	reference: TableReferenceNode
): VtableWriteTargetTable | null {
	return normalizeObjectNameToTarget(reference.name);
}

function normalizeObjectNameToTarget(
	name: ObjectNameNode
): VtableWriteTargetTable | null {
	if (name.parts.length === 0) {
		return null;
	}
	const terminal = name.parts[name.parts.length - 1];
	if (!terminal) {
		return null;
	}
	const normalized = normalizeIdentifierValue(terminal.value);
	if (!TARGET_WRITE_TABLES.has(normalized)) {
		return null;
	}
	return normalized as VtableWriteTargetTable;
}

function countTargetWriteStatements(
	statements: readonly SegmentedStatementNode[]
): number {
	let count = 0;
	for (const statement of statements) {
		for (const segment of statement.segments) {
			if (segment.node_kind === "raw_fragment") {
				continue;
			}
			if (isVtableWriteStatement(segment)) {
				count += 1;
			}
		}
	}
	return count;
}

/**
 * Placeholder step for virtual table write rewrites.
 * Intentionally a no-op in Task 1.
 */
export const rewriteVtableWrites: PreprocessorStep = (context) => {
	const targetStatementCount = countTargetWriteStatements(context.statements);
	let rewrittenCount = 0;
	let changed = false;

	const rewrittenStatements = context.statements.map((statement) => {
		let statementChanged = false;
		const segments = statement.segments.map((segment) => {
			if (segment.node_kind !== "insert_statement") {
				return segment;
			}
			const targetTable = resolveWriteTargetTable(segment);
			if (!targetTable) {
				return segment;
			}
			const rewrittenSql = rewriteInsertStatement({
				statement: segment,
				targetTable,
				context,
			});
			if (!rewrittenSql) {
				return segment;
			}
			statementChanged = true;
			changed = true;
			rewrittenCount += 1;
			const rewrittenSegment: RawFragmentNode = {
				node_kind: "raw_fragment",
				sql_text: rewrittenSql,
			};
			return rewrittenSegment;
		});
		if (!statementChanged) {
			return statement;
		}
		return {
			...statement,
			segments,
		};
	});

	context.trace?.push({
		step: "rewrite_vtable_writes",
		payload: {
			rewritten: rewrittenCount > 0,
			rewritten_count: rewrittenCount,
			target_statement_count: targetStatementCount,
		},
	});
	if (rewrittenCount > 0) {
		const engine = context.getEngine?.();
		if (engine) {
			setHasOpenTransaction(engine, true);
		}
	}

	return changed ? rewrittenStatements : context.statements;
};

function rewriteInsertStatement(args: {
	statement: InsertStatementNode;
	targetTable: VtableWriteTargetTable;
	context: Parameters<PreprocessorStep>[0];
}): string | null {
	const extraction = extractInsertMutationRows(args.statement);
	if (!extraction.supported) {
		return null;
	}

	const resolvedStateVersion = resolveStateWriteVersionId({
		targetTable: args.targetTable,
		getActiveVersionId: args.context.getActiveVersionId,
	});
	if (args.targetTable === "state" && resolvedStateVersion === null) {
		return null;
	}

	const engine = args.context.getEngine?.();
	if (!engine) {
		return null;
	}

	const existingVersionsCache = loadExistingVersionIdSet(engine);
	const rewrittenRows: string[] = [];

	for (const row of extraction.rows) {
		const resolved = resolveInsertRow({
			row,
			targetTable: args.targetTable,
			resolvedStateVersion,
			parameters: args.context.parameters,
			existingVersionsCache,
			engine,
		});
		if (!resolved) {
			return null;
		}
		rewrittenRows.push(buildTransactionInsertSql(resolved));
	}

	if (rewrittenRows.length === 0) {
		return null;
	}

	return rewrittenRows.join("; ");
}

function resolveInsertRow(args: {
	row: NormalizedInsertMutationRow;
	targetTable: VtableWriteTargetTable;
	resolvedStateVersion: string | null | undefined;
	parameters: ReadonlyArray<unknown> | undefined;
	existingVersionsCache: Set<string>;
	engine: NonNullable<ReturnType<NonNullable<Parameters<PreprocessorStep>[0]["getEngine"]>>>;
}): ResolvedInsertRow | null {
	const entityIdExpr = args.row.values["entity_id"];
	const schemaKeyExpr = args.row.values["schema_key"];
	const fileIdExpr = args.row.values["file_id"];
	const pluginKeyExpr = args.row.values["plugin_key"];
	const schemaVersionExpr = args.row.values["schema_version"];
	if (
		!entityIdExpr ||
		!schemaKeyExpr ||
		!fileIdExpr ||
		!pluginKeyExpr ||
		!schemaVersionExpr
	) {
		return null;
	}

	const entityIdValue = evaluateExpressionValue(entityIdExpr, args.parameters);
	const schemaKeyValue = evaluateExpressionValue(schemaKeyExpr, args.parameters);
	const fileIdValue = evaluateExpressionValue(fileIdExpr, args.parameters);
	const pluginKeyValue = evaluateExpressionValue(pluginKeyExpr, args.parameters);
	const schemaVersionValue = evaluateExpressionValue(
		schemaVersionExpr,
		args.parameters
	);
	if (
		typeof entityIdValue !== "string" ||
		typeof schemaKeyValue !== "string" ||
		typeof fileIdValue !== "string" ||
		typeof pluginKeyValue !== "string" ||
		typeof schemaVersionValue !== "string"
	) {
		return null;
	}

	const versionExpr = args.row.values["version_id"];
	let versionIdValue: string | null = null;
	let versionIdSql: string;
	if (args.targetTable === "state") {
		if (!args.resolvedStateVersion) {
			return null;
		}
		versionIdValue = args.resolvedStateVersion;
		versionIdSql = sqlStringLiteral(args.resolvedStateVersion);
	} else {
		if (!versionExpr) {
			return null;
		}
		const versionValue = evaluateExpressionValue(versionExpr, args.parameters);
		if (typeof versionValue !== "string" || versionValue.length === 0) {
			return null;
		}
		versionIdValue = versionValue;
		const renderedVersion = renderExpressionSql(versionExpr);
		if (!renderedVersion) {
			return null;
		}
		versionIdSql = renderedVersion;
	}

	const snapshotExpr = args.row.values["snapshot_content"];
	const metadataExpr = args.row.values["metadata"];
	const untrackedExpr = args.row.values["untracked"];
	const snapshotExprSql = snapshotExpr ? renderExpressionSql(snapshotExpr) : null;
	if (snapshotExpr && !snapshotExprSql) {
		return null;
	}
	const metadataExprSql = metadataExpr ? renderExpressionSql(metadataExpr) : null;
	if (metadataExpr && !metadataExprSql) {
		return null;
	}
	const untrackedExprSql = untrackedExpr ? renderExpressionSql(untrackedExpr) : null;
	if (untrackedExpr && !untrackedExprSql) {
		return null;
	}

	const snapshotSql = snapshotExpr
		? `CASE WHEN ${snapshotExprSql} IS NULL THEN NULL ELSE jsonb(${snapshotExprSql}) END`
		: "NULL";
	const metadataSql = metadataExpr
		? `CASE WHEN ${metadataExprSql} IS NULL THEN NULL ELSE jsonb(${metadataExprSql}) END`
		: "NULL";
	const untrackedSql = untrackedExpr
		? (untrackedExprSql ?? "0")
		: "0";

	const snapshotValue = snapshotExpr
		? evaluateExpressionValue(snapshotExpr, args.parameters)
		: null;
	const metadataValue = metadataExpr
		? evaluateExpressionValue(metadataExpr, args.parameters)
		: null;
	const untrackedValue = untrackedExpr
		? evaluateExpressionValue(untrackedExpr, args.parameters)
		: 0;

	const normalizedSnapshot = normalizeSnapshotPayload(snapshotValue);
	if (normalizedSnapshot === undefined) {
		return null;
	}

	validateStateWriteMutation({
		engine: args.engine,
		schema:
			schemaKeyValue === LixStoredSchemaSchema["x-lix-key"]
				? LixStoredSchemaSchema
				: null,
		schemaKey: schemaKeyValue,
		snapshot_content: normalizedSnapshot,
		operation: "insert",
		entity_id: entityIdValue,
		file_id: fileIdValue,
		version_id: versionIdValue,
		untracked: Boolean(untrackedValue),
		existingVersionsCache: args.existingVersionsCache,
	});

	const entityIdSql = renderExpressionSql(entityIdExpr);
	const schemaKeySql = renderExpressionSql(schemaKeyExpr);
	const fileIdSql = renderExpressionSql(fileIdExpr);
	const pluginKeySql = renderExpressionSql(pluginKeyExpr);
	const schemaVersionSql = renderExpressionSql(schemaVersionExpr);
	if (
		!entityIdSql ||
		!schemaKeySql ||
		!fileIdSql ||
		!pluginKeySql ||
		!schemaVersionSql
	) {
		return null;
	}

	if (schemaKeyValue === "lix_file_descriptor") {
		return null;
	}

	return {
		entityIdSql,
		schemaKeySql,
		fileIdSql,
		pluginKeySql,
		schemaVersionSql,
		versionIdSql,
		snapshotSql,
		metadataSql,
		untrackedSql,
	};
}

function buildTransactionInsertSql(row: ResolvedInsertRow): string {
	return `INSERT INTO lix_internal_transaction_state (id, entity_id, schema_key, schema_version, file_id, plugin_key, version_id, writer_key, snapshot_content, metadata, created_at, untracked) VALUES (lix_uuid_v7(), ${row.entityIdSql}, ${row.schemaKeySql}, ${row.schemaVersionSql}, ${row.fileIdSql}, ${row.pluginKeySql}, ${row.versionIdSql}, lix_get_writer_key(), ${row.snapshotSql}, ${row.metadataSql}, lix_timestamp(), ${row.untrackedSql}) ON CONFLICT(entity_id, file_id, schema_key, version_id) DO UPDATE SET id = excluded.id, plugin_key = excluded.plugin_key, snapshot_content = excluded.snapshot_content, schema_version = excluded.schema_version, created_at = excluded.created_at, untracked = excluded.untracked, writer_key = excluded.writer_key, metadata = excluded.metadata`;
}

function loadExistingVersionIdSet(engine: {
	sqlite: {
		exec: (args: {
			sql: string;
			returnValue: "resultRows";
			rowMode: "object";
			columnNames: [];
		}) => unknown;
	};
}): Set<string> {
	const rows = engine.sqlite.exec({
		sql: "SELECT id FROM version",
		returnValue: "resultRows",
		rowMode: "object",
		columnNames: [],
	}) as Array<{ id: string }>;
	return new Set(rows.map((row) => row.id));
}

function evaluateExpressionValue(
	expression: ExpressionNode,
	parameters: ReadonlyArray<unknown> | undefined
): unknown {
	if (expression.node_kind === "grouped_expression") {
		return evaluateExpressionValue(expression.expression, parameters);
	}
	if (expression.node_kind === "literal") {
		return expression.value;
	}
	if (expression.node_kind === "parameter") {
		const index = expression.position - 1;
		return parameters?.[index];
	}
	return undefined;
}

function renderExpressionSql(expression: ExpressionNode): string | null {
	if (expression.node_kind === "grouped_expression") {
		const inner = renderExpressionSql(expression.expression);
		return inner ? `(${inner})` : null;
	}
	if (expression.node_kind === "parameter") {
		return `?${expression.position}`;
	}
	if (expression.node_kind === "literal") {
		if (expression.value === null) {
			return "NULL";
		}
		if (typeof expression.value === "string") {
			return sqlStringLiteral(expression.value);
		}
		if (typeof expression.value === "boolean") {
			return expression.value ? "1" : "0";
		}
		return String(expression.value);
	}
	return null;
}

function normalizeSnapshotPayload(value: unknown): unknown {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		return JSON.parse(value);
	}
	if (typeof value === "object") {
		return value;
	}
	return undefined;
}
