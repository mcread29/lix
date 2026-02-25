import type { LixEngine } from "../../../engine/boot.js";
import { composeDirectoryPath } from "../../../filesystem/directory/ensure-directories.js";
import { updateFilePathCache } from "../../../filesystem/file/cache/update-file-path-cache.js";

type NormalizedDescriptorSnapshot = {
	directoryId: string | null;
	name: string;
	extension: string | null;
};

export function deleteFilePathCacheEntry(args: {
	engine: Pick<LixEngine, "sqlite">;
	fileId: string;
	versionId: string;
}): void {
	args.engine.sqlite.exec({
		sql: `
			DELETE FROM lix_internal_file_path_cache
			WHERE file_id = ?
			  AND version_id = ?
		`,
		bind: [args.fileId, args.versionId],
		returnValue: "resultRows",
	});
}

export function applyFileDescriptorCacheSideEffects(args: {
	engine: Pick<LixEngine, "sqlite" | "executeSync">;
	fileId: string;
	versionId: string;
	snapshot: unknown;
}): void {
	const descriptorSnapshot = normalizeFileDescriptorSnapshot(args.snapshot);
	if (descriptorSnapshot) {
		refreshFilePathCacheEntry({
			engine: args.engine,
			fileId: args.fileId,
			versionId: args.versionId,
			directoryId: descriptorSnapshot.directoryId,
			name: descriptorSnapshot.name,
			extension: descriptorSnapshot.extension,
		});
		return;
	}

	deleteFilePathCacheEntry({
		engine: args.engine,
		fileId: args.fileId,
		versionId: args.versionId,
	});
}

function refreshFilePathCacheEntry(args: {
	engine: Pick<LixEngine, "sqlite" | "executeSync">;
	fileId: string;
	versionId: string;
	directoryId: string | null;
	name: string;
	extension: string | null;
}): void {
	const resolvedPath = resolveFileDescriptorPath({
		engine: args.engine,
		versionId: args.versionId,
		directoryId: args.directoryId,
		name: args.name,
		extension: args.extension,
	});

	if (!resolvedPath) {
		deleteFilePathCacheEntry({
			engine: args.engine,
			fileId: args.fileId,
			versionId: args.versionId,
		});
		return;
	}

	updateFilePathCache({
		engine: args.engine,
		fileId: args.fileId,
		versionId: args.versionId,
		directoryId: args.directoryId,
		name: args.name,
		extension: args.extension,
		path: resolvedPath,
	});
}

function normalizeFileDescriptorSnapshot(
	snapshot: unknown
): NormalizedDescriptorSnapshot | null {
	if (!snapshot || typeof snapshot !== "object") {
		return null;
	}
	const directoryIdRaw = (snapshot as any).directory_id;
	const nameRaw = (snapshot as any).name;
	const extensionRaw = (snapshot as any).extension;
	if (typeof nameRaw !== "string" || nameRaw.length === 0) {
		return null;
	}
	const directoryId =
		typeof directoryIdRaw === "string" && directoryIdRaw.length > 0
			? directoryIdRaw
			: null;
	const extension =
		typeof extensionRaw === "string" && extensionRaw.length > 0
			? extensionRaw
			: null;
	return {
		directoryId,
		name: nameRaw,
		extension,
	};
}

function resolveFileDescriptorPath(args: {
	engine: Pick<LixEngine, "executeSync">;
	versionId: string;
	directoryId: string | null;
	name: string;
	extension: string | null;
}): string | null {
	const directoryPath = args.directoryId
		? (composeDirectoryPath({
				engine: args.engine,
				versionId: args.versionId,
				directoryId: args.directoryId,
			}) ?? undefined)
		: "/";

	if (!directoryPath) {
		return null;
	}

	const normalizedExtension =
		args.extension && args.extension.length > 0 ? args.extension : null;
	const suffix = normalizedExtension
		? `${args.name}.${normalizedExtension}`
		: args.name;
	const basePath = directoryPath === "/" ? "/" : directoryPath;
	return `${basePath}${suffix}`;
}
