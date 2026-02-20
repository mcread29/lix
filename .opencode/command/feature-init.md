---
description: Initialize project brain from existing repository implementation
argument-hint: [scope or focus]
allowed-tools: Bash, Read, Write, Edit, MultiEdit, Glob, Grep, Task, project-brain_brain_search, project-brain_brain_graph_get, project-brain_brain_entity_get, project-brain_brain_event_apply, project-brain_brain_validate, project-brain_brain_views_generate
---

You are initializing a project's brain from what already exists in this repository.

Optional scope:
`$ARGUMENTS`

Non-negotiable behavior:
- The agent owns brain updates automatically in the background.
- Do not ask the user to run brain commands.
- Do not manually create or edit `brain/*.json` files.
- Use `project-brain_brain_event_apply` for all graph mutations.

Initialization workflow:
1. Discover repository structure and implemented features
   - Inspect directories, packages, apps, services, modules, and docs.
   - Infer existing capabilities from code, routes, commands, tests, and configs.
2. Build initial brain model in-memory
   - Propose core entities (components/packages/services/modules).
   - Propose relations (depends_on, uses, exposes, reads, writes, builds, runs).
   - Propose baseline states for active/proposed status where inferable.
3. Persist initialization via MCP events
   - Write one or more initialization `implementation` events via `project-brain_brain_event_apply` dry-run then apply.
   - Keep payloads explicit and deterministic.
4. Verify generated model
   - Run `project-brain_brain_validate`.
   - Run `project-brain_brain_views_generate`.
5. Report coverage and gaps
   - Summarize what features/capabilities were captured.
   - List uncertain areas that need human confirmation.

Output requirements:
- Return captured features, key entities/relations created, event ids, and validation results.
- Make uncertainty explicit instead of inventing unsupported details.
