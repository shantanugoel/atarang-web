import { extname, join, normalize } from "node:path";

const port = Number(Bun.env.PORT ?? 4173);
const root = join(import.meta.dir, "dist");
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".map": "application/json", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".wav": "audio/wav" };
const securityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

Bun.serve({
  hostname: "0.0.0.0",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
    let file = Bun.file(join(root, relative));
    if (!(await file.exists()) || url.pathname.endsWith("/")) file = Bun.file(join(root, "index.html"));
    return new Response(file, { headers: { ...securityHeaders, "Content-Type": mime[extname(file.name ?? "")] ?? file.type ?? "application/octet-stream" } });
  },
});
console.log(`Atarang preview listening on http://0.0.0.0:${port}`);
