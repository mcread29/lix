---
description: Run plan then implement with MCP-backed brain updates
argument-hint: <feature request>
allowed-tools: Bash, Read, Write, Edit, MultiEdit, Glob, Grep, Task, project-brain_brain_search, project-brain_brain_graph_get, project-brain_brain_entity_get, project-brain_brain_event_apply, project-brain_brain_validate, project-brain_brain_views_generate
---

You are handling a feature request end-to-end with two explicit phases.

Feature request:
`$ARGUMENTS`

Non-negotiable behavior:
- The agent owns brain updates automatically in the background.
- Do not ask the user to run brain commands.
- Do not manually create or edit `brain/*.json` files.
- Use MCP tools directly for all brain mutations (`project-brain_brain_event_apply`).

Execution workflow:
1. Run planning phase exactly as `/feature-plan`:
   - Explore context with MCP tools.
   - Resolve blocking decisions.
   - Log decision events.
   - Produce an implementation plan.
   - Run pre-implementation verification checks and report readiness.
2. Only if planning checks pass, run implementation phase exactly as `/feature-implement`:
   - Implement approved plan.
   - Log mid-implementation pivots/checkpoints.
   - Run build/tests.
   - Log completion event only after verification succeeds.
3. Finish by validating brain and regenerating views.

Output requirements:
- Keep user-facing updates concise.
- Report plan readiness checks, implementation changes, logged events, and verification results.
- Include any follow-up risks or open questions.
