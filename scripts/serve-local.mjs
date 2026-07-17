import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const port = Number.parseInt(process.env.PORT || "4173", 10);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^\/+/, "");
  if (relative.startsWith("..")) return null;
  const candidates = relative === ""
    ? ["index.html"]
    : extname(relative)
      ? [relative]
      : [`${relative}.html`, join(relative, "index.html")];
  for (const candidate of candidates) {
    const file = join(root, candidate);
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // Try the next clean URL candidate.
    }
  }
  return null;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const file = await resolveFile(url.pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Local server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`OSL site running at http://127.0.0.1:${port}`);
});
