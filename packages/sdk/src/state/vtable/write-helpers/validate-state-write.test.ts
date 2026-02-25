import { expect, test } from "vitest";
import { openLix } from "../../../lix/open-lix.js";
import { LixStoredSchemaSchema } from "../../../stored-schema/schema-definition.js";
import {
	validateStateMutation,
	type ValidateStateMutationArgs,
} from "../validate-state-mutation.js";
import { validateStateWriteMutation } from "./validate-state-write.js";

test("shared validation entrypoint preserves validator error semantics", async () => {
	const lix = await openLix({});

	const baseArgs: ValidateStateMutationArgs = {
		engine: lix.engine!,
		schema: LixStoredSchemaSchema,
		schemaKey: LixStoredSchemaSchema["x-lix-key"],
		snapshot_content: { id: "schema-1", value: LixStoredSchemaSchema },
		operation: "insert",
		entity_id: "schema-1",
		file_id: "lix",
		version_id: "missing-version",
	};

	let legacyError: unknown;
	let sharedError: unknown;

	try {
		validateStateMutation(baseArgs);
	} catch (error) {
		legacyError = error;
	}

	try {
		validateStateWriteMutation(baseArgs);
	} catch (error) {
		sharedError = error;
	}

	expect(legacyError).toBeInstanceOf(Error);
	expect(sharedError).toBeInstanceOf(Error);
	expect((sharedError as Error).message).toBe((legacyError as Error).message);

	await lix.close();
});
