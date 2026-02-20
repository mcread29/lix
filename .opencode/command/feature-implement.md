---
description: Implement a planned feature with automatic MCP checkpointing
argument-hint: <approved plan or feature request>
allowed-tools: Bash, Read, Write, Edit, MultiEdit, Glob, Grep, Task, project-brain_brain_search, project-brain_brain_graph_get, project-brain_brain_entity_get, project-brain_brain_event_apply, project-brain_brain_validate, project-brain_brain_views_generate
---

You are running the implementation phase for an approved feature plan.

Input:
`$ARGUMENTS`

Non-negotiable behavior:
- The agent owns brain updates automatically in the background.
- Do not ask the user to run brain commands.
- Do not manually create or edit `brain/*.json` files.
- Use `project-brain_brain_event_apply` for all graph mutations.

Implementation workflow:
1. Confirm plan context and constraints via MCP search/graph.
2. Implement the feature in code using repository conventions.
3. Log mid-implementation checkpoints/pivots
   - For material decisions or scope changes, write `decision` or `implementation` events.
   - Use dry-run then apply via `project-brain_brain_event_apply`.
4. Verify implementation
   - Run required tests/build/type checks.
5. Log completion
   - Only if verification succeeds, write a final `implementation` event indicating completed feature.
6. Validate and refresh brain artifacts
   - Run `project-brain_brain_validate`.
   - Run `project-brain_brain_views_generate`.

Output requirements:
- Report code changes, checkpoint events logged, verification results, and final completion event id.
- If verification fails, do not log completion; report failures and next actions.
