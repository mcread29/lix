import {
	validateStateMutation,
	type ValidateStateMutationArgs,
} from "../validate-state-mutation.js";

export type ValidateStateWriteMutationArgs = ValidateStateMutationArgs;

/**
 * Shared validation entrypoint for state write flows.
 *
 * Kept as a thin wrapper so runtime and preprocessor paths call the exact same
 * validator implementation and error semantics.
 */
export function validateStateWriteMutation(
	args: ValidateStateWriteMutationArgs
): void {
	validateStateMutation(args);
}
