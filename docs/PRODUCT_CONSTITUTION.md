# Product Constitution

This is the highest-level product rulebook for notion-doc-publisher-v3.

## Authority Note

Phase 2 final production sealing (`docs/PHASE2_FINAL_PRODUCTION_SEAL.md`) superseded this
document's earlier preview-only product identity. Where this document once described the
project as a preview/test pipeline only, that description is obsolete and is corrected below.
The constitutional constraints on secret safety, identifier stability, and fail-closed
behavior are unchanged and remain in force at full strength.

## Supreme Rule

Every engineering and content decision must be judged by:

**Does this preserve the stability, safety, and integrity of the Notion document publishing pipeline?**

If the answer is no, do not build it.

## Product Identity

notion-doc-publisher-v3 is:

- A clean, testable, multi-brand Notion-to-static-HTML document publisher.
- A governed production document publishing system with structurally separated preview and
  production pathways. Production deployment is fail-closed: any failure in validation,
  rendering, deployment, or live verification preserves the previous successful published
  output rather than replacing it.
- A DOC_ID and Share Token assignment and tracking system tied to Notion, with stable
  identifiers, published URLs, brand routing, and lifecycle state protected from
  unauthorized or incidental change.

notion-doc-publisher-v3 is not:

- An unrestricted general-purpose website builder. Production publishing is limited to the
  documents, brands, and routes explicitly configured in `config/brands.json` and
  `config/brand-routes.json`, deployed only through the single expressly authorized
  production workflow.
- A Notion editor or CMS. Notion remains the only governed source of publishing records;
  this system renders and deploys, it never becomes a second editing surface.
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

- Changes output paths, DOC_IDs, or Share Tokens without explicit approval, or rotates/
  reassigns an existing identifier as a side effect of unrelated work.
- Adds Notion API writes outside the expressly authorized commands and allow-listed
  properties (`assign-id`, the writeback commands, and the production identity
  initialization step that fills only missing DOC_ID/Share Token values before a
  production apply run).
- Mixes brand or VI assets between companies.
- Exposes secrets or internal tokens in built output.
- Introduces a second automatic production publisher, a second production schedule, or any
  deployment path to a production destination other than the single expressly authorized
  production workflow.

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
