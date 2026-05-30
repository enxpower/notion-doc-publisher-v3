import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { runCli, UserFacingError } from "../config.js";

const distRoot = path.resolve("dist");
const port = Number(process.env.PORT ?? "4173");

await runCli(async () => {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new UserFacingError("PORT must be a valid TCP port number.");
  }
  if (!fs.existsSync(distRoot)) {
    throw new UserFacingError("dist/ does not exist. Run npm run build before npm run preview.");
  }

  const server = http.createServer((request, response) => {
    const target = resolveRequestPath(request.url ?? "/");
    if (!target) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    fs.stat(target, (statError, stat) => {
      if (statError) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const filePath = stat.isDirectory() ? path.join(target, "index.html") : target;
      fs.readFile(filePath, (readError, body) => {
        if (readError) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, { "content-type": contentType(filePath) });
        response.end(body);
      });
    });
  });

  server.on("error", (error) => {
    console.error(`Could not start preview server on port ${port}: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Preview server running at http://localhost:${port}/`);
    console.log("Press Ctrl+C to stop.");
  });
});

function resolveRequestPath(rawUrl: string): string | undefined {
  const url = new URL(rawUrl, `http://localhost:${port}`);
  const decoded = decodeURIComponent(url.pathname);
  const target = path.resolve(distRoot, `.${decoded}`);
  return target.startsWith(distRoot) ? target : undefined;
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
