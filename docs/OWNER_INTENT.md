# Owner Intent

This document records why notion-doc-publisher-v3 exists and what the owner wants to protect.

## Owner

Owner: Andy Gong / enxpower

## Core Intent

This project exists to:

- Publish formal enterprise documents from a Notion database to static HTML via GitHub Pages.
- Support multi-brand publishing (ARCBOS, ENERGIZE, AGIM) from a single publisher.
- Keep Notion as the only editing source — no editing in code or HTML templates.
- Maintain print/PDF quality as a first-class output requirement.
- Prove the V3 architecture before replacing V2 production publishers.

## Biggest Risks

The owner wants to avoid:

- Accidental writes to production Notion databases.
- Accidental deployment to production documentation repositories (docs-arcbos-v2, docs-energize-v2, agim-docs).
- Exposure of NOTION_TOKEN or other secrets in source files or built output.
- Changes to publishing behavior, output paths, or DOC_IDs without explicit owner approval.
- Breaking the preview-publish.yml workflow in a way that causes silent failures.
- Mixing brand VI between companies.

## Success Definition

Success means:

- Publishable Notion documents build to clean static HTML with the correct brand, layout, and output path.
- DOC_IDs are stable and never collide.
- Preview publishing runs correctly via GitHub Actions + GitHub Pages.
- Write-back to Notion (PUBLISHED_URL, BUILD_STATUS, PUBLISHED_AT) is accurate and non-destructive.
- Future agents can recover full project context from local repository files alone.

## Failure Definition

Failure means:

- Secrets are exposed.
- Output paths or DOC_IDs change unexpectedly.
- Production Notion databases are written to during preview or development runs.
- The publisher is deployed to production documentation sites without explicit owner approval.
- The preview-publish.yml safety guard is bypassed.

## Development Preferences

Preferred working style:

- GitHub-first development
- Branches before changes
- Draft PRs before review
- Small auditable changes
- Governance before features
- Checks before confidence

## Priority Order

When tradeoffs occur, prioritize:

1. Secret and production-data safety
2. DOC_ID and output path stability
3. Notion write-back accuracy
4. Architecture integrity
5. Testability
6. Release safety
7. Visual polish
8. Speed

## Agent Reminder

Future AI coding agents should read this document before planning any work in this repository.
