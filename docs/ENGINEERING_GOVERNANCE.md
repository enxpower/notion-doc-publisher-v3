# Engineering Governance

Project: notion-doc-publisher-v3

## Required Reading

Before implementation, every AI coding agent must read:

1. `AGENTS.md`
2. `docs/OWNER_INTENT.md`
3. `docs/PROJECT_CONTEXT.md`
4. `docs/PRODUCT_CONSTITUTION.md`
5. `docs/SYSTEM_ARCHITECTURE.md`
6. `docs/ENGINEERING_GOVERNANCE.md`
7. `docs/AI_ENGINEERING_OPERATING_PROCEDURE.md`

For HTML/static publishing changes, also read:

8. `docs/HTML_PUBLISHING_GOVERNANCE.md`

## Branching

Branch naming:

- `main` — protected stable branch; no direct commits
- `feature/*` — feature work
- `fix/*` — bug fixes
- `docs/*` — documentation
- `governance/*` — governance adoption and updates
- `chore/*` — maintenance

## Workflow

1. Read governing documents.
2. Inspect current repository state.
3. Write a short plan.
4. Make focused changes.
5. Add or update tests.
6. Run checks:
   ```sh
   npm run check
   npm test
   npm run lint:security
   ```
7. Open a draft PR.
8. Wait for review.

## Agent Boundaries

AI coding agents must not:

- Merge without explicit owner approval.
- Deploy or publish without explicit owner approval.
- Modify `.github/workflows/preview-publish.yml` without explicit owner approval.
- Change Notion API integration (client, writeback, assign-id) without explicit owner approval.
- Change output paths under `dist/docs/{DOC_ID}/` without explicit approval.
- Remove or weaken the safety guard in the workflow that blocks production repository deployment.
- Add secrets or API keys to source files.
- Move, rename, or delete existing source files under `src/`.
- Change existing npm script names in `package.json`.

## PR Requirements

Every PR must include:

- Purpose
- Scope
- Files changed
- Governance alignment
- Architecture impact
- Checks run and results (`npm run check`, `npm test`, `npm run lint:security`)
- Known limitations
- Rollback notes

## Check Commands

```sh
npm run check          # TypeScript type check (no Notion access needed)
npm test               # Regression tests (no Notion access needed)
npm run lint:security  # Security lint (no Notion access needed)
npm run build          # Full build (requires NOTION_TOKEN)
```

Do not run `npm run build`, `npm run assign-id`, or `npm run publish:preview` in CI without a valid NOTION_TOKEN.

## Completion Report

Every AI agent must report:

- Files changed
- What was implemented
- Checks run and results
- Remaining risks
- Whether a draft PR was opened
- Confirmation no merge or deployment was performed
