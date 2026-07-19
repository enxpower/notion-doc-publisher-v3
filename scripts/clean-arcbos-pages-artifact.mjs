#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const EXPECTED = {
  owner: "enxpower",
  repo: "notion-doc-publisher-v3",
  runId: "29675281140",
  artifactId: "8438733239",
  deploymentId: "5508223608",
  sourceSha: "766cf3f92e159112d39e08c3534ba13f21f08d4c",
  artifactName: "github-pages",
  environment: "github-pages",
  arcbosHtml: 9,
  arcbosPdf: 9,
  staleBrandHtml: 2,
  staleBrandPdf: 2,
  typFiles: 11
};

const WORKFLOW_PATH = ".github/workflows/arcbos-pages-clean-deploy.yml";
const SAFE_METADATA_FILES = new Set(["robots.txt", "CNAME", ".nojekyll", "404.html"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"]);
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".txt", ".xml", ".svg"]);
const RUNTIME_REFERENCE_EXTENSIONS = new Set([".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".pdf"]);
const CREDENTIAL_PATTERN = /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|secret_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|ntn_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/i;
const LOCAL_PATH_PATTERN = /(?:\/Users\/|\/home\/runner\/|\/private\/var\/|file:\/\/)/i;

async function main() {
  const command = process.argv[2];
  if (command === "verify-source") {
    verifySource();
    return;
  }
  if (command === "clean") {
    await cleanArtifact(requiredArg(3, "source artifact directory"), requiredArg(4, "output directory"));
    return;
  }
  if (command === "validate-workflow") {
    await validateWorkflow();
    return;
  }
  throw new Error("Usage: clean-arcbos-pages-artifact.mjs <verify-source|clean|validate-workflow> [source-dir output-dir]");
}

function requiredArg(index, label) {
  const value = process.argv[index];
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function verifySource() {
  const run = ghApi(`repos/${EXPECTED.owner}/${EXPECTED.repo}/actions/runs/${EXPECTED.runId}`);
  if (String(run.id) !== EXPECTED.runId || run.head_sha !== EXPECTED.sourceSha || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("Source workflow run does not match the verified active Pages run.");
  }

  const artifacts = ghApi(`repos/${EXPECTED.owner}/${EXPECTED.repo}/actions/runs/${EXPECTED.runId}/artifacts`);
  const artifact = artifacts.artifacts?.find((item) => String(item.id) === EXPECTED.artifactId);
  if (!artifact || artifact.name !== EXPECTED.artifactName || artifact.expired === true) {
    throw new Error("Source Pages artifact does not match the verified active artifact.");
  }
  if (artifact.workflow_run?.head_sha !== EXPECTED.sourceSha || String(artifact.workflow_run?.id) !== EXPECTED.runId) {
    throw new Error("Source Pages artifact is not tied to the verified source run.");
  }

  const deployment = ghApi(`repos/${EXPECTED.owner}/${EXPECTED.repo}/deployments/${EXPECTED.deploymentId}`);
  if (String(deployment.id) !== EXPECTED.deploymentId || deployment.sha !== EXPECTED.sourceSha || deployment.environment !== EXPECTED.environment) {
    throw new Error("Source Pages deployment does not match the verified active deployment.");
  }
  const statuses = ghApi(`repos/${EXPECTED.owner}/${EXPECTED.repo}/deployments/${EXPECTED.deploymentId}/statuses?per_page=1`);
  if (!Array.isArray(statuses) || statuses[0]?.state !== "success") {
    throw new Error("Source Pages deployment is not the active successful deployment.");
  }

  console.log(JSON.stringify({
    sourceVerified: true,
    runId: EXPECTED.runId,
    artifactId: EXPECTED.artifactId,
    deploymentId: EXPECTED.deploymentId,
    sourceCommit: EXPECTED.sourceSha.slice(0, 12)
  }, null, 2));
}

function ghApi(endpoint) {
  const raw = execFileSync("gh", ["api", endpoint], {
    encoding: "utf8",
    maxBuffer: 20_000_000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(raw);
}

async function cleanArtifact(sourceDir, outputDir) {
  const sourceRoot = await prepareSourceRoot(sourceDir);
  const sourceFiles = await walk(sourceRoot);
  const htmlFiles = sourceFiles.filter((file) => file.endsWith(".html"));
  const pdfFiles = sourceFiles.filter((file) => file.endsWith(".pdf"));
  const typFiles = sourceFiles.filter((file) => file.endsWith(".typ"));

  const arcbosPages = [];
  const stalePages = [];
  for (const htmlFile of htmlFiles) {
    const html = await fs.readFile(path.join(sourceRoot, htmlFile), "utf8");
    const pdfRefs = localRefs(htmlFile, html).filter((ref) => ref.endsWith(".pdf"));
    const arcbosPdfRefs = pdfRefs.filter((ref) => /^pdf\/ARCBOS-[^/]+\.pdf$/.test(ref));
    const stalePdfRefs = pdfRefs.filter((ref) => /^pdf\/(?:ENERGIZE|AGIM|GONG)-[^/]+\.pdf$/.test(ref));
    if (arcbosPdfRefs.length === 1 && hasDocumentShell(html)) {
      arcbosPages.push({ htmlFile, html, pdfFile: arcbosPdfRefs[0] });
    } else if (stalePdfRefs.length > 0 && hasDocumentShell(html)) {
      stalePages.push({ htmlFile, html, pdfFiles: stalePdfRefs });
    }
  }

  const arcbosPdfSet = new Set(arcbosPages.map((page) => page.pdfFile));
  const stalePdfSet = new Set(stalePages.flatMap((page) => page.pdfFiles));
  const staleBrandPdfCount = pdfFiles.filter((file) => /^pdf\/(?:ENERGIZE|AGIM|GONG)-[^/]+\.pdf$/.test(file)).length;

  assertCount("legitimate ARCBOS HTML", arcbosPages.length, EXPECTED.arcbosHtml);
  assertCount("legitimate ARCBOS PDFs", arcbosPdfSet.size, EXPECTED.arcbosPdf);
  assertCount("stale non-ARCBOS HTML", stalePages.length, EXPECTED.staleBrandHtml);
  assertCount("stale non-ARCBOS PDFs", staleBrandPdfCount, EXPECTED.staleBrandPdf);
  assertCount(".typ intermediates", typFiles.length, EXPECTED.typFiles);
  assertTokenDerivedRoutes(arcbosPages);

  const keep = new Set();
  const requiredRefs = new Set();
  for (const page of arcbosPages) {
    keep.add(page.htmlFile);
    keep.add(page.pdfFile);
    for (const ref of localRefs(page.htmlFile, page.html)) {
      if (ref === page.htmlFile) {
        continue;
      }
      requiredRefs.add(ref);
    }
  }

  for (const ref of requiredRefs) {
    if (ref.endsWith(".pdf")) {
      if (!arcbosPdfSet.has(ref)) {
        throw new Error("Retained ARCBOS page references an unexpected PDF.");
      }
      continue;
    }
    if (ref === "assets/favicon.ico" && !sourceFiles.includes(ref)) {
      continue;
    }
    if (!sourceFiles.includes(ref)) {
      throw new Error("Retained ARCBOS page has a missing runtime dependency.");
    }
    keep.add(ref);
  }

  await retainCssDependencies(sourceRoot, keep, sourceFiles);
  for (const file of sourceFiles) {
    if (SAFE_METADATA_FILES.has(file)) {
      keep.add(file);
    }
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  for (const file of [...keep].sort()) {
    await copyFile(path.join(sourceRoot, file), path.join(outputDir, file));
  }

  const outputFiles = await walk(outputDir);
  const validation = await validateCleanArtifact({
    sourceRoot,
    outputDir,
    sourceFiles,
    outputFiles,
    arcbosPages,
    arcbosPdfSet,
    stalePages,
    stalePdfSet,
    typFiles
  });

  console.log(JSON.stringify(validation, null, 2));
}

async function prepareSourceRoot(sourceDir) {
  const resolved = path.resolve(sourceDir);
  const tarPath = path.join(resolved, "artifact.tar");
  if (!fssync.existsSync(tarPath)) {
    return resolved;
  }
  const extractRoot = path.join(resolved, "_extracted");
  await fs.rm(extractRoot, { recursive: true, force: true });
  await fs.mkdir(extractRoot, { recursive: true });
  execFileSync("tar", ["-xf", tarPath, "-C", extractRoot], { stdio: ["ignore", "ignore", "pipe"] });
  return extractRoot;
}

function hasDocumentShell(html) {
  return /document-(?:shell|page|content)/i.test(html) && /window\.print\(\)/.test(html);
}

function localRefs(htmlFile, html) {
  const refs = new Set();
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = normalizeRef(htmlFile, match[1]);
    if (ref) {
      refs.add(ref);
    }
  }
  for (const match of html.matchAll(/content="([^"]+)"/g)) {
    const value = match[1].trim();
    if (!/^https?:\/\/docs\.arcbos\.com\//i.test(value) && !value.startsWith("/")) {
      continue;
    }
    const ref = normalizeRef(htmlFile, value);
    if (ref && RUNTIME_REFERENCE_EXTENSIONS.has(path.extname(ref).toLowerCase())) {
      refs.add(ref);
    }
  }
  return [...refs].sort();
}

function normalizeRef(baseFile, value) {
  const trimmed = value.trim();
  if (!trimmed || /^(?:mailto:|tel:|#|javascript:)/i.test(trimmed)) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "docs.arcbos.com") {
      return null;
    }
    return cleanRelativePath(parsed.pathname);
  } catch {
    const withoutHash = trimmed.split("#")[0].split("?")[0];
    if (!withoutHash || withoutHash.startsWith("//")) {
      return null;
    }
    if (withoutHash.startsWith("/")) {
      return cleanRelativePath(withoutHash);
    }
    return cleanRelativePath(path.posix.join(path.posix.dirname(baseFile), withoutHash));
  }
}

function cleanRelativePath(value) {
  const normalized = path.posix.normalize(value.replace(/^\/+/, ""));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }
  return normalized;
}

async function retainCssDependencies(root, keep, sourceFiles) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of [...keep]) {
      if (!file.endsWith(".css")) {
        continue;
      }
      const css = await fs.readFile(path.join(root, file), "utf8");
      for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
        const raw = match[1].trim().replace(/^["']|["']$/g, "");
        const ref = normalizeRef(file, raw);
        if (!ref || keep.has(ref)) {
          continue;
        }
        if (!sourceFiles.includes(ref)) {
          throw new Error("Retained CSS references a missing runtime dependency.");
        }
        keep.add(ref);
        changed = true;
      }
    }
  }
}

function assertTokenDerivedRoutes(pages) {
  for (const page of pages) {
    const segments = page.htmlFile.split("/");
    if (segments.at(-1) !== "index.html" || segments.length !== 3) {
      throw new Error("A retained ARCBOS route is not a two-level token route.");
    }
    const namespace = segments[0];
    const token = segments[1];
    if (!["clients", "partners", "internal"].includes(namespace) || !/^[a-f0-9]{16}$/i.test(token)) {
      throw new Error("A retained ARCBOS route is not token-derived.");
    }
    const pdfBase = path.posix.basename(page.pdfFile, ".pdf");
    if (page.htmlFile.includes(pdfBase)) {
      throw new Error("A retained ARCBOS route exposes a DOC_ID-derived path.");
    }
  }
}

async function validateCleanArtifact(input) {
  const {
    sourceRoot,
    outputDir,
    sourceFiles,
    outputFiles,
    arcbosPages,
    arcbosPdfSet,
    stalePages,
    typFiles
  } = input;

  const outputSet = new Set(outputFiles);
  const arcbosHtmlAfter = arcbosPages.filter((page) => outputSet.has(page.htmlFile)).length;
  const arcbosPdfAfter = [...arcbosPdfSet].filter((file) => outputSet.has(file)).length;
  const staleHtmlAfter = stalePages.filter((page) => outputSet.has(page.htmlFile)).length;
  const stalePdfAfter = outputFiles.filter((file) => /^pdf\/(?:ENERGIZE|AGIM|GONG)-[^/]+\.pdf$/.test(file)).length;
  const typAfter = outputFiles.filter((file) => file.endsWith(".typ")).length;
  const reportAfter = outputFiles.filter((file) => /^reports\//.test(file)).length;
  const otherBrandAssets = outputFiles.filter((file) => /^assets\/(?:energize|agim|gong)/i.test(file)).length;

  assertCount("retained ARCBOS HTML", arcbosHtmlAfter, EXPECTED.arcbosHtml);
  assertCount("retained ARCBOS PDFs", arcbosPdfAfter, EXPECTED.arcbosPdf);
  assertCount("retained stale non-ARCBOS HTML", staleHtmlAfter, 0);
  assertCount("retained stale non-ARCBOS PDFs", stalePdfAfter, 0);
  assertCount("retained .typ files", typAfter, 0);
  assertCount("retained generated report files", reportAfter, 0);
  assertCount("retained other-brand assets", otherBrandAssets, 0);

  const htmlHashesChanged = [];
  const pdfHashesChanged = [];
  for (const page of arcbosPages) {
    if (await sha256(path.join(sourceRoot, page.htmlFile)) !== await sha256(path.join(outputDir, page.htmlFile))) {
      htmlHashesChanged.push(page.htmlFile);
    }
  }
  for (const pdf of arcbosPdfSet) {
    if (await sha256(path.join(sourceRoot, pdf)) !== await sha256(path.join(outputDir, pdf))) {
      pdfHashesChanged.push(pdf);
    }
  }
  if (htmlHashesChanged.length > 0 || pdfHashesChanged.length > 0) {
    throw new Error("A retained ARCBOS route or PDF changed during artifact cleanup.");
  }

  const outputTextFiles = outputFiles.filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()));
  let localPathLeaks = 0;
  let credentialMatches = 0;
  let nonArcbosBrandTextMatches = 0;
  for (const file of outputTextFiles) {
    const text = await fs.readFile(path.join(outputDir, file), "utf8");
    if (LOCAL_PATH_PATTERN.test(text)) localPathLeaks += 1;
    if (CREDENTIAL_PATTERN.test(text)) credentialMatches += 1;
    if (/(?:ENERGIZE|EnergizeOS|AGIM|GONG)/i.test(text)) nonArcbosBrandTextMatches += 1;
  }
  assertCount("local path leaks", localPathLeaks, 0);
  assertCount("credential-shaped matches", credentialMatches, 0);
  assertCount("non-ARCBOS brand text matches", nonArcbosBrandTextMatches, 0);

  const unreferencedAssets = await findUnreferencedAssets(outputDir, outputFiles, arcbosPages.map((page) => page.htmlFile));
  assertCount("unreferenced assets", unreferencedAssets.length, 0);

  return {
    cleanArtifactValid: true,
    activeArtifact: {
      legitimateArcbosHtml: arcbosPages.length,
      legitimateArcbosPdf: arcbosPdfSet.size,
      staleBrandHtml: stalePages.length,
      staleBrandPdf: [...input.stalePdfSet].length,
      typFiles: typFiles.length,
      totalFiles: sourceFiles.length
    },
    cleanArtifact: {
      legitimateArcbosHtml: arcbosHtmlAfter,
      legitimateArcbosPdf: arcbosPdfAfter,
      staleBrandHtml: staleHtmlAfter,
      staleBrandPdf: stalePdfAfter,
      typFiles: typAfter,
      generatedReports: reportAfter,
      otherBrandAssets,
      localPathLeaks,
      credentialMatches,
      totalFiles: outputFiles.length
    },
    removed: {
      staleBrandHtml: stalePages.length,
      staleBrandPdf: [...input.stalePdfSet].length,
      typFiles: typFiles.length,
      generatedReports: sourceFiles.filter((file) => /^reports\//.test(file)).length,
      otherBrandAssets: sourceFiles.filter((file) => /^assets\/(?:energize|agim|gong)/i.test(file)).length,
      otherNonAllowlistedFiles: sourceFiles.length - outputFiles.length - stalePages.length - [...input.stalePdfSet].length - typFiles.length - sourceFiles.filter((file) => /^reports\//.test(file)).length - sourceFiles.filter((file) => /^assets\/(?:energize|agim|gong)/i.test(file)).length
    },
    retainedDependencies: {
      assets: outputFiles.filter((file) => file.startsWith("assets/")).length,
      metadata: outputFiles.filter((file) => SAFE_METADATA_FILES.has(file)).length,
      unreferencedAssets: 0
    }
  };
}

async function findUnreferencedAssets(root, files, htmlFiles) {
  const referenced = new Set();
  for (const htmlFile of htmlFiles) {
    const html = await fs.readFile(path.join(root, htmlFile), "utf8");
    for (const ref of localRefs(htmlFile, html)) {
      referenced.add(ref);
    }
  }
  await retainCssDependencies(root, referenced, files);
  return files.filter((file) => file.startsWith("assets/") && !referenced.has(file));
}

async function validateWorkflow() {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  const forbidden = [
    "assign-id",
    "ci:writeback",
    "writeback-preview",
    "pdf:queue",
    "Preview Publish",
    "npm run build",
    "npm run publish:preview",
    "ROUTED_WRITEBACK",
    "NOTION_TOKEN",
    "NOTION_DATABASE_ID"
  ];
  for (const value of forbidden) {
    if (workflow.includes(value)) {
      throw new Error(`Clean deploy workflow contains a forbidden reference: ${value}`);
    }
  }
  if (!/workflow_dispatch:\s*(?:\n|$)/.test(workflow)) {
    throw new Error("Clean deploy workflow must be workflow_dispatch-only.");
  }
  for (const trigger of ["push:", "pull_request:", "schedule:"]) {
    if (workflow.includes(trigger)) {
      throw new Error(`Clean deploy workflow must not contain trigger ${trigger}`);
    }
  }
  for (const permission of ["actions: read", "contents: read", "pages: write", "id-token: write"]) {
    if (!workflow.includes(permission)) {
      throw new Error(`Clean deploy workflow missing permission ${permission}.`);
    }
  }
  if (!workflow.includes("environment:") || !workflow.includes("github-pages")) {
    throw new Error("Clean deploy workflow must target the github-pages environment.");
  }
  console.log(JSON.stringify({ workflowValid: true }, null, 2));
}

async function walk(root) {
  const results = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        results.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  }
  await visit(root);
  return results.sort();
}

async function copyFile(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function sha256(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function assertCount(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} count mismatch: expected ${expected}, found ${actual}.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
