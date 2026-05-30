# Architecture Review

## Review Scope

This review covers:

- `docs/SYSTEM_BLUEPRINT.md`
- `docs/NOTION_SCHEMA.md`
- `docs/DOCUMENT_MODEL.md`
- `docs/OUTPUT_SPEC.md`
- `docs/IMPLEMENTATION_PLAN.md`

The architecture is directionally sound: it keeps the product small, static-first, Notion-sourced, and explicitly separate from V2 systems. It is not yet safe to implement. Several core contracts are still ambiguous enough that implementation would either hard-code assumptions or create migration debt immediately.

## Go/No-Go Recommendation

No-go for implementation.

Proceed only after the required changes in this review are resolved and the frozen decisions are written back into the architecture documents. The most important blockers are `DOC_ID` write semantics, exact Notion property types, path stability, publish target safety, asset policy, and print/PDF acceptance criteria.

## Critical Findings

### 1. `DOC_ID` Generation Is Underspecified And Mutates Notion Too Early

Severity: Blocking

The architecture says the build flow should "generate and write `DOC_ID` only when missing" in the main data flow (`SYSTEM_BLUEPRINT.md:95-108`) and repeats that ID generation writes back to Notion (`IMPLEMENTATION_PLAN.md:90-113`). This creates a dangerous coupling between a read/build command and mutation of the source of truth.

Risks:

- A normal build can accidentally mutate Notion.
- Parallel builds can race and assign the same next sequence.
- A failed build can still leave partially assigned IDs.
- A developer pointing at the wrong database can permanently write IDs into production-like data.
- The architecture does not define whether ID assignment is part of `validate`, `build`, or a separate command.

Required change:

- Freeze ID assignment as an explicit write command, not an implicit build side effect.
- Define `validate` and normal `build` as read-only by default.
- Require a dry-run report before writing IDs.
- Define whether ID writes are all-or-nothing, best-effort, or fail-fast.
- Define how the system handles concurrent ID assignment. At minimum, it must re-query before writing and fail on collision.

### 2. Global Sequence Rules Do Not Cover Real Edge Cases

Severity: Blocking

The schema says sequence numbers are global and use the next number after the highest valid `SEQ4` (`NOTION_SCHEMA.md:133-141`). That is simple, but it does not settle enough edge cases.

Missing decisions:

- What happens after `9999`?
- Is the highest sequence global across all months or scoped by `YYMM`?
- If global across all months, what does `YYMM` actually mean beyond creation month?
- Are manually entered future IDs allowed to advance the sequence?
- Are archived documents included?
- Are deleted Notion pages ignored, and can their IDs ever be reused?
- Is a malformed ID with a high-looking sequence ignored or blocking?
- Are lowercase IDs normalized or rejected?
- Can brand or document type changes after ID assignment create an ID that no longer matches metadata?

Required change:

- Freeze sequence scope explicitly.
- State that `DOC_ID` is never reused, even if a page is archived or deleted.
- State whether `DOC_ID` must continue to match current `Brand` and `Document Type` after assignment.
- Define overflow behavior before implementation.

### 3. Notion Property Types Are Too Flexible

Severity: Blocking

`DOC_ID` is allowed to be "Title, rich text, or unique text property", while `Title`, `Client`, `Project`, and `Version` also allow multiple possible types (`NOTION_SCHEMA.md:9-24`). This flexibility pushes complexity into every parser and test.

Risks:

- Notion has only one title property. Supporting both `DOC_ID` and `Title` as possible title-like fields creates unnecessary branches.
- Rich text can contain multiple spans, links, mentions, and formatting where the system expects a single scalar.
- Select versus rich text for `Client` and `Project` changes slug stability and validation semantics.
- Flexible types make fixture design and implementation harder without improving the V1 product.

Required change:

- Freeze exact property types before implementation.
- Recommended V1 contract:
  - `Title`: Notion title property.
  - `DOC_ID`: rich text or plain text property, system-owned, one scalar value.
  - `Brand`: select.
  - `Client`: select.
  - `Project`: select.
  - `Document Type`: select.
  - `Version`: select.
  - `Status`: select.
  - `Visibility`: select.
  - `Publish`: checkbox.
- Define exact behavior when a text property contains multiple rich text spans.

### 4. Output Path Stability Is Weaker Than It Looks

Severity: Blocking

The canonical path includes `brandSlug` and `documentTypeSlug` plus `DOC_ID` (`DOCUMENT_MODEL.md:181-195`, `OUTPUT_SPEC.md:40-54`). This is not truly stable if brand or document type labels change. The docs say the path is stable because version is excluded, but they do not address metadata drift.

Risks:

- Renaming a brand changes URLs.
- Renaming a document type changes URLs.
- Correcting a typo in metadata changes URLs.
- Moving a document from one type to another breaks existing links.
- `DOC_ID` already contains brand and type tokens, making the slug path redundant and fragile.

Required change:

- Freeze the canonical URL strategy before implementation.
- Strong recommendation: use `/docs/{DOC_ID}/` for V1 and keep brand/type only in index metadata.
- If brand/type slugs remain in the path, freeze redirect strategy and declare that brand/type labels become URL-affecting fields after first publish.

### 5. Deployment Safety Is Stated But Not Enforced Architecturally

Severity: Blocking

The docs say not to write to production repositories and to keep deployment optional (`SYSTEM_BLUEPRINT.md:106-108`, `OUTPUT_SPEC.md:182-193`, `IMPLEMENTATION_PLAN.md:190-202`). They do not define a hard safety mechanism.

Risks:

- `TARGET_SITE_REPO` can point to a production repository by mistake.
- A deploy command can push to the current branch or wrong remote.
- There is no allowlist, denylist, dry-run, branch policy, or confirmation model.
- "Validate the target is not protected production" is not mechanically defined.

Required change:

- Freeze deployment as out of V1 implementation, or require strict safeguards:
  - explicit `DEPLOY_ENABLED=true`
  - non-production allowlist
  - target branch fixed to a development branch
  - dry-run output before push
  - no deploy from CI unless separately approved
  - no modification of existing GitHub Actions

### 6. Asset Policy Conflicts With Print/PDF Reliability

Severity: High

The model allows remote Notion file URLs as an early fallback (`DOCUMENT_MODEL.md:117-132`), and output validation only warns on remote assets (`OUTPUT_SPEC.md:143-157`, `OUTPUT_SPEC.md:225-230`). That is not compatible with the stated print/PDF goal.

Risks:

- Notion signed URLs can expire.
- PDFs generated later may have broken images.
- GitHub Pages output may work initially and fail later.
- Print QA is unreliable if asset availability changes between build and print.

Required change:

- For publishable documents, local asset copying should be required, not optional.
- Remote assets may be allowed only for draft preview output.
- Missing or uncopyable assets should fail publishable builds.

### 7. Print/PDF Requirements Are Too Vague To Test

Severity: High

The print/PDF strategy says to use print CSS and later Playwright (`SYSTEM_BLUEPRINT.md:169-180`, `OUTPUT_SPEC.md:195-212`, `IMPLEMENTATION_PLAN.md:163-188`). The acceptance criteria are subjective: "print cleanly" and "acceptable page-break behavior".

Risks:

- Implementation can pass without concrete paper size, margins, header/footer behavior, or visual test cases.
- Long tables, wide tables, images, callouts, and code blocks can degrade badly.
- Browser print preview and Playwright PDF can differ.

Required change:

- Freeze print target for V1:
  - paper size
  - margins
  - whether headers/footers exist
  - whether background graphics print
  - max content width
  - table overflow strategy
  - image scaling rules
  - page-break rules for headings and blocks
- Define representative print fixtures and pass/fail checks before implementing PDF automation.

### 8. Validation Gaps Remain Around Notion Content And Links

Severity: High

Validation covers required fields, ID format, version format, publishability, empty content, assets, and path collisions (`SYSTEM_BLUEPRINT.md:182-195`, `NOTION_SCHEMA.md:161-179`, `DOCUMENT_MODEL.md:225-244`, `OUTPUT_SPEC.md:214-230`). It does not yet cover several likely failure modes.

Missing validation:

- Duplicate `DOC_ID` values in Notion.
- `DOC_ID` token mismatch with brand/type metadata, if that relation is required.
- Empty strings after trimming rich text.
- Select options that exist but are not in the configured token map.
- Unsafe URL schemes in links and files.
- Notion mentions, equations, synced blocks, child pages, embeds, bookmarks, columns, toggles, and databases.
- Case-sensitive slug collisions, especially on case-insensitive local filesystems.
- Reserved path names and filesystem-unsafe characters.
- HTML title and metadata escaping.
- Asset filename collisions.

Required change:

- Add a validation matrix before implementation: field-level, ID-level, block-level, asset-level, path-level, and deploy-level.
- Define which unsupported Notion blocks fail publishable builds and which render as warnings.

### 9. The Document Model Is Slightly Over-Abstracted For V1

Severity: Medium

The model introduces `DocumentModel`, `DocumentMeta`, `EntityRef`, `DocumentTypeRef`, `DocumentAsset`, `SourceInfo`, `ValidationResult`, and `RenderContext` (`DOCUMENT_MODEL.md:9-210`). This is reasonable for a serious renderer, but some pieces are premature.

Overengineering risks:

- `RenderContext` may duplicate `DocumentModel` without adding value.
- `EntityRef` for client and project may imply future entity registries that V1 explicitly avoids.
- `generatedAt` in document metadata can make output nondeterministic and noisy unless isolated to site build metadata.
- `validation` embedded inside the model may blur data and process state.

Required change:

- Keep the model, but freeze a minimal V1 subset.
- Do not implement future-facing fields until a renderer needs them.
- Move volatile build metadata out of the document identity model unless there is a concrete display requirement.

### 10. Future Extension Points Are Too Prominent

Severity: Medium

The docs repeatedly list future features: themes, search, sitemap, asset caching, incremental builds, deploy automation, external registries, related documents, revision history, and PDF hints (`SYSTEM_BLUEPRINT.md:197-212`, `DOCUMENT_MODEL.md:246-259`, `IMPLEMENTATION_PLAN.md:245-258`). These are useful as boundaries, but they also create implementation temptation.

Required change:

- Mark future extensions as explicitly out of implementation scope for V1.
- Do not scaffold extension systems until needed.
- Keep V1 to Notion read, optional explicit ID assignment, validation, static HTML, local assets, and print CSS.

## Required Changes Before Implementation

1. Freeze the exact Notion database property types.
2. Freeze `DOC_ID` assignment as an explicit mutation command, separate from read-only validation and normal build.
3. Freeze `DOC_ID` sequence scope, collision handling, overflow behavior, deleted-page behavior, and metadata mismatch rules.
4. Freeze canonical output paths. Prefer `/docs/{DOC_ID}/` for V1.
5. Freeze publishability rules for `Status`, `Visibility`, and `Publish`, including which build targets may emit `Client` visibility.
6. Require local asset copying for publishable output.
7. Define print acceptance criteria with paper size, margins, page-break rules, image behavior, and table behavior.
8. Define a validation matrix for metadata, IDs, content blocks, links, assets, paths, and deployment.
9. Freeze deployment as out of V1, or define mechanical safeguards before any deploy command exists.
10. Trim implementation scope so future extension points are documented but not scaffolded prematurely.

## What Must Be Frozen Before Implementation

The following decisions should be treated as hard contracts:

- The Notion title property is `Title`.
- `DOC_ID` is a separate system-owned scalar text property.
- Select fields and allowed values for `Brand`, `Client`, `Project`, `Document Type`, `Version`, `Status`, and `Visibility`.
- Token maps for all V1 brands and document types.
- Whether `DOC_ID` token mismatch with changed metadata is valid, warning, or error.
- Whether sequence numbers are global forever or scoped by month.
- Whether builds can ever write to Notion by default. Recommendation: no.
- Canonical document URL shape.
- Slug generation rules and collision behavior.
- Supported Notion block list for publishable documents.
- Remote asset policy. Recommendation: fail publishable builds on remote-only assets.
- Print target and minimum quality checks.
- Deployment policy. Recommendation: no deploy command in first implementation pass.

## Final Recommendation

Do not implement yet.

The architecture is close, but it currently leaves the riskiest behaviors to implementation judgment. That is exactly where small publishing systems become brittle: accidental source mutations, broken URLs, expired assets, and unsafe deploy targets. Resolve the frozen decisions above first, then implementation can stay boring and small.
