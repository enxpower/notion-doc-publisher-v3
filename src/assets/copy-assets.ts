import fs from "node:fs/promises";
import path from "node:path";
import { UserFacingError } from "../config.js";
import type { DocumentModel } from "../model/document.js";

export async function copyStyles(distDir = "dist"): Promise<void> {
  await fs.mkdir(path.join(distDir, "assets", "css"), { recursive: true });
  await fs.copyFile("styles/screen.css", path.join(distDir, "assets", "css", "screen.css"));
  await fs.copyFile("styles/print.css", path.join(distDir, "assets", "css", "print.css"));
}

export async function copyDocumentAssets(document: DocumentModel, distDir = "dist"): Promise<void> {
  if (!document.meta.docId) {
    return;
  }
  const assetDir = path.join(distDir, "assets", "docs", document.meta.docId);
  await fs.mkdir(assetDir, { recursive: true });
  for (const asset of document.assets) {
    const filename = path.basename(asset.outputPath).replace(/[^A-Za-z0-9._-]/g, "-");
    const target = path.join(assetDir, filename);
    try {
      await download(asset.sourceUrl, target);
      asset.local = true;
      asset.outputPath = `../../assets/docs/${document.meta.docId}/${filename}`;
    } catch (error) {
      throw new UserFacingError(`Could not copy asset for ${document.meta.docId}: ${asset.sourceUrl}. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Asset request failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(target, bytes);
}
