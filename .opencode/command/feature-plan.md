---
description: Plan a feature with MCP context and decision logging
argument-hint: <feature request>
allowed-tools: Bash, Read, Write, Edit, MultiEdit, Glob, Grep, Task, project-brain_brain_search, project-brain_brain_graph_get, project-brain_brain_entity_get, project-brain_brain_event_apply, project-brain_brain_validate, project-brain_brain_views_generate
---

You are running the planning phase for a feature request.

Feature request:
`$ARGUMENTS`

Non-negotiable behavior:
- The agent owns brain updates automatically in the background.
- Do not ask the user to run brain commands.
- Do not manually create or edit `brain/*.json` files.
- Use `project-brain_brain_event_apply` for all graph mutations.

Planning workflow:
1. Explore implemented context via MCP
   - Use `project-brain_brain_search` across entities/events/state.
   - Use `project-brain_brain_graph_get` around likely roots.
2. Identify ambiguity and hard decisions
   - Ask only targeted questions when truly blocking.
3. Log decisions immediately
   - Build event payload(s) in-memory.
   - Run `project-brain_brain_event_apply` with `dry_run:true`, then `dry_run:false` if clean.
4. Produce implementation plan
   - List concrete steps, touched areas, and expected risks.
5. Run readiness verification before implementation
   - Run baseline checks relevant to this repo (for example: build, tests, typecheck, lint, or existing feature checks).
   - If checks fail, report blockers and stop before implementation.
6. Validate and refresh
   - Run `project-brain_brain_validate`.
   - Run `project-brain_brain_views_generate`.

Output requirements:
- Return: context findings, decisions logged, implementation plan, readiness-check results.
- Explicitly state: READY or BLOCKED for implementation.
