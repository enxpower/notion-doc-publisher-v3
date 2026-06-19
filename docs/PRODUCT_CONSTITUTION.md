# Product Constitution

This is the highest-level product rulebook for notion-doc-publisher-v3.

## Supreme Rule

Every engineering and content decision must be judged by:

**Does this preserve the stability, safety, and integrity of the Notion document publishing pipeline?**

If the answer is no, do not build it.

## Product Identity

notion-doc-publisher-v3 is:

- A clean, testable, multi-brand Notion-to-static-HTML document publisher.
- A preview and test publishing pipeline, not a production system.
- A DOC_ID assignment and tracking system tied to Notion.

notion-doc-publisher-v3 is not:

- A production publishing system for live company documentation sites (that is V2).
- A Notion editor or CMS.
- A general-purpose static site generator.

## Core Value Principle

The project competes on:

1. Publishing correctness (right documents, right brand, right DOC_ID, right URL)
2. Print/PDF quality
3. Notion write-back accuracy
4. Build reliability and testability
5. Secret and production-data safety

It must not compete on:

- Speed of delivery at the expense of correctness
- Visual novelty at the expense of brand consistency
- Feature breadth at the expense of stability

## Users

Primary users:

- Andy Gong / enxpower — the document publisher operator.
- Future engineering agents working under owner governance.

The product exists to help them:

- Publish enterprise documents from Notion to the web with correct branding and format.
- Maintain stable, reviewable document IDs and published URLs.
- Preview publishing results safely before committing to production.

## Primary Domain Object

The primary domain object is:

`Document` — a Notion page with a DOC_ID, Brand, Status, and Visibility, rendered to static HTML.

It is not:

`Page` (generic) or `Post` (blog-style) — this system produces formal enterprise documents.

This distinction must be preserved in architecture, UI, data model, tests, and documentation.

## Data and Configuration Source of Truth

Source of truth:

- Notion database: document metadata, status, visibility, DOC_ID, write-back fields.
- `config/brands.json`: brand display names and taglines.
- Environment variables / GitHub secrets: tokens, IDs, and deployment flags.

Do not hardcode brand or configuration values in source files that must remain configurable.

## Quality Gate

Before release or publication, work must pass:

- TypeScript type check (`npm run check`)
- Regression tests (`npm test`)
- Security lint (`npm run lint:security`)
- Build completes without blocking errors

## Anti-Garbage Rule

Reject work that:

- Changes output paths or DOC_IDs without explicit approval.
- Adds Notion API writes outside of assign-id and writeback commands.
- Mixes brand or VI assets between companies.
- Exposes secrets or internal tokens in built output.
- Deploys to production documentation sites without explicit owner approval.

## Priority Order

When tradeoffs occur, prioritize:

1. Secret and production-data safety
2. DOC_ID and output path stability
3. Notion write-back correctness
4. Architecture integrity
5. Data integrity
6. Testability
7. Security
8. Release safety
9. Visual polish
10. Speed
