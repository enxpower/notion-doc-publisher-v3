/**
 * Phase 3 Prompt 5: supply-chain and secret/trust-boundary hardening.
 *
 * Static workflow-file parsing and local assertions only. No GitHub Actions
 * workflow is executed, no real credential is used, and no network access
 * occurs from these tests.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const WORKFLOWS_DIR = path.resolve(process.cwd(), ".github/workflows");

// The approved, evidence-verified immutable-SHA registry for every external
// GitHub Action referenced anywhere in this repository's workflows. Each SHA
// was resolved from the action's own upstream repository (see PR description /
// docs/SYSTEM_ARCHITECTURE.md for the resolution method) — never invented.
const APPROVED_ACTIONS: Record<string, { sha: string; version: string }> = {
  "actions/checkout": { sha: "11d5960a326750d5838078e36cf38b85af677262", version: "v4.4.0" },
  "actions/setup-node": { sha: "49933ea5288caeca8642d1e84afbd3f7d6820020", version: "v4.4.0" },
  "actions/upload-artifact": { sha: "ea165f8d65b6e75b540449e92b4886f43607fa02", version: "v4.6.2" },
  "actions/download-artifact": { sha: "d3f86a106a0bac45b974a628896c90dbdf5c8093", version: "v4.3.0" },
  "actions/upload-pages-artifact": { sha: "56afc609e74202658d3ffba0e8f6dda462b719fa", version: "v3.0.1" },
  "actions/configure-pages": { sha: "983d7736d9b0ae728b81ab479565c72886d7745b", version: "v5.0.0" },
  "actions/deploy-pages": { sha: "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", version: "v4.0.5" },
  "typst-community/setup-typst": { sha: "48aeee7543d37f01afd1ffb27307dc277387ba13", version: "v4.3.1" }
};

const TYPST_EXPECTED_SHA256 = "7d214bfeffc2e585dc422d1a09d2b144969421281e8c7f5d784b65fc69b5673f";

type ParsedUse = { file: string; line: number; raw: string; ownerRepo: string; ref: string; comment: string | null };

async function workflowFiles(): Promise<string[]> {
  return (await fs.readdir(WORKFLOWS_DIR)).filter((f) => /\.ya?ml$/i.test(f)).sort();
}

async function readWorkflow(name: string): Promise<string> {
  return fs.readFile(path.join(WORKFLOWS_DIR, name), "utf8");
}

async function allExternalUses(): Promise<ParsedUse[]> {
  const results: ParsedUse[] = [];
  for (const file of await workflowFiles()) {
    const source = await readWorkflow(file);
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s*#\s*(.*))?$/);
      if (!match) return;
      const target = match[1]!;
      if (target.startsWith("./") || target.startsWith(".\\")) {
        return; // local composite actions are not external supply-chain dependencies
      }
      const [ownerRepo, ref] = target.split("@");
      results.push({
        file,
        line: index + 1,
        raw: line.trim(),
        ownerRepo: ownerRepo!,
        ref: ref ?? "",
        comment: match[2]?.trim() || null
      });
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Part B: immutable action pinning
// ---------------------------------------------------------------------------

test("every external GitHub Action is pinned to a full 40-character hexadecimal commit SHA", async () => {
  const uses = await allExternalUses();
  assert.ok(uses.length > 0, "expected at least one external action reference");
  for (const use of uses) {
    assert.match(use.ref, /^[0-9a-f]{40}$/, `${use.file}:${use.line} — ${use.raw}`);
  }
});

test("every pinned external action has a human-readable version comment", async () => {
  const uses = await allExternalUses();
  for (const use of uses) {
    assert.ok(use.comment && use.comment.length > 0, `${use.file}:${use.line} missing version comment — ${use.raw}`);
    assert.match(use.comment!, /^v\d/i, `${use.file}:${use.line} version comment should start with a version like v4.4.0 — ${use.raw}`);
  }
});

test("no mutable action reference (@v1-@v9, @main, @master) remains anywhere in the workflows directory", async () => {
  for (const file of await workflowFiles()) {
    const source = await readWorkflow(file);
    assert.doesNotMatch(source, /uses:\s*(?:actions|typst-community)\/[\w.-]+@v\d+(?:\s|$)/m, file);
    assert.doesNotMatch(source, /uses:\s*[\w.-]+\/[\w.-]+@(?:main|master)\b/m, file);
  }
});

test("every pinned action's owner/repository and SHA match the approved, evidence-verified inventory", async () => {
  const uses = await allExternalUses();
  for (const use of uses) {
    const approved = APPROVED_ACTIONS[use.ownerRepo];
    assert.ok(approved, `${use.file}:${use.line} references an action not in the approved inventory: ${use.ownerRepo}`);
    assert.equal(use.ref, approved.sha, `${use.file}:${use.line} SHA does not match the approved inventory for ${use.ownerRepo}`);
    assert.equal(use.comment, `${approved.version}`, `${use.file}:${use.line} version comment does not match the approved inventory for ${use.ownerRepo}`);
  }
});

test("no unknown external action owner is introduced beyond actions/* and typst-community/*", async () => {
  const uses = await allExternalUses();
  for (const use of uses) {
    const owner = use.ownerRepo.split("/")[0];
    assert.ok(owner === "actions" || owner === "typst-community", `${use.file}:${use.line} unknown action owner: ${owner}`);
  }
});

// ---------------------------------------------------------------------------
// Part C: Typst binary checksum verification
// ---------------------------------------------------------------------------

test("the production Typst tarball download is SHA-256 verified before extraction, and the checksum is non-empty, correctly formatted, and tied to the pinned version/platform", async () => {
  const workflow = await readWorkflow("incremental-content-publish.yml");
  const versionMatch = workflow.match(/TYPST_VERSION:\s*"([^"]+)"/);
  const shaMatch = workflow.match(/TYPST_SHA256_LINUX_X86_64:\s*"([0-9a-f]{64})"/);
  assert.ok(versionMatch, "TYPST_VERSION must be declared");
  assert.equal(versionMatch![1], "0.13.1");
  assert.ok(shaMatch, "TYPST_SHA256_LINUX_X86_64 must be declared as a 64-character hex string");
  assert.equal(shaMatch![1], TYPST_EXPECTED_SHA256);
  assert.match(workflow, /typst-x86_64-unknown-linux-musl\.tar\.xz/, "checksum must be tied to the exact linux x86_64 asset name actually downloaded");

  const verifyIndex = workflow.indexOf("sha256sum --check --strict");
  const extractIndex = workflow.indexOf("tar -xJf");
  assert.ok(verifyIndex > -1, "sha256sum verification step must exist");
  assert.ok(extractIndex > -1, "tar extraction step must exist");
  assert.ok(verifyIndex < extractIndex, "checksum verification must occur before extraction");
});

test("a Typst checksum mismatch fails closed and does not silently fall through to the cargo fallback", async () => {
  const workflow = await readWorkflow("incremental-content-publish.yml");
  const verifyBlockMatch = workflow.match(
    /if !\s*sha256sum --check --strict[^\n]*\n\s*echo[^\n]*>&2\n\s*exit 1\n\s*fi/
  );
  assert.ok(verifyBlockMatch, "checksum mismatch must be followed by an explicit exit 1 inside the same conditional");

  const verifyIndex = workflow.indexOf("sha256sum --check --strict");
  const elseIndex = workflow.indexOf("\n          else\n            echo \"Direct Typst download failed. Falling back to crates.io.\"");
  assert.ok(elseIndex > -1, "cargo fallback else-branch must exist");
  assert.ok(verifyIndex < elseIndex, "checksum verification must be inside the curl-succeeded branch, before the unrelated else/cargo-fallback branch");
});

test("the cargo fallback, if reached, remains version-pinned and uses --locked", async () => {
  const workflow = await readWorkflow("incremental-content-publish.yml");
  assert.match(workflow, /cargo install\s+--locked\s+--version "\$TYPST_VERSION"/);
});

test("no unchecked Typst release binary download path remains in the production workflow", async () => {
  const workflow = await readWorkflow("incremental-content-publish.yml");
  // Every curl invocation that downloads a typst release archive must be
  // followed (later in the same step) by a sha256sum verification before use.
  assert.match(workflow, /archive_url="https:\/\/github\.com\/typst\/typst\/releases\/download/);
  const stepStart = workflow.indexOf("name: Install pinned Typst for render work");
  const stepEnd = workflow.indexOf("name: Install CJK and Latin fonts for render work");
  const step = workflow.slice(stepStart, stepEnd);
  assert.match(step, /sha256sum --check --strict/, "the Typst install step must verify the download before use");
});

// ---------------------------------------------------------------------------
// Part D: secret and trust-boundary registry
// ---------------------------------------------------------------------------

test("the PR/push-triggered CI workflow (phase2-ci.yml) has no production secrets at all", async () => {
  const workflow = await readWorkflow("phase2-ci.yml");
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /^\s*pull_request:/m);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
});

test("Preview Publish has no deploy key and no executable Notion writeback", async () => {
  const workflow = await readWorkflow("preview-publish.yml");
  assert.doesNotMatch(workflow, /DEPLOY_KEY_/);
  assert.doesNotMatch(workflow, /^\s*run:\s*npm run (?:ci:writeback|writeback:)/m);
  assert.doesNotMatch(workflow, /actions\/(?:configure-pages|upload-pages-artifact|deploy-pages)@/);
});

test("only the automatic production publisher references brand deploy keys; every other workflow does not", async () => {
  for (const file of await workflowFiles()) {
    const workflow = await readWorkflow(file);
    const hasDeployKey = /DEPLOY_KEY_(?:ENERGIZE|AGIM|GONG|STATE)/.test(workflow);
    if (file === "incremental-content-publish.yml") {
      assert.ok(hasDeployKey, `${file} is expected to reference brand deploy keys`);
    } else {
      assert.ok(!hasDeployKey, `${file} must not reference any brand deploy key`);
    }
  }
});

test("DEPLOY_KEY_ARCBOS does not exist anywhere in the repository's workflows", async () => {
  for (const file of await workflowFiles()) {
    const workflow = await readWorkflow(file);
    assert.doesNotMatch(workflow, /DEPLOY_KEY_ARCBOS/, file);
  }
});

test("no deploy-key-bearing checkout step in the production workflow uses a user- or event-controlled ref", async () => {
  const workflow = await readWorkflow("incremental-content-publish.yml");
  const deployKeySteps = workflow.match(/- name: Checkout \w+ target\n(?:.*\n){0,10}?\s*ssh-key: \$\{\{ secrets\.DEPLOY_KEY_\w+ \}\}/g) ?? [];
  assert.ok(deployKeySteps.length >= 3, "expected at least three deploy-key checkout steps (ENERGIZE, AGIM, GONG)");
  for (const step of deployKeySteps) {
    assert.doesNotMatch(step, /ref:\s*\$\{\{\s*(?:inputs\.|github\.event\.)/, step);
  }
  // The state checkout (also deploy-key-bearing) must likewise never take an event-controlled ref.
  const stateStepMatch = workflow.match(/- name: Checkout private state\n(?:.*\n){0,10}?\s*ssh-key: \$\{\{ secrets\.DEPLOY_KEY_STATE \}\}/);
  assert.ok(stateStepMatch);
  assert.doesNotMatch(stateStepMatch![0], /ref:\s*\$\{\{\s*(?:inputs\.|github\.event\.)/);
});

test("no issue-comment content is interpolated directly into a shell command; it is only read through a quoted environment variable", async () => {
  const workflow = await readWorkflow("incremental-content-publish.yml");
  const runBlocks = workflow.split(/\n\s*run:\s*\|/).slice(1);
  for (const block of runBlocks) {
    assert.doesNotMatch(block, /\$\{\{\s*github\.event\.comment\.body/, "github.event.comment.body must never be interpolated directly inside a run: script body");
  }
  assert.match(workflow, /COMMENT_BODY:\s*\$\{\{\s*github\.event\.comment\.body\s*\}\}/, "comment body must be captured through a named env var");
  assert.match(workflow, /printf '%s' "\$COMMENT_BODY"/, "comment body must be referenced only via a quoted shell variable");
});

test("workflow permissions do not exceed the documented minimal registry for each workflow", async () => {
  const expected: Record<string, string[]> = {
    "incremental-content-publish.yml": ["contents: read", "issues: write", "pages: write", "id-token: write"],
    "preview-publish.yml": ["contents: read"],
    "incremental-content-plan.yml": ["contents: read"],
    "phase2-ci.yml": ["contents: read"],
    "pdf-export.yml": ["contents: read"],
    "pdf-publisher.yml": ["contents: read"],
    "docx-pdf-export-qa.yml": ["contents: read"],
    "typst-pdf-export-qa.yml": ["contents: read"],
    "arcbos-pages-clean-deploy.yml": ["actions: read", "contents: read", "pages: write", "id-token: write"]
  };
  for (const [file, allowedLines] of Object.entries(expected)) {
    const workflow = await readWorkflow(file);
    const block = workflow.match(/permissions:\n((?:\s{2}\S.*\n)+)/);
    assert.ok(block, `${file} must declare a permissions block`);
    const actualLines = block![1]!
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    assert.deepEqual(actualLines.sort(), [...allowedLines].sort(), file);
  }
});

test("exactly one workflow references issues: write, and it is the sole automatic production publisher", async () => {
  const withIssuesWrite: string[] = [];
  for (const file of await workflowFiles()) {
    const workflow = await readWorkflow(file);
    if (/^\s*issues:\s*write\s*$/m.test(workflow)) {
      withIssuesWrite.push(file);
    }
  }
  assert.deepEqual(withIssuesWrite, ["incremental-content-publish.yml"]);
});

// ---------------------------------------------------------------------------
// Part E: QA/export Notion token reduction
// ---------------------------------------------------------------------------

function jobEnvBlock(workflow: string): string {
  const match = workflow.match(/\n {4}env:\n((?:\s{6}\S.*\n)+)/);
  return match ? match[1]! : "";
}

test("QA/export workflows no longer expose NOTION_TOKEN at job level; it is scoped only to the specific step(s) that read Notion", async () => {
  const qaFiles = ["pdf-export.yml", "pdf-publisher.yml", "docx-pdf-export-qa.yml", "typst-pdf-export-qa.yml"];
  for (const file of qaFiles) {
    const workflow = await readWorkflow(file);
    const envBlock = jobEnvBlock(workflow);
    assert.doesNotMatch(envBlock, /NOTION_TOKEN:/, `${file} must not expose NOTION_TOKEN at job level`);
    assert.match(workflow, /NOTION_TOKEN:\s*\$\{\{\s*secrets\.NOTION_TOKEN\s*\}\}/, `${file} must still provide NOTION_TOKEN to the step(s) that need it`);
  }
});

test("dispatcher-supplied branches cannot execute arbitrary code with a production-capable deploy key: QA/export workflows have no deploy key at all", async () => {
  const qaFiles = ["pdf-export.yml", "pdf-publisher.yml", "docx-pdf-export-qa.yml", "typst-pdf-export-qa.yml"];
  for (const file of qaFiles) {
    const workflow = await readWorkflow(file);
    assert.doesNotMatch(workflow, /DEPLOY_KEY_/, file);
    assert.doesNotMatch(workflow, /pages:\s*write/, file);
    assert.doesNotMatch(workflow, /id-token:\s*write/, file);
  }
});

test("QA/export checkout steps only ever check out a dispatcher-supplied branch, never an issue-comment-controlled ref", async () => {
  const qaFiles = ["pdf-export.yml", "pdf-publisher.yml", "docx-pdf-export-qa.yml", "typst-pdf-export-qa.yml"];
  for (const file of qaFiles) {
    const workflow = await readWorkflow(file);
    assert.doesNotMatch(workflow, /issue_comment/, file);
    assert.match(workflow, /ref:\s*\$\{\{\s*(?:inputs\.branch|github\.event\.inputs\.branch)\s*\}\}/, file);
  }
});

// ---------------------------------------------------------------------------
// Part F: permissions minimization guardrails
// ---------------------------------------------------------------------------

test("no workflow grants contents: write anywhere", async () => {
  for (const file of await workflowFiles()) {
    const workflow = await readWorkflow(file);
    assert.doesNotMatch(workflow, /contents:\s*write/, file);
  }
});

test("fork pull requests cannot receive production credentials: the only pull_request-triggered workflow has zero secrets", async () => {
  const workflow = await readWorkflow("phase2-ci.yml");
  assert.doesNotMatch(workflow, /secrets\./);
});

// ---------------------------------------------------------------------------
// Part G: npm/package supply chain
// ---------------------------------------------------------------------------

test("package-lock.json is tracked and every workflow uses npm ci, never npm install, for repository dependencies", async () => {
  const lockExists = await fs.stat(path.resolve(process.cwd(), "package-lock.json")).then(() => true).catch(() => false);
  assert.ok(lockExists, "package-lock.json must exist");
  for (const file of await workflowFiles()) {
    const workflow = await readWorkflow(file);
    if (/run:\s*npm (?:ci|test|run)/.test(workflow)) {
      assert.doesNotMatch(workflow, /run:\s*npm install\b/, file);
    }
  }
});

test("no workflow executes an unpinned npx package", async () => {
  for (const file of await workflowFiles()) {
    const workflow = await readWorkflow(file);
    assert.doesNotMatch(workflow, /\bnpx\b/, file);
  }
});

test("no workflow or script pipes a curl or wget download directly into a shell interpreter", async () => {
  const targets = [WORKFLOWS_DIR, path.resolve(process.cwd(), "scripts")];
  for (const dir of targets) {
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      const filePath = path.join(dir, entry);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const source = await fs.readFile(filePath, "utf8");
      assert.doesNotMatch(source, /curl[^\n]*\|\s*(?:sh|bash)\b/, filePath);
      assert.doesNotMatch(source, /wget[^\n]*\|\s*(?:sh|bash)\b/, filePath);
    }
  }
});

// ---------------------------------------------------------------------------
// Production topology unchanged (regression guard for this prompt's own edits)
// ---------------------------------------------------------------------------

test("exactly one production schedule and one automatic production publisher remain after supply-chain hardening", async () => {
  let scheduled = 0;
  const deployCapable: string[] = [];
  for (const file of await workflowFiles()) {
    const source = (await readWorkflow(file)).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    if (/^\s{2}schedule:\s*$/m.test(source)) scheduled += 1;
    if (/actions\/(?:deploy-pages|upload-pages-artifact)@/.test(source)) deployCapable.push(file);
  }
  assert.equal(scheduled, 1);
  assert.deepEqual(deployCapable.sort(), ["arcbos-pages-clean-deploy.yml", "incremental-content-publish.yml"]);
});

test("no second Notion lifecycle writer workflow was introduced", async () => {
  const withWriteback: string[] = [];
  for (const file of await workflowFiles()) {
    const workflow = await readWorkflow(file);
    if (/run:\s*npm run writeback:incremental\b/.test(workflow)) {
      withWriteback.push(file);
    }
  }
  assert.deepEqual(withWriteback, ["incremental-content-publish.yml"]);
});

test("no new workflow file was introduced by this prompt", async () => {
  const files = await workflowFiles();
  assert.equal(files.length, 9);
});
