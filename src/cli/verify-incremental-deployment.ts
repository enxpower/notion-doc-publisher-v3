import fs from "node:fs/promises";
import path from "node:path";

import { runCli, UserFacingError } from "../config.js";
import type { LifecycleAction, DocumentStateRecord, IncrementalStateManifest } from "../routing/incremental.js";

type ApplyRecordResult = {
  action: LifecycleAction;
  brand: string;
  docId: string;
  status: "planned" | "success" | "failed" | "skipped";
  reason: string;
};

type ApplyResult = {
  schema: "notion-doc-publisher-v3/incremental-apply-result";
  version: 1;
  recordResults: ApplyRecordResult[];
};

type VerificationRecord = {
  action: LifecycleAction;
  brand: string;
  docId: string;
  checks: Array<{ url: string; expected: "present" | "absent"; status: number }>;
};

await runCli(async () => {
  const resultPath = path.resolve(process.env.INCREMENTAL_APPLY_RESULT_PATH ?? "dist/incremental-apply/result.json");
  const previousStatePath = path.resolve(
    process.env.PHASE2_PREVIOUS_STATE_PATH ?? "dist/phase2-run/previous-state.json"
  );
  const nextStatePath = path.resolve(process.env.PHASE2_STATE_PATH ?? "dist/phase2-run/next-state.json");
  const outputPath = path.resolve(
    process.env.INCREMENTAL_VERIFICATION_RESULT_PATH ?? "dist/incremental-apply/verification.json"
  );
  const retries = positiveInteger(process.env.INCREMENTAL_VERIFY_RETRIES, 36);
  const delayMs = positiveInteger(process.env.INCREMENTAL_VERIFY_DELAY_MS, 10_000);

  const result = await readApplyResult(resultPath);
  const previousState = await readState(previousStatePath);
  const nextState = await readState(nextStatePath);
  const previousByDocId = new Map(previousState.records.map((record) => [record.docId, record]));
  const nextByDocId = new Map(nextState.records.map((record) => [record.docId, record]));
  const records: VerificationRecord[] = [];

  for (const record of result.recordResults) {
    if (record.status === "failed" || record.action === "INVALID") {
      const previous = previousByDocId.get(record.docId);
      if (previous) {
        records.push(await verifyRecord(record, [
          { url: previous.finalUrl, expected: "present", kind: "html" },
          ...pdfChecks(previous, "present")
        ], retries, delayMs));
      }
      continue;
    }
    if (record.status !== "success") {
      continue;
    }

    if (record.action === "CREATE" || record.action === "UPDATE" || record.action === "MOVE") {
      const next = nextByDocId.get(record.docId);
      if (!next) {
        throw new UserFacingError(`Next state is missing successful ${record.action} record ${record.docId}.`);
      }
      const nextPdfChecks = pdfChecks(next, "present");
      const checks: CheckInput[] = [
        { url: next.finalUrl, expected: "present", kind: "html" },
        ...nextPdfChecks
      ];
      const previous = previousByDocId.get(record.docId);
      if (record.action === "MOVE" && previous && previous.finalUrl !== next.finalUrl) {
        checks.push({ url: previous.finalUrl, expected: "absent", kind: "html" });
        const activePdfUrls = new Set(nextPdfChecks.map((check) => check.url));
        checks.push(...pdfChecks(previous, "absent").filter((check) => !activePdfUrls.has(check.url)));
      }
      records.push(await verifyRecord(record, checks, retries, delayMs));
      continue;
    }

    if (record.action === "REMOVE") {
      const previous = previousByDocId.get(record.docId);
      if (!previous) {
        throw new UserFacingError(`Previous state is missing successful REMOVE record ${record.docId}.`);
      }
      records.push(await verifyRecord(record, [
        { url: previous.finalUrl, expected: "absent", kind: "html" },
        ...pdfChecks(previous, "absent")
      ], retries, delayMs));
    }
  }

  const verification = {
    schema: "notion-doc-publisher-v3/incremental-verification",
    version: 1,
    verifiedAt: new Date().toISOString(),
    verifiedRecordCount: records.length,
    records
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  console.log(`Incremental deployment verification passed for ${records.length} lifecycle records.`);
  console.log(`Verification: ${path.relative(process.cwd(), outputPath)}`);
});

type CheckInput = {
  url: string;
  expected: "present" | "absent";
  kind: "html" | "pdf";
};

async function verifyRecord(
  record: ApplyRecordResult,
  checks: CheckInput[],
  retries: number,
  delayMs: number
): Promise<VerificationRecord> {
  const completed: VerificationRecord["checks"] = [];
  for (const check of checks) {
    const status = await waitForExpectedStatus(check, retries, delayMs);
    completed.push({ url: check.url, expected: check.expected, status });
  }
  return {
    action: record.action,
    brand: record.brand,
    docId: record.docId,
    checks: completed
  };
}

async function waitForExpectedStatus(check: CheckInput, retries: number, delayMs: number): Promise<number> {
  let lastStatus = 0;
  let lastError = "";
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(check.url, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": "notion-doc-publisher-v3-phase2-verifier" }
      });
      lastStatus = response.status;
      const contentType = response.headers.get("content-type") ?? "";
      if (check.expected === "absent" && response.status === 404) {
        return response.status;
      }
      if (check.expected === "present" && response.status >= 200 && response.status < 300) {
        if (check.kind === "html" && !contentType.toLowerCase().includes("text/html")) {
          lastError = `unexpected HTML content type ${contentType || "missing"}`;
        } else if (check.kind === "pdf" && !contentType.toLowerCase().includes("application/pdf")) {
          lastError = `unexpected PDF content type ${contentType || "missing"}`;
        } else {
          return response.status;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < retries) {
      await sleep(delayMs);
    }
  }
  throw new UserFacingError(
    `Live verification failed for ${check.url}; expected ${check.expected}, last status ${lastStatus || "none"}` +
      (lastError ? `, ${lastError}` : "")
  );
}

function pdfChecks(record: DocumentStateRecord, expected: "present" | "absent"): CheckInput[] {
  if (!record.pdfRequired) {
    return [];
  }
  const pdfFile = record.ownedFiles.find((file) => file.toLowerCase().endsWith(".pdf"));
  if (!pdfFile) {
    throw new UserFacingError(`State record ${record.docId} requires PDF but has no owned PDF file.`);
  }
  return [{ url: new URL(`/${pdfFile.replace(/^\/+/, "")}`, record.canonicalOrigin).toString(), expected, kind: "pdf" }];
}

async function readApplyResult(filePath: string): Promise<ApplyResult> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as ApplyResult;
  if (parsed.schema !== "notion-doc-publisher-v3/incremental-apply-result" || parsed.version !== 1) {
    throw new UserFacingError("Incremental apply result has an unexpected schema.");
  }
  return parsed;
}

async function readState(filePath: string): Promise<IncrementalStateManifest> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as IncrementalStateManifest;
  if (parsed.schema !== "notion-doc-publisher-v3/incremental-state" || parsed.version !== 1) {
    throw new UserFacingError(`Incremental state has an unexpected schema: ${filePath}`);
  }
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UserFacingError(`Expected a positive integer, received ${value}.`);
  }
  return parsed;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
