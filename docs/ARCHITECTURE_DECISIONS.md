# Architecture Decisions

This file records the frozen V1 architecture decisions for `notion-doc-publisher-v3`.

Status: frozen. Implementation may start after this architecture freeze. Any change to these decisions requires an explicit architecture update before implementation changes.

## Frozen Decisions

1. `DOC_ID` assignment is an explicit command, separate from `validate` and `build`.
2. `validate` and normal `build` are read-only with respect to Notion by default.
3. `DOC_ID` format is `BRAND-TYPE-YYMM-SEQ4`.
4. `DOC_ID` sequence numbers are scoped by `YYMM` globally across all brands and document types.
5. `DOC_ID` values are never reused.
6. Existing valid `DOC_ID` values are never overwritten.
7. Malformed `DOC_ID` values block publishable output.
8. Brand or document type changes after `DOC_ID` assignment do not change `DOC_ID`.
9. A valid `DOC_ID` whose embedded brand/type tokens no longer match current metadata produces a warning, not an automatic rewrite.
10. Canonical output path is `/docs/{DOC_ID}/`.
11. Deployment is out of V1.
12. Publishable output requires local asset copying.
13. Remote Notion assets are allowed only for draft preview output.
14. Future extension points remain documented but are not scaffolded in V1.
15. ID assignment must produce a dry-run report before mutation.
16. ID assignment is fail-fast: any invalid candidate or collision stops the command before any ID is written.
17. ID assignment must re-query the database immediately before writing and fail on concurrent assignment conflicts.
18. If the next sequence for a `YYMM` would exceed `9999`, assignment fails for that `YYMM`.
19. Deleted pages do not make their `DOC_ID` reusable.

## Frozen Notion Property Types

| Property | Notion type |
| --- | --- |
| `Title` | `title` |
| `DOC_ID` | `rich_text` scalar |
| `Brand` | `select` |
| `Client` | `select` |
| `Project` | `select` |
| `Document Type` | `select` |
| `Version` | `select` |
| `Status` | `select` |
| `Visibility` | `select` |
| `Publish` | `checkbox` |

`DOC_ID` must contain exactly one scalar ID value after trimming. Alternate property types are out of scope for V1.

## Frozen Print Target

- Paper size: US Letter.
- Margin: 18mm.
- Browser-generated headers and footers are not required.
- Headings avoid page breaks immediately after the heading.
- Tables avoid broken rows where possible.
- Wide tables use a shrink or overflow strategy.
- Images render at `max-width: 100%`.

## V1 Exclusions

V1 does not include:

- Deployment commands.
- Deployment configuration.
- GitHub Actions changes.
- Writes to target site repositories.
- Extension scaffolding for themes, search, sitemap generation, external registries, or incremental builds.
