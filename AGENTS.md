# notion-doc-publisher-v3 Agent Instructions

This repository must normally be developed GitHub-first through branches and pull requests.

Before doing any work, every Codex, Claude Code, or other AI coding agent must read:

1. `/docs/OWNER_INTENT.md`
2. `/docs/PROJECT_CONTEXT.md`
3. `/docs/PRODUCT_CONSTITUTION.md`
4. `/docs/SYSTEM_ARCHITECTURE.md`
5. `/docs/ENGINEERING_GOVERNANCE.md`
6. `/docs/PHASE2_BASELINE.md`
7. `/docs/PHASE2_FINAL_PRODUCTION_SEAL.md`

The first five documents remain the governing authority. `PHASE2_FINAL_PRODUCTION_SEAL.md` is the newest operational authority and supersedes conflicting trigger, preview, identity-initialization, and scheduler descriptions in `PHASE2_BASELINE.md`.

Do not edit files before reading these documents.

## Non-negotiable project rules

- This repository is the active Notion document publisher for enxpower brands.
- Do not modify publishing behavior without explicit owner approval.
- Do not change Notion API behavior without explicit owner approval.
- Do not change publishing workflows without explicit owner approval.
- Do not expose secrets. Do not add API keys to this repository.
- Do not move existing source files under `src/`.
- Do not rename existing CLI commands, npm scripts, or governed output paths.
- Never introduce a second automatic production publisher or indirect production dispatcher.
- Documentation and governance changes normally use dedicated branches.

## Required workflow

1. Read all seven governing/context/baseline documents.
2. Explain how the requested task complies with them.
3. Inspect open PRs and current branch context.
4. Create or use a feature branch.
5. Make small scoped changes.
6. Add or update tests where relevant.
7. Run: `npm run check && npm test && npm run lint:security`.
8. Open or update a draft PR.
9. Do not merge or deploy without explicit owner authorization.
10. Do not modify production secrets.

## Owner-authorized break-glass repair

A direct production repair is allowed only when the owner explicitly requests immediate action and a concrete active production defect or security risk exists.

During break-glass repair:

1. Make the smallest safe correction.
2. Never expose secrets, rotate stable identities, redesign output paths, or create a second publisher.
3. Record the exact production change and commit.
4. Immediately create a follow-up branch and PR that restores tests, documentation, CI evidence, and governance alignment.
5. Do not declare the system sealed until the final production acceptance gate in `PHASE2_FINAL_PRODUCTION_SEAL.md` is satisfied.

Break-glass repair is an exception for active incidents, not an alternative development workflow.

## New-session recovery

If a new AI coding-agent session starts with limited chat memory, it must recover project context from the repository itself:

1. Read this `AGENTS.md` file.
2. Read all seven documents listed above.
3. Inspect open PRs and recent production workflow changes.
4. Treat GitHub as the source of truth, not prior chat memory.

## Stop conditions

Stop and report conflict if a task would:

- Violate Product Constitution.
- Break System Architecture.
- Bypass Engineering Governance without explicit owner-authorized break-glass conditions.
- Touch production deployment, production data, or secrets without explicit owner approval.
- Modify Notion API integration behavior without explicit owner approval.
- Modify publishing workflows without explicit owner approval.
- Move, rename, or delete existing source files without an approved migration.
- Write destructively to production Notion databases or publishing repositories.

Default final statement for ordinary agent work:

`No merge or production deployment was performed.`
