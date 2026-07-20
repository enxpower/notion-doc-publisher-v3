import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/prepare-arcbos-pages-artifact.sh");

test("prepare-arcbos-pages-artifact.sh has valid shell syntax", () => {
  execFileSync("bash", ["-n", SCRIPT_PATH]);
});

test("prepare-arcbos-pages-artifact.sh fails when the artifact root does not exist", () => {
  assert.throws(() => {
    execFileSync("bash", [SCRIPT_PATH, "/nonexistent/artifact/root"], { stdio: "pipe" });
  });
});

test("prepare-arcbos-pages-artifact.sh removes blocked files, keeps safe files, and writes required output", async () => {
  const root = await makeValidFixture();
  await fs.mkdir(path.join(root, "reports"), { recursive: true });
  await fs.mkdir(path.join(root, "diagnostics"), { recursive: true });
  await fs.writeFile(path.join(root, "notes.typ"), "typst source\n", "utf8");
  await fs.writeFile(path.join(root, ".env"), "SECRET=1\n", "utf8");
  await fs.writeFile(path.join(root, ".env.production"), "SECRET=1\n", "utf8");
  await fs.writeFile(path.join(root, "release-backup.zip"), "binary\n", "utf8");
  await fs.writeFile(path.join(root, "q3-audit.pdf"), "binary\n", "utf8");
  await fs.writeFile(path.join(root, "build-diagnostic.log"), "log\n", "utf8");
  await fs.writeFile(path.join(root, "reports", "internal.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, "diagnostics", "trace.json"), "{}\n", "utf8");

  const output = execFileSync("bash", [SCRIPT_PATH, root], { encoding: "utf8" });

  assert.match(output, /ARCBOS Pages artifact prepared and verified/);
  await assertMissing(path.join(root, "notes.typ"));
  await assertMissing(path.join(root, ".env"));
  await assertMissing(path.join(root, ".env.production"));
  await assertMissing(path.join(root, "release-backup.zip"));
  await assertMissing(path.join(root, "q3-audit.pdf"));
  await assertMissing(path.join(root, "build-diagnostic.log"));
  await assertMissing(path.join(root, "reports", "internal.json"));
  await assertMissing(path.join(root, "diagnostics", "trace.json"));

  await assertExists(path.join(root, "docs", "ARCBOS-SPEC-2606-0001", "index.html"));
  await assertExists(path.join(root, "assets", "arcbos-favicon.svg"));

  assert.equal(await fs.readFile(path.join(root, "CNAME"), "utf8"), "docs.arcbos.com\n");
  await assertExists(path.join(root, ".nojekyll"));
});

test("prepare-arcbos-pages-artifact.sh fails closed when credential-shaped content is present", async () => {
  const root = await makeValidFixture();
  await fs.writeFile(path.join(root, "docs", "leak.html"), `${safeHtml()}\n<!-- ghp_${"a".repeat(36)} -->`, "utf8");

  assert.throws(() => {
    execFileSync("bash", [SCRIPT_PATH, root], { stdio: "pipe" });
  });
});

test("prepare-arcbos-pages-artifact.sh fails closed when a document page omits the favicon reference", async () => {
  const root = await makeValidFixture();
  await fs.mkdir(path.join(root, "docs", "ARCBOS-SPEC-2606-0002"), { recursive: true });
  await fs.writeFile(
    path.join(root, "docs", "ARCBOS-SPEC-2606-0002", "index.html"),
    "<html><head><title>No favicon</title></head><body>content</body></html>\n",
    "utf8"
  );

  assert.throws(() => {
    execFileSync("bash", [SCRIPT_PATH, root], { stdio: "pipe" });
  });
});

test("prepare-arcbos-pages-artifact.sh does not require a favicon reference on brand-agnostic portal pages", async () => {
  const root = await makeValidFixture();
  await fs.mkdir(path.join(root, "register"), { recursive: true });
  await fs.mkdir(path.join(root, "clients"), { recursive: true });
  await fs.writeFile(path.join(root, "index.html"), "<html><head><title>Document Register</title></head><body>portal</body></html>\n", "utf8");
  await fs.writeFile(path.join(root, "register", "index.html"), "<html><head><title>Document Register</title></head><body>portal</body></html>\n", "utf8");
  await fs.writeFile(path.join(root, "clients", "index.html"), "<html><head><title>No Public Index</title></head><body>portal</body></html>\n", "utf8");

  const output = execFileSync("bash", [SCRIPT_PATH, root], { encoding: "utf8" });
  assert.match(output, /ARCBOS Pages artifact prepared and verified/);
});

function safeHtml(): string {
  return '<html><head><title>ARCBOS Spec</title><link rel="icon" href="/assets/arcbos-favicon.svg"></head><body>content</body></html>\n';
}

async function makeValidFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "arcbos-pages-artifact-test-"));
  await fs.mkdir(path.join(root, "docs", "ARCBOS-SPEC-2606-0001"), { recursive: true });
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  await fs.writeFile(path.join(root, "docs", "ARCBOS-SPEC-2606-0001", "index.html"), safeHtml(), "utf8");
  await fs.writeFile(path.join(root, "assets", "arcbos-favicon.svg"), "<svg></svg>\n", "utf8");
  return root;
}

async function assertExists(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  assert.equal(stat.isFile(), true);
}

async function assertMissing(filePath: string): Promise<void> {
  await assert.rejects(fs.stat(filePath), /ENOENT/);
}
