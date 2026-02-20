import type { LixEngine } from "./boot.js";

export function createExecuteSync(args: {
	engine: Pick<
		LixEngine,
		"sqlite" | "hooks" | "runtimeCacheRef" | "preprocessQuery"
	>;
}): LixEngine["executeSync"] {
	const executeSyncFn: LixEngine["executeSync"] = (args2) => {
		const mode = args2.preprocessMode ?? "full";
		const preprocessed =
			mode === "none"
				? {
						sql: args2.sql,
						parameters: (args2.parameters as ReadonlyArray<unknown>) ?? [],
					}
				: args.engine.preprocessQuery({
						sql: args2.sql,
						parameters: (args2.parameters as ReadonlyArray<unknown>) ?? [],
						mode,
					});

		const columnNames: string[] = [];
		try {
			const beforeMetadataRows = args.engine.sqlite.exec({
				sql: "select total_changes() as total_changes",
				returnValue: "resultRows",
				rowMode: "object",
			}) as Array<Record<string, unknown>>;
			const beforeTotalChanges = Number(
				beforeMetadataRows[0]?.total_changes ?? 0
			);

			const rows = args.engine.sqlite.exec({
				sql: preprocessed.sql,
				bind: preprocessed.parameters as any[],
				returnValue: "resultRows",
				rowMode: "object",
				columnNames,
			});

			const metadataRows = args.engine.sqlite.exec({
				sql: "select total_changes() as total_changes, last_insert_rowid() as last_insert_row_id",
				returnValue: "resultRows",
				rowMode: "object",
			}) as Array<Record<string, unknown>>;
			const metadata = metadataRows[0] ?? {};
			const afterTotalChanges = Number(metadata.total_changes ?? 0);
			const rowsAffected = Math.max(0, afterTotalChanges - beforeTotalChanges);
			const lastInsertRowIdRaw = Number(metadata.last_insert_row_id ?? 0);

			return {
				rows,
				rowsAffected,
				lastInsertRowId:
					rowsAffected > 0 && Number.isFinite(lastInsertRowIdRaw)
						? lastInsertRowIdRaw
						: undefined,
			};
		} catch (error) {
			const enriched =
				error instanceof Error ? error : new Error(String(error));
			const debugPayload = {
				rewrittenSql: preprocessed.sql,
				originalSql: args2.sql,
				parameters: preprocessed.parameters,
			};
			Object.assign(enriched, debugPayload);
			throw enriched;
		}
	};

	return executeSyncFn;
}
