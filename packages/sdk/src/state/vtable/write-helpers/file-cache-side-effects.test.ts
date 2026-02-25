import { expect, test } from "vitest";
import { openLix } from "../../../lix/open-lix.js";
import {
	applyFileDescriptorCacheSideEffects,
	deleteFilePathCacheEntry,
} from "./file-cache-side-effects.js";

test("applies file cache insert/update and delete side effects", async () => {
	const lix = await openLix({});

	applyFileDescriptorCacheSideEffects({
		engine: lix.engine!,
		fileId: "file-a",
		versionId: "global",
		snapshot: {
			directory_id: null,
			name: "readme",
			extension: "md",
		},
	});

	const inserted = lix.engine!.sqlite.exec({
		sql: "SELECT path, name, extension FROM lix_internal_file_path_cache WHERE file_id = ? AND version_id = ?",
		bind: ["file-a", "global"],
		returnValue: "resultRows",
		rowMode: "object",
		columnNames: [],
	}) as Array<{ path: string; name: string; extension: string | null }>;

	expect(inserted).toEqual([
		{ path: "/readme.md", name: "readme", extension: "md" },
	]);

	applyFileDescriptorCacheSideEffects({
		engine: lix.engine!,
		fileId: "file-a",
		versionId: "global",
		snapshot: null,
	});

	const afterNullSnapshot = lix.engine!.sqlite.exec({
		sql: "SELECT file_id FROM lix_internal_file_path_cache WHERE file_id = ? AND version_id = ?",
		bind: ["file-a", "global"],
		returnValue: "resultRows",
		rowMode: "object",
		columnNames: [],
	});

	expect(afterNullSnapshot).toEqual([]);

	applyFileDescriptorCacheSideEffects({
		engine: lix.engine!,
		fileId: "file-b",
		versionId: "global",
		snapshot: {
			directory_id: null,
			name: "example",
			extension: null,
		},
	});

	deleteFilePathCacheEntry({
		engine: lix.engine!,
		fileId: "file-b",
		versionId: "global",
	});

	const afterExplicitDelete = lix.engine!.sqlite.exec({
		sql: "SELECT file_id FROM lix_internal_file_path_cache WHERE file_id = ? AND version_id = ?",
		bind: ["file-b", "global"],
		returnValue: "resultRows",
		rowMode: "object",
		columnNames: [],
	});

	expect(afterExplicitDelete).toEqual([]);

	await lix.close();
});
