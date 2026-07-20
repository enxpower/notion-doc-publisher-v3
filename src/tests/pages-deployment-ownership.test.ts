import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const WORKFLOWS_DIR = path.resolve(process.cwd(), ".github/workflows");
const PRODUCTION_PAGES_OWNER = "incremental-content-publish.yml";

test("only Incremental Content Publish automatically deploys the ARCBOS production Pages artifact", async () => {
  const files = (await fs.readdir(WORKFLOWS_DIR)).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
  assert.ok(files.includes(PRODUCTION_PAGES_OWNER), "the designated production Pages owner workflow must exist");

  const deployers: Array<{ file: string; triggers: string[] }> = [];

  for (const file of files) {
    const src = await fs.readFile(path.join(WORKFLOWS_DIR, file), "utf8");
    const usesPagesDeploy = /uses:\s*actions\/(configure-pages|upload-pages-artifact|deploy-pages)@/.test(src);
    if (!usesPagesDeploy) {
      continue;
    }
    deployers.push({ file, triggers: topLevelTriggers(src) });
  }

  assert.ok(deployers.length > 0, "expected to find at least the production Pages owner");

  for (const deployer of deployers) {
    if (deployer.file === PRODUCTION_PAGES_OWNER) {
      // The single owner is allowed to be automatic (workflow_dispatch, the
      // Issue #44 owner command, and the single daily schedule).
      continue;
    }
    assert.deepEqual(
      deployer.triggers,
      ["workflow_dispatch"],
      `${deployer.file} references a Pages deploy action but is not the designated production owner (${PRODUCTION_PAGES_OWNER}); ` +
        `it must be manual-only (workflow_dispatch) so it can never automatically compete for the production Pages artifact. ` +
        `Found triggers: ${deployer.triggers.join(", ") || "(none)"}`
    );
  }
});

test("preview-publish.yml is not among the Pages deployers", async () => {
  const src = await fs.readFile(path.join(WORKFLOWS_DIR, "preview-publish.yml"), "utf8");
  assert.ok(!/uses:\s*actions\/(configure-pages|upload-pages-artifact|deploy-pages)@/.test(src));
});

function topLevelTriggers(workflowSource: string): string[] {
  const onBlockMatch = workflowSource.match(/^on:\n([\s\S]*?)(?=^\S)/m);
  const onBlock = onBlockMatch ? onBlockMatch[1]! : "";
  const triggers: string[] = [];
  for (const line of onBlock.split("\n")) {
    const match = line.match(/^ {2}([A-Za-z_]+):/);
    if (match) {
      triggers.push(match[1]!);
    }
  }
  return triggers;
}
