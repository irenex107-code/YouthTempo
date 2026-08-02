import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const publicPort = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.NEXT_UPSTREAM_PORT || publicPort + 1);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const staticRoot = path.resolve(".next/static");
const staticPrefix = "/_next/static/";

const contentTypes = new Map([
  [".css", "text/css; charset=UTF-8"],
  [".js", "application/javascript; charset=UTF-8"],
  [".json", "application/json; charset=UTF-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const nextServer = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(upstreamPort),
  },
  stdio: "inherit",
});

nextServer.on("exit", (code, signal) => {
  console.error(`Next.js server exited (code=${code ?? "none"}, signal=${signal ?? "none"}).`);
  process.exit(code || 1);
});

function waitForNextServer(timeoutMs = 15_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ host: "127.0.0.1", port: upstreamPort });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) reject(new Error("Next.js server did not become ready."));
        else setTimeout(attempt, 50);
      });
    }

    attempt();
  });
}

function resolveStaticAsset(requestUrl) {
  const pathname = new URL(requestUrl || "/", "http://localhost").pathname;
  if (!pathname.startsWith(staticPrefix)) return null;

  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice(staticPrefix.length));
  } catch {
    return null;
  }

  const filePath = path.resolve(staticRoot, relativePath);
  if (!filePath.startsWith(`${staticRoot}${path.sep}`)) return null;
  return filePath;
}

function serveStaticAsset(req, res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;

  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(req.headers["accept-encoding"] || "");
  const gzipPath = `${filePath}.gz`;
  const selectedPath = acceptsGzip && existsSync(gzipPath) ? gzipPath : filePath;
  const metadata = statSync(selectedPath);
  const extension = path.extname(filePath).toLowerCase();

  res.statusCode = 200;
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Content-Length", String(metadata.size));
  res.setHeader("Content-Type", contentTypes.get(extension) || "application/octet-stream");
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (selectedPath === gzipPath) res.setHeader("Content-Encoding", "gzip");

  if (req.method === "HEAD") res.end();
  else createReadStream(selectedPath).pipe(res);
  return true;
}

function proxyToNext(req, res) {
  const upstreamRequest = http.request(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );

  upstreamRequest.on("error", (error) => {
    console.error("Next.js proxy request failed", error);
    if (!res.headersSent) res.writeHead(503, { "Content-Type": "text/plain; charset=UTF-8" });
    res.end("Service temporarily unavailable.");
  });

  req.pipe(upstreamRequest);
}

await waitForNextServer();

const server = http.createServer((req, res) => {
  const staticAsset = resolveStaticAsset(req.url);
  if (staticAsset && (req.method === "GET" || req.method === "HEAD") && serveStaticAsset(req, res, staticAsset)) return;
  proxyToNext(req, res);
});

server.listen(publicPort, hostname, () => {
  console.log(`CloudBase server listening on http://${hostname}:${publicPort}`);
});

function shutdown(signal) {
  server.close(() => process.exit(0));
  nextServer.kill(signal);
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
