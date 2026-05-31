# REVIEW_REPORT.md

**Project:** Notion Document Publisher V3
**Date:** 2026-05-31
**Status:** Review of record. Print conclusions superseded by the Paged.js rejection (see `VISUAL_DIFF_REPORT.md`).

## Executive summary
V3 is a clean static document exporter. The largest gaps the founder identified:
print quality, paper-vs-reading-width conflation, weak (form-like) metadata,
shallow brand neutrality, and the absence of a platform surface (nav, TOC,
classification). The screen UI gaps were addressable as presentation/config
layers without touching the publishing core. The print gap was **not** safely
solvable in the browser — confirmed in practice when the Paged.js attempt was
rejected at visual QA.

## Findings by area

### Print (critical)
Browsers do **not** support CSS Paged Media margin boxes (`@top-*`, `@bottom-*`,
`counter(page)`), so "Page X of Y" and document-controlled running headers are
impossible in native browser print, and the browser's own header/URL chrome
cannot be removed by a web page. A client polyfill (Paged.js) was the only pure
client option to fake it — and it produced broken output (exploded pagination,
broken margins, poor CJK). **Conclusion: controlled PDF must be a build-time
headless Playwright/Chromium task. Future work.**

### Paper vs reading width
The sheet width and the prose measure were effectively equal, so documents felt
stretched. Fix: keep a shared `--paper-width` for furniture and constrain prose
to a separate `--document-measure`; let tables/figures/code break out.

### Metadata
The 3×2 label/value grid read as an admin form. Fix: a dominant title, a single
identity line (DOC_ID · Type · Version + Status/Classification chips), and a
dense, scannable metadata strip.

### Branding
`brands.json` (displayName + tagline) keeps the masthead brand-neutral; the
ARCBOS slogan is gated to ARCBOS. Accent/legal-notice were explored but rolled
back with the rejected expansion; the engine remains brand-neutral by default.

### Platform UX
Added shared top-bar nav, auto-TOC for long documents, and classification chips
derived from Notion `Visibility` — all screen-only, no schema change.

### Validation
Build-blocking is scoped so only publishable candidates and cross-document
integrity errors halt the build; drafts don't block valid documents. A richer
critical/warning/info taxonomy was prototyped and rolled back as not-yet-safe.

## Scope verdict
- **Now (V3):** reading-measure fix, executive metadata, top-bar/TOC,
  classification, brand-neutral header, browser-print button (labeled
  temporary), validation build-scoping.
- **Future:** headless Playwright PDF (controlled print), register
  search/collections/lifecycle, per-brand accent/logo/legal, optional executive
  fields (subtitle/abstract/owner).
- **Never (per constraints):** auth, DB, SPA framework, production deploy.
