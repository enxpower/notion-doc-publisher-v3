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

## Supply-Chain Change Policy (Phase 3 Prompt 5 addition)

External GitHub Actions referenced under `.github/workflows/` must be pinned to a full
40-character commit SHA with an inline human-readable version comment, resolved from the
action's own official upstream repository — never an unverified fork, a branch, a short SHA,
or an arbitrary commit. The custom Typst binary download in `incremental-content-publish.yml`
must remain SHA-256 verified before extraction, with the expected hash reproducibly obtained
from the official release asset. Any change to a pinned action SHA or the Typst checksum must:

- go through a normal reviewed PR, not a direct commit;
- update the corresponding approved-registry values in
  `src/tests/supply-chain-hardening.test.ts` in the same change;
- pass `npm run check`, `npm test`, and `npm run lint:security` before merge.

Full detail: `docs/SYSTEM_ARCHITECTURE.md` ("Phase 3 Prompt 5: Supply-Chain and
Secret-Boundary Hardening").

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
