# Decision Log

## Active Decisions

- Decision: Initial Project Context Pack added.
  Reason: Future AI coding sessions need a reliable project baseline instead of relying on chat history.
  Impact: Future sessions should read `CLAUDE.md` and docs files before making changes.

- Decision: Notion remains the only editing source.
  Reason: The README defines Notion as the source of truth for document editing.
  Impact: Future work must not introduce direct manual editing of generated HTML or PDF output as the source of truth.

- Decision: Validation and build commands must not write to Notion.
  Reason: The README explicitly states that `validate` and `build` do not write to Notion.
  Impact: Future agents must keep read-only and write-back paths clearly separated.

- Decision: `DOC_ID` assignment remains controlled.
  Reason: The README states that `DOC_ID` assignment happens only through `npm run assign-id` or the approved publish workflow.
  Impact: Future agents must not add implicit ID assignment in unrelated commands.

- Decision: Static HTML is the primary artifact and PDF is generated from the same model.
  Reason: The README defines static HTML as the primary published artifact and PDF as generated beside it.
  Impact: Future layout or rendering changes must keep HTML and PDF output consistent.

- Decision: Relative PDF links are required.
  Reason: The README states that PDF download links are relative paths, not hardcoded domains.
  Impact: Future agents must not hardcode deployment domains into PDF links.

- Decision: Production workflow changes require explicit owner approval.
  Reason: The README marks production workflow changes as approval-gated.
  Impact: Future agents must stop before changing production workflows unless explicitly instructed.

- Decision: Legacy URL flags remain explicit and risky.
  Reason: Build code warns that legacy URL modes can expose DOC_IDs or guessable paths.
  Impact: Future agents must not enable or normalize legacy compatibility behavior without approval.
