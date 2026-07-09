# Acceptance Checklist

## General

- Project context files exist.
- Scope is clear.
- Repository purpose is documented.
- No unrelated files were changed.
- No secrets are committed.
- Documentation is concise and actionable.
- All generated repository content is English-only.

## For Backend / Automation Repositories

- Runtime entrypoints are documented.
- Required environment variables are listed by name only, not values.
- No secrets are committed.
- Failure handling is documented or marked To verify.
- Logs and output locations are documented or marked To verify.
- Deployment or scheduler path is documented or marked To verify.

## For Public HTML / Website Output

- Mobile layout has no horizontal scroll.
- Desktop, tablet, and mobile layouts are checked.
- Page title and description are relevant.
- Social preview metadata exists where applicable.
- Favicon exists where applicable.
- Preview image exists or is explicitly listed as missing.
- Correct VI is applied.
- No dark scheme is used unless approved.
- Public pages do not expose internal credentials or private logic.

## Repository-Specific Checks

- Notion remains the only editing source.
- `validate` and `build` do not write to Notion.
- `DOC_ID` assignment stays limited to `npm run assign-id` or approved publish workflows.
- Static HTML remains the primary published artifact.
- PDF output is generated from the same document model.
- PDF download links use relative paths.
- Required environment variables are documented by name only.
- `.env` and secret values are not committed.
- `npm run check`, `npm test`, and `npm run lint:security` pass before behavior changes are accepted.
- Visibility, share-token, namespace, and legacy URL behavior are not weakened.
- Legacy URL flags are not enabled without explicit approval.
- V2 systems are not modified from this repository.
- Private, draft, unsigned, confidential, or unapproved records are not published.
