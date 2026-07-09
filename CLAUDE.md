# CLAUDE.md

## Project

This repository is Notion Doc Publisher V3, an enterprise Notion-to-static-document publisher for serious company documents.

## Operating Context

This repository belongs to the publishing infrastructure used across Andy Gong's company ecosystem. It converts selected Notion database records into polished static HTML documents and generated PDF downloads.

## Current Purpose

The current practical purpose is to keep Notion as the editing source while GitHub Actions and local commands handle validation, ID assignment, build, static publishing, PDF generation, controlled write-back, and preview workflows.

## Architecture

The repository is a TypeScript / Node.js document publishing tool.

Known structure from inspection:

- `README.md` documents the production model, publish outputs, required Notion fields, setup, commands, workflows, PDF behavior, and layout system.
- `package.json` defines TypeScript, validation, build, test, security lint, preview, publish, ID assignment, and PDF scripts.
- `.env.example` lists required environment variable names and safe defaults.
- `src/cli/build.ts` builds static output, copies styles/assets, validates documents, skips invalid documents, writes reports, renders HTML pages, and manages legacy URL compatibility flags.
- Build output is written under `dist/`.
- Reports are written under `dist/reports/`.
- Generated HTML and PDF outputs are derived from the same document model.

## Production Model

Preserve these production rules:

- Notion is the only editing source.
- `validate` and `build` do not write to Notion.
- `DOC_ID` assignment happens only through `npm run assign-id` or the approved publish workflow.
- Static HTML is the primary published artifact.
- PDF export is generated from the same document model and published beside HTML.
- PDF download links must use relative paths, not hardcoded domains.
- Existing V2 systems must not be modified from this repository.
- Production workflow changes require explicit owner approval.

## Safety Rules

- Never commit `.env` or secret values.
- Environment variable names may be documented; values must not be committed.
- Treat Notion write-back paths as controlled production actions.
- Do not weaken validation, visibility, private-link, share-token, or security-lint behavior.
- Do not expose private documents through guessable URLs.
- Legacy URL compatibility flags are risky and must remain explicit.
- Do not publish draft, unsigned, confidential, or unapproved records.
- Keep generated content English-only unless the owner explicitly approves multilingual output for a specific document set.

## Brand / UI Rules

Generated public HTML must follow the correct brand VI:

- Use AGI&M VI for AGI&M documents.
- Use EnergizeOS VI for EnergizeOS documents.
- Use ARCBOS VI for ARCBOS documents.
- Use Andy Gong / GONG-VI only when no company VI applies.
- Public HTML must be responsive across desktop, tablet, and mobile.
- Horizontal scrolling must be prevented except for intentionally scrollable tables or code blocks.
- Every public HTML document must include relevant title, description, favicon, and social preview metadata when applicable.
- PNG preview images are preferred over SVG when social sharing compatibility matters.
- Avoid dark schemes unless the target VI explicitly requires it.

## Hard Rules

- Do not modify unrelated files.
- Do not add dependencies unless explicitly approved.
- Do not change deployment structure unless explicitly approved.
- Do not change public routes unless explicitly approved.
- Do not commit credentials, tokens, API keys, OAuth secrets, private keys, or environment variable values.
- Keep changes minimal, purposeful, and reversible.
- All generated repository content must be English-only.
- Update docs/todo-next.md at the end of every coding session.

## Required Checks

When code changes affect publisher behavior, run or request these checks:

- `npm run check`
- `npm test`
- `npm run lint:security`
- `npm run validate` when Notion configuration is available
- `npm run build` when build inputs are available

## Session Handoff Rule

Every coding session must end by updating:

- docs/decision-log.md if a decision changed
- docs/change-log.md if files changed
- docs/todo-next.md with exact next steps

If docs/change-log.md does not exist and files were changed, create it.
