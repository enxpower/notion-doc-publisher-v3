# Next Tasks

## Current Status

The repository is a public TypeScript / Node.js Notion document publishing tool. It has a strong README, `package.json` scripts for checks, tests, security lint, build, preview, controlled ID assignment, preview publish, and PDF export/queue/site generation. `.env.example` documents configuration names only.

## Next Recommended Tasks

1. Confirm which production sites currently consume this publisher output.
2. Verify all GitHub Actions workflows and document which ones are production paths versus QA/manual sidecars.
3. Run `npm run check`, `npm test`, and `npm run lint:security` before any code behavior change.
4. Review visibility, share-token, private-link namespace, and legacy URL behavior before changing routing logic.
5. Confirm whether `DOCUMENT_REGISTER_PUBLIC` and `ROBOTS_DISALLOW_DOCS` defaults are still correct for each consuming site.
6. Document the exact approval process for production workflow changes and Notion write-back changes.
7. Keep README, Project Context Pack, and workflow docs aligned when publishing behavior changes.

## Do Not Do

- Do not commit `.env` or secret values.
- Do not add dependencies without explicit approval.
- Do not weaken `lint:security`.
- Do not make `validate` or `build` write to Notion.
- Do not assign `DOC_ID` outside `npm run assign-id` or approved publish workflows.
- Do not hardcode deployment domains into PDF links.
- Do not enable legacy URL flags without explicit approval.
- Do not modify V2 systems from this repository.
- Do not publish private, draft, unsigned, confidential, or unapproved records.

## Handoff Prompt

Continue this repository from its project context.

First read:
1. CLAUDE.md
2. docs/project-brief.md
3. docs/decision-log.md
4. docs/todo-next.md
5. docs/acceptance-checklist.md

Then summarize the current state in no more than 8 bullets and execute only the next task listed in docs/todo-next.md. Do not change scope.
