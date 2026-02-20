---
description: Fix bug and update brain
argument-hint: <bug description>
allowed-tools: Bash, Read, Write, Edit, MultiEdit, Glob, Grep, Task, project-brain_brain_search, project-brain_brain_graph_get, project-brain_brain_entity_get, project-brain_brain_event_apply, project-brain_brain_validate, project-brain_brain_views_generate
---

You are handling a bug fix end-to-end with two explicit phases.

Bug Description:
`$ARGUMENTS`

Non-negotiable behavior:

- The agent owns brain updates automatically in the background.
- Do not ask the user to run brain commands.
- Do not manually create or edit `brain/*.json` files.
- Use MCP tools directly for all brain mutations (`project-brain_brain_event_apply`).

Execution workflow:

1. Explore implemented context via MCP
   - Use `project-brain_brain_search` across entities/events/state.
   - Use `project-brain_brain_graph_get` around likely roots.
2. Identify ambiguity and hard decisions
   - Ask only targeted questions when truly blocking.
3. Log decisions immediately
   - Build event payload(s) in-memory.
   - Run `project-brain_brain_event_apply` with `dry_run:true`, then `dry_run:false` if clean.
4. Produce fix implementation plan
   - List concrete steps, touched areas, and expected risks.
5. Run readiness verification before implementation
   - Run baseline checks relevant to this repo (for example: build, tests, typecheck, lint, or existing feature checks).
   - If checks fail, report blockers and stop before implementation.
6. Validate and refresh
   - Run `project-brain_brain_validate`.
   - Run `project-brain_brain_views_generate`.
7. Confirm plan context and constraints via MCP search/graph.
8. Implement the feature in code using repository conventions.
9. Log mid-implementation checkpoints/pivots
   - For material decisions or scope changes, write `decision` or `implementation` events.
   - Use dry-run then apply via `project-brain_brain_event_apply`.
10. Verify implementation
    - Run required tests/build/type checks.
11. Log completion
    - Only if verification succeeds, write a final `implementation` event indicating completed feature.
12. Validate and refresh brain artifacts
    - Run `project-brain_brain_validate`.
    - Run `project-brain_brain_views_generate`.
13. Finish by validating brain and regenerating views.

Output requirements:

- Keep user-facing updates concise.
- Report plan readiness checks, implementation changes, logged events, and verification results.
- Include any follow-up risks or open questions.
