# Routed Readonly Diagnostics

Stage 8 adds a sanitized diagnostic command for routed readonly data quality:

```bash
npm run diagnose:routed:readonly
```

For mocked local verification without Notion:

```bash
ROUTED_READONLY_DIAGNOSTIC_TEST_MODE=fixture npm run diagnose:routed:readonly
```

The command uses the same single-database readonly configuration as
`build:routed:readonly`:

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `ALLOWED_BRANDS`, if already configured
- committed route and presentation configuration

It enables the Notion mutation guard before `loadDocuments()`. While active,
all guarded Notion update paths throw. The command does not call DOC_ID
assignment, Share Token autofill, Namespace autofill, Portal Category autofill,
preview writeback, PDF queue/writeback, deployment planning, or production
deployment code.

## Output

Diagnostics are local derived artifacts under:

```text
dist/diagnostics/routed-readonly/diagnostics-summary.json
dist/diagnostics/routed-readonly/_private/correlation.json
```

`dist/` is gitignored. The public summary contains only sanitized aliases,
aggregate counts, collision classifications, salted fingerprints, and
non-executed remediation categories.

The private correlation file maps diagnostic aliases to Notion page IDs so the
owner can locate records later. It is outside deployable site roots, gitignored,
and not printed beyond its relative file location. It must not be committed.

## Privacy Model

The sanitized summary must not include titles, page IDs, database IDs, Notion
URLs, complete DOC_ID values, Share Tokens, private canonical URLs, email
addresses, absolute local paths, environment values, stack traces, or document
block content.

Fingerprints use a random per-run diagnostic salt. The salt is not persisted in
source control and raw source values are never used as aliases.

## Remediation

The command only reports. It separates findings into:

- no action required
- owner review required
- safe future auto-fill candidate
- manual DOC_ID correction required
- URL-breaking change risk
- duplicate record cleanup candidate
- false-positive validation candidate
- future owner-approved Notion mutation required

No source Notion record is changed by this command.
