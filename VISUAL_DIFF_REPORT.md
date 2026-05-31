# VISUAL_DIFF_REPORT.md

**Project:** Notion Document Publisher V3
**Date:** 2026-05-31
**Status:** Print engine (Paged.js) **rejected after visual QA** and rolled back.
This document records what was kept, what was removed, and why.

---

## 0. Outcome

The Paged.js client-side print engine failed visual QA (exploded to 25 pages,
broken margins, unprofessional header/footer, poor CJK rendering, oversized and
misaligned furniture). It was **removed entirely**. The screen UI improvements
were kept where safe; the validation-severity prototype was rolled back to the
original behavior to keep the tree coherent.

This matches the risk explicitly flagged in `REVIEW_REPORT.md` §4: browsers do
not support CSS Paged Media margin boxes, and a client polyfill was a gamble.
The gamble did not pay off. The real solution moves to a headless
Playwright/Chromium PDF pipeline as future work.

---

## 1. Removed (Paged.js print engine)

- Deleted `vendor/pagedjs/paged.js` and `vendor/print/ndp-print.js`; removed the
  whole `vendor/` tree.
- Reverted `src/assets/copy-assets.ts` to original (no JS asset copying); no
  `dist/assets/js/` is produced.
- Removed the print runtime hooks from `templates/enterprise.html`
  (`<script>`, `#ndp-print-root`, `ndpPrint`/`ndpCopyLink`).
- Removed `.ndp-paged` / `#ndp-print-root` rules from `styles/screen.css`.
- Removed running-header/footer and `counter(page)` ambitions from
  `styles/print.css`.
- No `Page X of Y` is attempted in the browser. No claim that enterprise print
  is solved.

## 2. Kept (safe screen UI)

- **Brand-neutral header** — masthead brand from Notion `Brand`; optional
  `displayName` / `tagline` / `accent` / `legalNotice` from `config/brands.json`
  (validated). ARCBOS slogan stays brand-gated; neutral fallback intact.
- **Executive title + metadata** — dominant title, identity line
  (DOC_ID · Type · Version + Status/Classification chips), dense 4-up metadata
  strip with `Updated` date.
- **Shared paper system** — `--paper-width` furniture vs `--document-measure`
  prose; tables/figures/code break out.
- **Top bar nav**, **classification chips** (from `Visibility`), **auto TOC**
  for documents with ≥4 headings — all screen-only.
- **Browser print button**, clearly labeled **"Browser Print (temporary)"**,
  calling native `window.print()`; conservative `print.css` keeps a single
  document's browser print clean. `@page { size: letter }` preserved.

## 3. Rolled back (validation severity)

The critical/warning/info severity model and `isBuildBlocking` were reverted;
`src/model/document.ts`, `src/validate/validate.ts`, `src/notion/properties.ts`,
`src/doc-id/generator.ts`, `src/cli/shared.ts`, `src/cli/build.ts`, and
`src/cli/writeback-preview.ts` are at their original, known-good state. Original
behavior: errors block the build, warnings do not. The severity model remains a
documented candidate for a future, safer pass.

## 4. Not changed
DOC_ID format/generation, canonical `/docs/{DOC_ID}/`, Notion schema, write-back
field set, `.github/workflows/preview-publish.yml`, deploy targets, the
production-repo denylist, and V2 systems. No npm dependency added. No auth, DB,
or framework.

## 5. Future work (print)
A controlled PDF — custom header/footer, real `Page X of Y`, guaranteed Letter
margins, correct CJK — implemented with **headless Playwright/Chromium**
(`page.pdf()` with `displayHeaderFooter` + `headerTemplate`/`footerTemplate`) at
build time, deployed alongside the HTML with a "Download PDF" link. This is the
only approach that guarantees a document-grade result and removes browser print
chrome. See `REVIEW_REPORT.md` §4 (Option C) and `IMPLEMENTATION_PLAN.md`.

## 6. Verification
`npm run check`, `npm run smoke`, `npm run preview` — results reported with the
final `git diff --stat` in the chat summary.
