# notion-doc-publisher-v3 Agent Instructions

This repository must be developed GitHub-first through branches and pull requests.

Before doing any work, every Codex, Claude Code, or other AI coding agent must read:

1. `/docs/OWNER_INTENT.md`
2. `/docs/PROJECT_CONTEXT.md`
3. `/docs/PRODUCT_CONSTITUTION.md`
4. `/docs/SYSTEM_ARCHITECTURE.md`
5. `/docs/ENGINEERING_GOVERNANCE.md`

Do not edit files before reading these documents.

## Non-negotiable project rules

- This repository is the active Notion document publisher for enxpower brands.
- Do not modify publishing behavior without explicit owner approval.
- Do not change Notion API behavior without explicit owner approval.
- Do not change the GitHub Pages publishing workflow (`.github/workflows/preview-publish.yml`) without explicit owner approval.
- Do not expose secrets. Do not add API keys to this repository.
- Do not move existing source files under `src/`.
- Do not rename existing CLI commands, npm scripts, or output paths under `dist/docs/{DOC_ID}/`.
- Documentation and governance changes only in `docs/` and `governance/` branches.

## Required workflow

1. Read all five governing/context documents.
2. Explain how the requested task complies with them.
3. Inspect open PRs and current branch context.
4. Create or use a feature branch.
5. Make small scoped changes.
6. Add or update tests where relevant.
7. Run: `npm run check && npm test && npm run lint:security`
8. Open or update a draft PR.
9. Do not merge.
10. Do not deploy.
11. Do not modify production secrets.

## New-session recovery

If a new AI coding-agent session starts with limited chat memory, it must recover project context from the repository itself:

1. Read this `AGENTS.md` file.
2. Read all five documents listed above.
3. Inspect open PRs.
4. Treat GitHub as the source of truth, not prior chat memory.

## Stop conditions

Stop and report conflict if a task would:

- Violate Product Constitution.
- Break System Architecture.
- Bypass Engineering Governance.
- Touch production deployment, production data, or secrets without explicit owner approval.
- Modify Notion API integration behavior without explicit owner approval.
- Modify the GitHub Actions publishing workflow without explicit owner approval.
- Move, rename, or delete existing source files.
- Write to production Notion databases or production publishing repositories.

Default final statement for agent work:

`No merge or production deployment was performed.`
