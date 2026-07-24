import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/incremental-content-publish.yml");
const WORKFLOWS_DIR = path.resolve(process.cwd(), ".github/workflows");

async function workflowFiles(): Promise<string[]> {
  return (await fs.readdir(WORKFLOWS_DIR))
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort();
}

function executableLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

test("incremental-content-publish workflow delegates ARCBOS artifact sanitation to the repository script", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  assert.match(workflow, /run: bash scripts\/prepare-arcbos-pages-artifact\.sh targets\/arcbos-pages/);
  assert.doesNotMatch(workflow, /iname\s+'\*audit\*(?!')/, "the fragile inline sanitation block must not be reintroduced");
});

test("incremental-content-publish workflow still deploys ARCBOS through the official Pages actions", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  // Phase 3 Prompt 5 pins these to immutable commit SHAs with a version
  // comment (see src/tests/supply-chain-hardening.test.ts for the full pin
  // registry); this test only confirms the official actions are still used.
  assert.match(workflow, /uses: actions\/configure-pages@[0-9a-f]{40} # v\d/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@[0-9a-f]{40} # v\d/);
  assert.match(workflow, /uses: actions\/deploy-pages@[0-9a-f]{40} # v\d/);
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

test("Incremental Content Publish is the sole automatically scheduled production publisher", async () => {
  const scheduled: string[] = [];
  const indirectDispatchers: string[] = [];

  for (const file of await workflowFiles()) {
    const source = executableLines(await fs.readFile(path.join(WORKFLOWS_DIR, file), "utf8"));
    if (/^\s{2}schedule:\s*$/m.test(source)) {
      scheduled.push(file);
    }
    if (/gh\s+workflow\s+run\s+(?:\.github\/workflows\/)?incremental-content-publish\.ya?ml\b/.test(source)) {
      indirectDispatchers.push(file);
    }
  }

  assert.deepEqual(
    scheduled,
    ["incremental-content-publish.yml"],
    "exactly one workflow may contain an automatic schedule"
  );
  assert.deepEqual(
    indirectDispatchers,
    [],
    "no secondary workflow may dispatch the production publisher"
  );
});

test("Preview Publish is read-only and cannot mutate production Notion state", async () => {
  const workflow = executableLines(
    await fs.readFile(path.join(WORKFLOWS_DIR, "preview-publish.yml"), "utf8")
  );

  assert.match(workflow, /run: npm run build:readonly-validation/);
  assert.doesNotMatch(workflow, /run: npm run assign-id\b/);
  assert.doesNotMatch(workflow, /run: npm run ci:writeback\b/);
  assert.doesNotMatch(workflow, /run: npm run writeback:/);
  assert.doesNotMatch(workflow, /actions\/(?:configure-pages|upload-pages-artifact|deploy-pages)@/);
});

test("no temporary one-time hotfix workflow remains in the workflows directory", async () => {
  const files = await workflowFiles();
  const suspicious = files.filter((file) => /one-time|onetime|once|temp|hotfix|dispatch-production/i.test(file));
  assert.deepEqual(suspicious, []);
});
