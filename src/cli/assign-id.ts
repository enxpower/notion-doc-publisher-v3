import { loadConfigOrThrow, runCli, UserFacingError } from "../config.js";
import { NotionClient } from "../notion/client.js";
import { createAssignmentPlan, assertPlanWritable } from "../doc-id/generator.js";
import { loadDocuments, writeJson } from "./shared.js";

const write = process.argv.includes("--write");
const dryRun = process.argv.includes("--dry-run") || !write;

await runCli(async () => {
  const config = loadConfigOrThrow();
  const documents = await loadDocuments(config);
  const plan = createAssignmentPlan(documents, config);
  await writeJson("dist/reports/assign-id-report.json", plan);

  console.log(`DOC_ID assignment plan for ${plan.yearMonth}: ${plan.assignments.length} assignment(s).`);
  console.log("Report: dist/reports/assign-id-report.json");
  if (plan.errors.length > 0) {
    console.error(`Blocking issues: ${plan.errors.length}`);
  }
  if (dryRun) {
    if (write) {
      throw new UserFacingError("Invalid arguments: --dry-run and --write cannot be combined.");
    }
    return;
  }

  assertPlanWritable(plan);
  if (plan.assignments.length === 0) {
    console.log("No missing DOC_ID values to assign.");
    return;
  }

  const reloaded = await loadDocuments(config);
  const secondPlan = createAssignmentPlan(reloaded, config);
  assertPlanWritable(secondPlan);
  const first = plan.assignments.map((item) => `${item.pageId}:${item.docId}`).join("\n");
  const second = secondPlan.assignments.map((item) => `${item.pageId}:${item.docId}`).join("\n");
  if (first !== second) {
    throw new UserFacingError("DOC_ID assignment changed after re-query. Aborting to avoid concurrent assignment conflict.");
  }

  const client = new NotionClient(config);
  for (const assignment of plan.assignments) {
    await client.updateDocId(assignment.pageId, assignment.docId);
  }
  console.log(`Assigned ${plan.assignments.length} DOC_ID value(s).`);
});
