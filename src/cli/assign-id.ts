import { loadConfigOrThrow, runCli, UserFacingError } from "../config.js";
import { NotionClient } from "../notion/client.js";
import { createAssignmentPlan, assertPlanWritable } from "../doc-id/generator.js";
import { loadDocuments, writeJson } from "./shared.js";

const write = process.argv.includes("--write");
const dryRun = process.argv.includes("--dry-run") || !write;

await runCli(async () => {
  const config = loadConfigOrThrow();

  // ── 1. Load documents from Notion ────────────────────────────────────────
  // A transient Notion API error (e.g. 504 gateway timeout) must not fail the
  // overall CI run.  Treat it as a non-fatal skip: log a warning and exit 0 so
  // the downstream build step can still publish already-tagged documents.
  let documents;
  try {
    documents = await loadDocuments(config);
  } catch (error) {
    const msg = error instanceof UserFacingError
      ? error.message
      : error instanceof Error ? error.message : String(error);
    console.warn(
      `[WARN] assign-id: Could not reach Notion (${msg}). ` +
      "Skipping DOC_ID assignment for this run — existing documents are unaffected."
    );
    return; // exit 0: downstream build continues normally
  }

  // ── 2. Build assignment plan ──────────────────────────────────────────────
  const plan = createAssignmentPlan(documents, config);
  await writeJson("dist/reports/assign-id-report.json", plan);

  const skippedCount = plan.skipped.length;
  const errorCount = plan.errors.length;

  console.log(
    `DOC_ID assignment plan for ${plan.yearMonth}: ` +
    `${plan.assignments.length} assignment(s), ` +
    `${skippedCount} skipped, ${errorCount} integrity error(s).`
  );
  console.log("Report: dist/reports/assign-id-report.json");

  if (skippedCount > 0) {
    for (const issue of plan.skipped) {
      console.warn(`[SKIP] ${issue.code}: ${issue.message}`);
    }
  }

  if (errorCount > 0) {
    for (const issue of plan.errors) {
      console.error(`[ERROR] ${issue.code}: ${issue.message}`);
    }
  }

  if (dryRun) {
    if (write) {
      throw new UserFacingError("Invalid arguments: --dry-run and --write cannot be combined.");
    }
    return;
  }

  // ── 3. Guard: integrity errors block the write ────────────────────────────
  // Per-document issues are already in plan.skipped and do not throw.
  assertPlanWritable(plan);

  if (plan.assignments.length === 0) {
    console.log("No missing DOC_ID values to assign.");
    return;
  }

  // ── 4. Concurrency double-check ───────────────────────────────────────────
  let reloaded;
  try {
    reloaded = await loadDocuments(config);
  } catch (error) {
    const msg = error instanceof UserFacingError
      ? error.message
      : error instanceof Error ? error.message : String(error);
    console.warn(
      `[WARN] assign-id: Notion became unreachable during concurrency re-check (${msg}). ` +
      "Aborting assignment to avoid a race — no Notion records were modified."
    );
    return; // exit 0
  }

  const secondPlan = createAssignmentPlan(reloaded, config);
  assertPlanWritable(secondPlan);
  const first = plan.assignments.map((item) => `${item.pageId}:${item.docId}`).join("\n");
  const second = secondPlan.assignments.map((item) => `${item.pageId}:${item.docId}`).join("\n");
  if (first !== second) {
    throw new UserFacingError(
      "DOC_ID assignment changed after re-query. Aborting to avoid concurrent assignment conflict."
    );
  }

  // ── 5. Write DOC_IDs to Notion ────────────────────────────────────────────
  const client = new NotionClient(config);
  for (const assignment of plan.assignments) {
    await client.updateDocId(assignment.pageId, assignment.docId);
  }
  console.log(`Assigned ${plan.assignments.length} DOC_ID value(s).`);
});
