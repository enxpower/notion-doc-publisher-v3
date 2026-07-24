/**
 * Phase 3 Prompt 7 (final audit): regression tests for the two corrections
 * made during the cumulative Phase 3 audit — the ARCBOS Pages-deploying
 * workflow concurrency-group mismatch, and the pdf-publisher.yml
 * arbitrary-branch + live-Notion-writeback combination. Static workflow
 * parsing only; no workflow is executed and no real Notion access occurs.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const WORKFLOWS_DIR = path.resolve(process.cwd(), ".github/workflows");

async function readWorkflow(name: string): Promise<string> {
  return fs.readFile(path.join(WORKFLOWS_DIR, name), "utf8");
}

function concurrencyGroup(workflow: string): string | undefined {
  const match = workflow.match(/concurrency:\n(?:\s*#.*\n)*\s*group:\s*(\S+)\n/);
  return match?.[1];
}

test("arcbos-pages-clean-deploy.yml shares the same concurrency group as the automatic production publisher, so the two can never run concurrently", async () => {
  const production = await readWorkflow("incremental-content-publish.yml");
  const disasterRecovery = await readWorkflow("arcbos-pages-clean-deploy.yml");
  const productionGroup = concurrencyGroup(production);
  const drGroup = concurrencyGroup(disasterRecovery);
  assert.ok(productionGroup, "production workflow must declare a concurrency group");
  assert.ok(drGroup, "disaster-recovery workflow must declare a concurrency group");
  assert.equal(drGroup, productionGroup, "both ARCBOS Pages-deploying workflows must share one concurrency group to prevent a deployment race");
  assert.doesNotMatch(disasterRecovery, /cancel-in-progress:\s*true/, "queued runs must wait, not cancel the in-progress deployment");
});

test("pdf-publisher.yml refuses live Notion writeback (writeback=true) on any branch other than main", async () => {
  const workflow = await readWorkflow("pdf-publisher.yml");
  const guardMatch = workflow.match(/- name: Enforce trusted ref for live Notion writeback\n\s*if: (.+)\n/);
  assert.ok(guardMatch, "the trusted-ref writeback guard step must exist");
  assert.match(guardMatch![1]!, /inputs\.writeback == true/);
  assert.match(guardMatch![1]!, /inputs\.branch != 'main'/);
  // The guard must run before Setup Node / npm ci / the actual PDF queue
  // step, so a disallowed combination fails fast without doing any work.
  const guardIndex = workflow.indexOf("name: Enforce trusted ref for live Notion writeback");
  const setupNodeIndex = workflow.indexOf("name: Setup Node");
  const pdfQueueIndex = workflow.indexOf("name: Run PDF queue");
  assert.ok(guardIndex > -1 && setupNodeIndex > -1 && pdfQueueIndex > -1);
  assert.ok(guardIndex < setupNodeIndex, "the guard must run before Setup Node");
  assert.ok(guardIndex < pdfQueueIndex, "the guard must run before the writeback-capable step");
});

test("pdf-publisher.yml's read-only (writeback=false, the default) behavior on a non-main branch remains unaffected by the guard", async () => {
  const workflow = await readWorkflow("pdf-publisher.yml");
  // The guard's `if:` requires BOTH writeback == true AND branch != 'main' —
  // confirming a plain read-only dispatch on any branch is never blocked.
  const guardMatch = workflow.match(/if: \$\{\{ (.+) \}\}\n\s*run: \|\n\s*echo "Live Notion writeback/);
  assert.ok(guardMatch);
  assert.match(guardMatch![1]!, /&&/, "guard must require both conditions (AND), never gate on branch alone");
});

test("exactly one production schedule and one automatic production publisher remain after the final audit's corrections", async () => {
  const files = (await fs.readdir(WORKFLOWS_DIR)).filter((f) => /\.ya?ml$/i.test(f));
  assert.equal(files.length, 9, "no workflow file was added or removed during the final audit");
  let scheduled = 0;
  for (const file of files) {
    const source = (await fs.readFile(path.join(WORKFLOWS_DIR, file), "utf8"))
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    if (/^\s{2}schedule:\s*$/m.test(source)) scheduled += 1;
  }
  assert.equal(scheduled, 1);
});

test("no DEPLOY_KEY_ARCBOS exists anywhere and no QA/export workflow gained a deploy key or Pages permission from this audit's corrections", async () => {
  for (const file of ["pdf-export.yml", "pdf-publisher.yml", "docx-pdf-export-qa.yml", "typst-pdf-export-qa.yml"]) {
    const workflow = await readWorkflow(file);
    assert.doesNotMatch(workflow, /DEPLOY_KEY_/, file);
    assert.doesNotMatch(workflow, /pages:\s*write/, file);
    assert.doesNotMatch(workflow, /id-token:\s*write/, file);
  }
  for (const file of (await fs.readdir(WORKFLOWS_DIR)).filter((f) => /\.ya?ml$/i.test(f))) {
    const workflow = await readWorkflow(file);
    assert.doesNotMatch(workflow, /DEPLOY_KEY_ARCBOS/, file);
  }
});
