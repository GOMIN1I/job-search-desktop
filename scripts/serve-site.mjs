// Локальный просмотр сайта (site/) с поддержкой Range — как на GitHub Pages, чтобы видео перематывалось.
// Запуск: node scripts/serve-site.mjs [порт]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const port = Number(process.argv[2] || 4173);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".mp4": "video/mp4", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon" };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(root, url.endsWith("/") ? url + "index.html" : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end("not found"); return; }
  const size = fs.statSync(file).size;
  const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "Content-Length": size });
  if (req.method === "HEAD") { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`site: http://127.0.0.1:${port}/`));
