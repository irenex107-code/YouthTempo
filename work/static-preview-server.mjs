import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const pagesDir = join(root, ".next", "server", "pages");
const staticDir = join(root, ".next", "static");
const port = 3000;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": types[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

function pagePath(urlPath) {
  if (urlPath === "/") return join(pagesDir, "index.html");
  return join(pagesDir, `${urlPath.slice(1)}.html`);
}

createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");

  if (safePath.startsWith("/_next/static/")) {
    sendFile(res, join(staticDir, safePath.replace("/_next/static/", "")));
    return;
  }

  sendFile(res, pagePath(safePath));
}).listen(port, "127.0.0.1", () => {
  console.log(`Static preview running at http://127.0.0.1:${port}`);
});
