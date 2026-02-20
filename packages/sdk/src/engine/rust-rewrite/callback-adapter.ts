import {
	normalizeRustBoundaryError,
	RustBoundaryError,
	type RustDetectChangesRequest,
	type RustDetectChangesResponse,
	type RustExecuteRequest,
	type RustExecuteResponse,
} from "./callback-contract.js";
import type { FunctionRegistry } from "../functions/function-registry.js";
import { parse } from "../preprocessor/sql-parser/parse.js";

export const LIX_RUST_CALLBACK_EXECUTE = "lix_rust_callback_execute";
export const LIX_RUST_CALLBACK_DETECT_CHANGES =
	"lix_rust_callback_detect_changes";

export type RustExecuteWireRequest = {
	requestId: string;
	sql: string;
	paramsJson: string;
	statementKind: RustExecuteRequest["statementKind"];
};

export type RustExecuteWireResponse = {
	rowsJson: string;
	rowsAffected: number;
	lastInsertRowId?: number;
};

export type RustDetectChangesWireRequest = {
	requestId: string;
	pluginKey: string;
	beforeJson: string;
	afterJson: string;
};

export type RustDetectChangesWireResponse = {
	changesJson: string;
};

export type RustCallbackAdapterDependencies = {
	execute: (request: RustExecuteRequest) => RustExecuteResponse;
	detectChanges: (
		request: RustDetectChangesRequest
	) => RustDetectChangesResponse;
};

export type RegisterRustCallbackAdapterArgs = {
	register: FunctionRegistry["register"];
	deps: RustCallbackAdapterDependencies;
};

export type RustCallbackAdapter = {
	executeWire: (request: RustExecuteWireRequest) => RustExecuteWireResponse;
	detectChangesWire: (
		request: RustDetectChangesWireRequest
	) => RustDetectChangesWireResponse;
};

export type RustRoutedStatementKind = Extract<
	RustExecuteRequest["statementKind"],
	"read_rewrite" | "write_rewrite" | "passthrough"
>;

export type RustStatementKindRouter = (
	sql: string
) => RustRoutedStatementKind;

let configuredRustStatementKindRouter: RustStatementKindRouter | undefined;

export function configureRustStatementKindRouter(
	router: RustStatementKindRouter | undefined
): void {
	configuredRustStatementKindRouter = router;
}

export function createRustCallbackAdapter(
	deps: RustCallbackAdapterDependencies
): RustCallbackAdapter {
	return {
		executeWire: (request) => {
			try {
				const normalized = deserializeExecuteRequest(request);
				const response = deps.execute(normalized);
				return serializeExecuteResponse(response);
			} catch (error) {
				throw normalizeRustBoundaryError(error);
			}
		},
		detectChangesWire: (request) => {
			try {
				const normalized = deserializeDetectChangesRequest(request);
				const response = deps.detectChanges(normalized);
				return serializeDetectChangesResponse(response);
			} catch (error) {
				throw normalizeRustBoundaryError(error);
			}
		},
	};
}

export function registerRustCallbackAdapterFunctions(
	args: RegisterRustCallbackAdapterArgs
): void {
	const adapter = createRustCallbackAdapter(args.deps);

	args.register({
		name: LIX_RUST_CALLBACK_EXECUTE,
		handler: (_ctx, request) =>
			adapter.executeWire(coerceExecuteWireRequest(request)),
	});

	args.register({
		name: LIX_RUST_CALLBACK_DETECT_CHANGES,
		handler: (_ctx, request) =>
			adapter.detectChangesWire(coerceDetectChangesWireRequest(request)),
	});
}

export function serializeExecuteRequest(
	request: RustExecuteRequest
): RustExecuteWireRequest {
	return {
		requestId: request.requestId,
		sql: request.sql,
		paramsJson: JSON.stringify(request.params),
		statementKind: request.statementKind,
	};
}

export function deserializeExecuteRequest(
	request: RustExecuteWireRequest
): RustExecuteRequest {
	const parsedParams = parseJsonArray(request.paramsJson, "execute.paramsJson");
	return {
		requestId: request.requestId,
		sql: request.sql,
		params: parsedParams.map((value) => deserializeExecuteParamValue(value)),
		statementKind: routeRustExecuteStatementKind(request.sql),
	};
}

export function routeRustExecuteStatementKind(sql: string): RustRoutedStatementKind {
	if (configuredRustStatementKindRouter) {
		try {
			return configuredRustStatementKindRouter(sql);
		} catch {
			// Fall through to SDK parser to preserve behavior when native router is unavailable.
		}
	}

	const statements = parse(sql);
	if (statements.length === 0) {
		return "passthrough";
	}

	let sawRead = false;
	let sawWrite = false;

	for (const statement of statements) {
		for (const segment of statement.segments) {
			if (segment.node_kind === "raw_fragment") {
				return "passthrough";
			}

			if (
				segment.node_kind === "select_statement" ||
				segment.node_kind === "compound_select"
			) {
				sawRead = true;
				continue;
			}

			if (
				segment.node_kind === "insert_statement" ||
				segment.node_kind === "update_statement" ||
				segment.node_kind === "delete_statement"
			) {
				sawWrite = true;
				continue;
			}

			if (segment.node_kind !== "statement") {
				return "passthrough";
			}
		}
	}

	if (sawWrite) {
		return "write_rewrite";
	}

	if (sawRead) {
		return "read_rewrite";
	}

	return "read_rewrite";
}

export function toExecutePreprocessMode(
	statementKind: RustExecuteRequest["statementKind"]
): "full" | "none" {
	if (statementKind !== "passthrough") {
		return "full";
	}
	return "none";
}

export function serializeExecuteResponse(
	response: RustExecuteResponse
): RustExecuteWireResponse {
	return {
		rowsJson: JSON.stringify(response.rows),
		rowsAffected: response.rowsAffected,
		lastInsertRowId: response.lastInsertRowId,
	};
}

export function deserializeExecuteResponse(
	response: RustExecuteWireResponse
): RustExecuteResponse {
	const rows = parseJsonArray(response.rowsJson, "execute.rowsJson");
	return {
		rows: rows as RustExecuteResponse["rows"],
		rowsAffected: response.rowsAffected,
		lastInsertRowId: response.lastInsertRowId,
	};
}

export function serializeDetectChangesRequest(
	request: RustDetectChangesRequest
): RustDetectChangesWireRequest {
	return {
		requestId: request.requestId,
		pluginKey: request.pluginKey,
		beforeJson: JSON.stringify(Array.from(request.before)),
		afterJson: JSON.stringify(Array.from(request.after)),
	};
}

export function deserializeDetectChangesRequest(
	request: RustDetectChangesWireRequest
): RustDetectChangesRequest {
	return {
		requestId: request.requestId,
		pluginKey: request.pluginKey,
		before: parseByteArray(request.beforeJson, "detectChanges.beforeJson"),
		after: parseByteArray(request.afterJson, "detectChanges.afterJson"),
	};
}

export function serializeDetectChangesResponse(
	response: RustDetectChangesResponse
): RustDetectChangesWireResponse {
	return {
		changesJson: JSON.stringify(response.changes),
	};
}

export function deserializeDetectChangesResponse(
	response: RustDetectChangesWireResponse
): RustDetectChangesResponse {
	const changes = parseJsonArray(response.changesJson, "detectChanges.changesJson");
	return {
		changes: changes as RustDetectChangesResponse["changes"],
	};
}

function parseJsonArray(input: string, field: string): unknown[] {
	try {
		const value = JSON.parse(input);
		if (Array.isArray(value)) {
			return value;
		}
		throw new RustBoundaryError({
			code: "LIX_RUST_PROTOCOL_MISMATCH",
			message: `Expected JSON array for ${field}`,
			details: { field },
		});
	} catch (error) {
		if (error instanceof RustBoundaryError) {
			throw error;
		}
		throw new RustBoundaryError({
			code: "LIX_RUST_PROTOCOL_MISMATCH",
			message: `Failed to parse ${field}`,
			details: { field },
			cause: error,
		});
	}
}

function coerceExecuteWireRequest(input: unknown): RustExecuteWireRequest {
	const record = asRecord(input, "execute request");
	return {
		requestId: asString(record.requestId, "requestId"),
		sql: asString(record.sql, "sql"),
		paramsJson: asString(record.paramsJson, "paramsJson"),
		statementKind: asStatementKind(record.statementKind),
	};
}

function coerceDetectChangesWireRequest(
	input: unknown
): RustDetectChangesWireRequest {
	const record = asRecord(input, "detectChanges request");
	return {
		requestId: asString(record.requestId, "requestId"),
		pluginKey: asString(record.pluginKey, "pluginKey"),
		beforeJson: asString(record.beforeJson, "beforeJson"),
		afterJson: asString(record.afterJson, "afterJson"),
	};
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
	if (typeof value === "object" && value !== null) {
		return value as Record<string, unknown>;
	}
	throw new RustBoundaryError({
		code: "LIX_RUST_PROTOCOL_MISMATCH",
		message: `Expected object for ${field}`,
		details: { field },
	});
}

function asString(value: unknown, field: string): string {
	if (typeof value === "string") {
		return value;
	}
	throw new RustBoundaryError({
		code: "LIX_RUST_PROTOCOL_MISMATCH",
		message: `Expected string for ${field}`,
		details: { field },
	});
}

function asStatementKind(value: unknown): RustExecuteRequest["statementKind"] {
	if (
		value === "read_rewrite" ||
		value === "write_rewrite" ||
		value === "validation" ||
		value === "passthrough"
	) {
		return value;
	}
	throw new RustBoundaryError({
		code: "LIX_RUST_PROTOCOL_MISMATCH",
		message: "Expected valid statementKind",
		details: { value },
	});
}

function parseByteArray(input: string, field: string): Uint8Array {
	const parsed = parseJsonArray(input, field);
	const values = parsed.map((value, index) => {
		if (
			typeof value !== "number" ||
			!Number.isInteger(value) ||
			value < 0 ||
			value > 255
		) {
			throw new RustBoundaryError({
				code: "LIX_RUST_PROTOCOL_MISMATCH",
				message: `Expected byte value at ${field}[${index}]`,
				details: { field, index, value },
			});
		}
		return value;
	});
	return new Uint8Array(values);
}

function deserializeExecuteParamValue(value: unknown): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	if (value.length === 0) {
		return value;
	}

	for (const entry of value) {
		if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 255) {
			return value;
		}
	}

	return new Uint8Array(value as number[]);
}
