# IMPLEMENTATION_PLAN.md

**Project:** Notion Document Publisher V3
**Companion to:** `REVIEW_REPORT.md`, `VISUAL_DIFF_REPORT.md`
**Date:** 2026-05-31

> A separate `docs/IMPLEMENTATION_PLAN.md` holds the original build plan. This
> root file is the Founder-Review execution plan.

## Constraints (non-negotiable)
Preserve DOC_ID format/generation, canonical `/docs/{DOC_ID}/`, Notion schema,
write-back architecture, GitHub Pages deploy, `preview-publish.yml`, the
production-repo denylist, and V2 systems. Static HTML/CSS/TS only — no auth, DB,
or framework. Do not commit without approval.

## Delivered (this line of work)
| Item | Status |
|------|--------|
| Shared paper system (`--paper-width` vs `--document-measure`) | done |
| Executive title + identity line + chips | done |
| Dense metadata strip (Client/Project/Updated) | done |
| Top-bar nav on both surfaces | done |
| Auto-TOC for long documents (flat when single-level) | done |
| Classification chip from `Visibility` | done |
| Brand-neutral header from `brands.json` | done |
| Browser-print button, labeled temporary; conservative `print.css` | done |
| CJK font fallbacks (screen + print) | done |
| Validation build-blocking scoped to publishable candidates | done |

## Rejected / rolled back
| Item | Reason |
|------|--------|
| Paged.js client print engine + `vendor/` | Failed visual QA (broken pagination/margins/CJK). |
| Critical/warning/info severity taxonomy | Rolled back as not-yet-safe; build-scoping kept instead. |

## Future work (priority order)
1. **Controlled PDF** — headless Playwright/Chromium `page.pdf()` with
   `displayHeaderFooter` + header/footer templates and real page numbers, at
   build time, deployed beside the HTML with a Download PDF link. Risk: adds
   Chromium to CI; must not touch deploy targets or the denylist.
2. **Register scale** — search / filter / grouping; collections; related docs.
3. **Lifecycle** — superseded / archived as a separate Notion field (not
   `BUILD_STATUS`); needs schema work.
4. **Brand depth** — per-brand accent / legal notice / logo / cover page.
5. **Validation taxonomy** — reintroduce critical/warning/info safely.

## Verification gate
`npm run check`, `npm run smoke`, `npm run preview`; manual visual QA on the
Chinese agreement (`ARCBOS-AGR-2605-0007`) as the primary document.
