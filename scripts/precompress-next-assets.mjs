import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const staticRoot = path.resolve(".next/static");
const compressibleExtensions = new Set([".css", ".js", ".json", ".svg"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    else if (entry.isFile() && compressibleExtensions.has(path.extname(entry.name))) files.push(entryPath);
  }

  return files;
}

const files = await walk(staticRoot);
let sourceBytes = 0;
let compressedBytes = 0;

for (const file of files) {
  const source = await readFile(file);
  const compressed = await gzipAsync(source, { level: 9 });
  sourceBytes += source.byteLength;
  compressedBytes += compressed.byteLength;
  await writeFile(`${file}.gz`, compressed);
}

console.log(
  `Precompressed ${files.length} Next.js assets: ${sourceBytes} -> ${compressedBytes} bytes`,
);
