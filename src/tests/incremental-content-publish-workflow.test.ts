import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/incremental-content-publish.yml");

test("incremental-content-publish workflow delegates ARCBOS artifact sanitation to the repository script", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  assert.match(workflow, /run: bash scripts\/prepare-arcbos-pages-artifact\.sh targets\/arcbos-pages/);
  assert.doesNotMatch(workflow, /iname\s+'\*audit\*(?!')/, "the fragile inline sanitation block must not be reintroduced");
});

test("incremental-content-publish workflow still deploys ARCBOS through the official Pages actions", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  assert.match(workflow, /uses: actions\/configure-pages@v\d/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v\d/);
  assert.match(workflow, /uses: actions\/deploy-pages@v\d/);
});

test("incremental-content-publish workflow persists private state only after live verification, and writes back to Notion only after state is persisted", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  const verifyIndex = workflow.indexOf("name: Verify live deployment transaction");
  const persistIndex = workflow.indexOf("name: Persist verified private state");
  const writebackIndex = workflow.indexOf("name: Write verified lifecycle results to Notion");

  assert.ok(verifyIndex > -1, "live deployment verification step is missing");
  assert.ok(persistIndex > -1, "private state persistence step is missing");
  assert.ok(writebackIndex > -1, "Notion lifecycle writeback step is missing");
  assert.ok(verifyIndex < persistIndex, "private state must be persisted after live verification");
  assert.ok(persistIndex < writebackIndex, "Notion writeback must happen after private state is persisted");
});

test("incremental-content-publish workflow does not reintroduce a legacy or unsafe publishing path", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  // Exclude the safety-scan step itself, whose grep denylist legitimately names these blocked patterns as text.
  const operationalWorkflow = workflow
    .split("\n")
    .filter((line) => !/name: Validate workflow safety|blocked=.*grep -E/.test(line))
    .join("\n");
  const blockedPatterns = [
    /npm run assign-id\b/,
    /npm run ci:writeback\b/,
    /npm run writeback:routed\b/,
    /preview-publish/,
    /PUBLISHER_DEPLOY_TOKEN/,
    /PUBLISHER_STATE_TOKEN/,
    /PATCH https:\/\/api\.notion\.com/,
    /POST https:\/\/api\.notion\.com/
  ];
  for (const pattern of blockedPatterns) {
    assert.doesNotMatch(operationalWorkflow, pattern, `blocked pattern reintroduced: ${pattern}`);
  }
});

test("no temporary one-time hotfix workflow remains in the workflows directory", async () => {
  const workflowsDir = path.resolve(process.cwd(), ".github/workflows");
  const files = await fs.readdir(workflowsDir);
  const suspicious = files.filter((file) => /one-time|onetime|temp-hotfix|hotfix-patch/i.test(file));
  assert.deepEqual(suspicious, []);
});
