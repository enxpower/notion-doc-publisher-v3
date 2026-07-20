import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

test("production apply planning initializes stable identities before read-only lifecycle planning", async () => {
  const planner = await fs.readFile(path.resolve("src/cli/plan-incremental.ts"), "utf8");
  const initializer = await fs.readFile(
    path.resolve("src/routing/publishing-identity-initialization.ts"),
    "utf8"
  );

  const initCall = planner.indexOf("await initializePublishingIdentities(config)");
  const readOnlyStart = planner.indexOf('enableNotionReadOnlyMode("plan:incremental")');
  assert.ok(initCall >= 0, "production planning must call the identity initializer");
  assert.ok(readOnlyStart > initCall, "identity initialization must finish before the read-only lifecycle plan begins");

  assert.ok(planner.includes('process.env.GITHUB_WORKFLOW !== "Incremental Content Publish"'));
  assert.ok(
    planner.includes(
      'return eventName === "workflow_dispatch" || eventName === "schedule" || eventName === "issue_comment"'
    )
  );
  assert.ok(!planner.includes("event.inputs?.mode"));

  assert.ok(initializer.includes("createAssignmentPlan(initialDocuments, config)"));
  assert.ok(initializer.includes("assertSameAssignments(initialPlan.assignments, confirmedPlan.assignments)"));
  assert.ok(initializer.includes("await client.updateDocId(assignment.pageId, assignment.docId)"));
  assert.ok(initializer.includes("autoGenerateShareToken: true"));
  assert.ok(initializer.includes("allowMissingShareToken: false"));
  assert.ok(initializer.includes("await autoFillDocuments(documentsWithIds, identityConfig)"));
  assert.ok(initializer.includes("required DOC_ID / Share Token values"));
  assert.ok(initializer.includes('enableNotionMutationAllowList('));
  assert.ok(initializer.includes('"updateDocId", "writeAutoFillProperties", "updatePageProperties"'));
});

test("manual production dispatch is one-click apply with no workflow inputs", async () => {
  const planner = await fs.readFile(path.resolve("src/cli/plan-incremental.ts"), "utf8");
  const workflow = await fs.readFile(
    path.resolve(".github/workflows/incremental-content-publish.yml"),
    "utf8"
  );

  assert.ok(workflow.includes("  workflow_dispatch:\n  issue_comment:"));
  assert.ok(!workflow.includes("confirm_production"));
  assert.ok(!workflow.includes("DISPATCH_MODE"));
  assert.ok(!workflow.includes("DISPATCH_CONFIRMATION"));
  assert.ok(workflow.includes('echo "mode=apply" >> "$GITHUB_OUTPUT"'));
  assert.ok(planner.includes('enableNotionReadOnlyMode("plan:incremental")'));
});

test("standalone or non-production planning remains non-mutating", async () => {
  const planner = await fs.readFile(path.resolve("src/cli/plan-incremental.ts"), "utf8");

  assert.ok(planner.includes('if (process.env.GITHUB_WORKFLOW !== "Incremental Content Publish")'));
  assert.ok(planner.includes("return false"));
  assert.ok(planner.includes('enableNotionReadOnlyMode("plan:incremental")'));
});
