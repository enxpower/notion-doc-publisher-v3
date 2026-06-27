import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { UserFacingError, runCli } from "../config.js";

await runCli(async () => {
  const loPath = await findLibreOffice();
  if (!loPath) {
    throw new UserFacingError(
      "LibreOffice not found. Install LibreOffice to convert DOCX to PDF.\n" +
      "  macOS: https://www.libreoffice.org/download/libreoffice/\n" +
      "  Linux: apt install libreoffice  (or equivalent)"
    );
  }

  // Optional DOC_ID filter: npm run pdf:from-docx ARCBOS-CON-2606-0001
  const filter = process.argv[2]?.trim().toUpperCase() || null;

  let docxFiles: string[];
  try {
    const entries = await fs.readdir("dist/docx");
    docxFiles = entries
      .filter((f) => f.endsWith(".docx"))
      .filter((f) => !filter || f.toUpperCase().startsWith(filter))
      .map((f) => path.join("dist", "docx", f));
  } catch {
    console.log("dist/docx/ does not exist. Run npm run docx:doc first.");
    return;
  }

  if (docxFiles.length === 0) {
    const hint = filter ? ` matching "${filter}"` : "";
    console.log(`No DOCX files found in dist/docx/${hint}. Run npm run docx:doc first.`);
    return;
  }

  await fs.mkdir("dist/pdf", { recursive: true });

  for (const docxPath of docxFiles) {
    const base = path.basename(docxPath);
    console.log(`[PDF] Converting ${base}...`);
    try {
      await convertDocxToPdf(loPath, docxPath, "dist/pdf");
      const pdfName = base.replace(/\.docx$/i, ".pdf");
      console.log(`[PDF] Written: dist/pdf/${pdfName}`);
    } catch (err) {
      console.error(`[PDF] Failed to convert ${base}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`Converted ${docxFiles.length} file(s). PDFs are in dist/pdf/.`);
});

function convertDocxToPdf(loPath: string, docxPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(loPath, ["--headless", "--convert-to", "pdf", "--outdir", outDir, docxPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderr: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`LibreOffice exited with code ${code}. ${stderr.join("").trim()}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to launch LibreOffice: ${err.message}`));
    });
  });
}

async function findLibreOffice(): Promise<string | null> {
  // Absolute paths for known install locations
  const absolutePaths = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice", // macOS
    "/usr/bin/libreoffice",
    "/usr/local/bin/libreoffice",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/snap/bin/libreoffice",
  ];

  for (const p of absolutePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // not at this path
    }
  }

  // Fall back to PATH-based lookup
  for (const name of ["libreoffice", "soffice"]) {
    const result = spawnSync("which", [name], { stdio: "pipe" });
    if (result.status === 0) {
      const found = result.stdout.toString().trim();
      if (found) return found;
    }
  }

  return null;
}
