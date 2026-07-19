import fs from "node:fs/promises";
import path from "node:path";
import { UserFacingError } from "../config.js";
import type { DocumentModel } from "../model/document.js";

export async function copyStyles(distDir = "dist", staticAssets?: Iterable<string>): Promise<void> {
  await fs.mkdir(path.join(distDir, "assets", "css"), { recursive: true });
  await fs.copyFile("styles/screen.css", path.join(distDir, "assets", "css", "screen.css"));
  await fs.copyFile("styles/print.css", path.join(distDir, "assets", "css", "print.css"));
  // Copy static assets: share preview images and favicon files.
  // All copies are silent no-ops if the source file is absent.
  try {
    const sourceDir = "assets";
    const files = await fs.readdir(sourceDir);
    const allowedStaticAssets = staticAssets ? new Set(staticAssets) : undefined;
    for (const file of files) {
      const legacyDefaultAsset =
        file === "share-preview.png" ||
        /^.+-share-preview\.png$/.test(file) ||
        file === "favicon.ico" ||
        file === "favicon.png";
      if ((allowedStaticAssets && allowedStaticAssets.has(file)) || (!allowedStaticAssets && legacyDefaultAsset)) {
        try {
          await fs.copyFile(path.join(sourceDir, file), path.join(distDir, "assets", file));
        } catch {
          // File absent — og:image / favicon tags are emitted but will 404 until the file is added
        }
      }
    }
  } catch {
    // assets directory absent
  }
}

export async function copyDocumentAssets(document: DocumentModel, distDir = "dist"): Promise<void> {
  if (!document.meta.docId) {
    return;
  }
  const assetDir = path.join(distDir, "assets", "docs", document.meta.docId);
  await fs.rm(assetDir, { recursive: true, force: true });
  await fs.mkdir(assetDir, { recursive: true });
  const usedNames = new Set<string>();
  for (const asset of document.assets) {
    try {
      const downloaded = await download(asset.sourceUrl);
      asset.contentType = downloaded.contentType;
      const filename = uniqueFilename(
        readableAssetFilename(asset.sourceUrl, asset.kind, asset.notionBlockId, downloaded.contentType),
        usedNames
      );
      const target = path.join(assetDir, filename);
      await fs.writeFile(target, downloaded.bytes);
      asset.local = true;
      asset.outputPath = `../../assets/docs/${document.meta.docId}/${filename}`;
    } catch (error) {
      throw new UserFacingError(`Could not copy asset for ${document.meta.docId}: ${asset.sourceUrl}. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function download(url: string): Promise<{ bytes: Buffer; contentType?: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Asset request failed (${response.status})`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || undefined
  };
}

function readableAssetFilename(sourceUrl: string, kind: "image" | "file", blockId: string | undefined, contentType: string | undefined): string {
  const cleanOriginal = cleanOriginalFilename(sourceUrl);
  if (cleanOriginal) {
    return cleanOriginal;
  }

  const ext = extensionFromUrlToken(sourceUrl) ?? extensionFromContentType(contentType) ?? "bin";
  const prefix = kind === "image" ? "image" : "file";
  return `${prefix}-${shortBlockId(blockId)}.${ext}`;
}

function cleanOriginalFilename(sourceUrl: string): string | undefined {
  let basename = "";
  try {
    basename = path.basename(decodeURIComponent(new URL(sourceUrl).pathname));
  } catch {
    basename = path.basename(sourceUrl);
  }
  const safe = sanitizeFilename(basename);
  const ext = path.extname(safe).slice(1).toLowerCase();
  if (!safe || !validExtensions.has(ext)) {
    return undefined;
  }
  const stem = path.basename(safe, path.extname(safe));
  if (!stem || extensionTokens.has(stem.toLowerCase())) {
    return undefined;
  }
  return safe;
}

function extensionFromUrlToken(sourceUrl: string): string | undefined {
  try {
    const token = path.basename(new URL(sourceUrl).pathname).toLowerCase();
    return extensionTokens.has(token) ? normalizeExtension(token) : undefined;
  } catch {
    const token = path.basename(sourceUrl).toLowerCase();
    return extensionTokens.has(token) ? normalizeExtension(token) : undefined;
  }
}

function extensionFromContentType(contentType: string | undefined): string | undefined {
  if (!contentType) {
    return undefined;
  }
  return contentTypeExtensions[contentType];
}

function uniqueFilename(filename: string, usedNames: Set<string>): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = filename;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeFilename(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^\.+/, "");
}

function shortBlockId(blockId: string | undefined): string {
  const clean = (blockId ?? "asset").replace(/[^A-Za-z0-9]/g, "");
  return clean.slice(0, 8) || "asset";
}

function normalizeExtension(ext: string): string {
  return ext === "jpeg" ? "jpg" : ext;
}

const extensionTokens = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf"]);
const validExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf", "bin"]);
const contentTypeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf"
};
