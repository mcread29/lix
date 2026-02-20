export const RUST_REWRITE_CALLBACK_CONTRACT_VERSION = "0.1.0" as const;

export const RUST_REWRITE_ERROR_CODES = [
	"LIX_RUST_SQLITE_EXECUTION",
	"LIX_RUST_DETECT_CHANGES",
	"LIX_RUST_REWRITE_VALIDATION",
	"LIX_RUST_UNSUPPORTED_SQLITE_FEATURE",
	"LIX_RUST_PROTOCOL_MISMATCH",
	"LIX_RUST_TIMEOUT",
	"LIX_RUST_UNKNOWN",
] as const;

export type RustRewriteErrorCode = (typeof RUST_REWRITE_ERROR_CODES)[number];

export type RustRewriteStatementKind =
	| "read_rewrite"
	| "write_rewrite"
	| "validation"
	| "passthrough";

export type RustExecuteRequest = {
	requestId: string;
	sql: string;
	params: readonly unknown[];
	statementKind: RustRewriteStatementKind;
};

export type RustExecuteResponse = {
	rows: readonly Record<string, unknown>[];
	rowsAffected: number;
	lastInsertRowId?: number;
};

export type RustDetectChangesRequest = {
	requestId: string;
	pluginKey: string;
	before: Uint8Array;
	after: Uint8Array;
};

export type RustDetectChangesResponse = {
	changes: readonly Record<string, unknown>[];
};

export type RustHostCallbacks = {
	execute: (request: RustExecuteRequest) => Promise<RustExecuteResponse>;
	detectChanges: (
		request: RustDetectChangesRequest
	) => Promise<RustDetectChangesResponse>;
};

export const RUST_REWRITE_ERROR_VERSIONING_POLICY = {
	addCode: "minor",
	removeCode: "major",
	renameCode: "major",
	messageTextChange: "patch",
	metadataShapeExpansion: "minor",
} as const;

export type RustBoundaryErrorShape = {
	code: RustRewriteErrorCode;
	message: string;
	details?: Record<string, unknown>;
	cause?: unknown;
};

const RUST_REWRITE_CODE_SET = new Set<string>(RUST_REWRITE_ERROR_CODES);

export class RustBoundaryError extends Error {
	readonly code: RustRewriteErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(args: RustBoundaryErrorShape) {
		super(args.message);
		this.name = "RustBoundaryError";
		this.code = args.code;
		this.details = args.details;
		this.cause = args.cause;
	}
}

export function normalizeRustBoundaryError(input: unknown): RustBoundaryError {
	if (input instanceof RustBoundaryError) {
		return input;
	}

	if (isRecord(input)) {
		const maybeCode = input.code;
		const code =
			typeof maybeCode === "string" && RUST_REWRITE_CODE_SET.has(maybeCode)
				? (maybeCode as RustRewriteErrorCode)
				: inferRustErrorCode(input);
		const message =
			typeof input.message === "string" && input.message.length > 0
				? input.message
				: "Rust rewrite boundary error";
		return new RustBoundaryError({
			code,
			message,
			details: isRecord(input.details) ? input.details : undefined,
			cause: input,
		});
	}

	if (input instanceof Error) {
		return new RustBoundaryError({
			code: inferRustErrorCode({ message: input.message, name: input.name }),
			message: input.message,
			cause: input,
		});
	}

	return new RustBoundaryError({
		code: "LIX_RUST_UNKNOWN",
		message: "Rust rewrite boundary error",
		cause: input,
	});
}

function inferRustErrorCode(input: Record<string, unknown>): RustRewriteErrorCode {
	const message = typeof input.message === "string" ? input.message : "";
	const lowered = message.toLowerCase();

	if (lowered.includes("detect") && lowered.includes("change")) {
		return "LIX_RUST_DETECT_CHANGES";
	}
	if (lowered.includes("sqlite") || lowered.includes("no such table")) {
		return "LIX_RUST_SQLITE_EXECUTION";
	}
	if (lowered.includes("unsupported") || lowered.includes("dialect")) {
		return "LIX_RUST_UNSUPPORTED_SQLITE_FEATURE";
	}
	if (lowered.includes("protocol") || lowered.includes("callback")) {
		return "LIX_RUST_PROTOCOL_MISMATCH";
	}
	if (lowered.includes("timeout")) {
		return "LIX_RUST_TIMEOUT";
	}
	if (lowered.includes("validation") || lowered.includes("rewrite")) {
		return "LIX_RUST_REWRITE_VALIDATION";
	}

	return "LIX_RUST_UNKNOWN";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
