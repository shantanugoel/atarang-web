import { extname, join, normalize } from "node:path";

const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".map": "application/json", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".wav": "audio/wav", ".wasm": "application/wasm", ".onnx": "application/octet-stream" };

// Stems need SharedArrayBuffer, which needs cross-origin isolation. Without
// these two headers `crossOriginIsolated` is false and separation, four-stem
// playback, metronome, count-in and recording all refuse to start.
const securityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const root = join(import.meta.dir, "dist");

export function serveDist(port: number) {
  return Bun.serve({
    hostname: "0.0.0.0",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
      let file = Bun.file(join(root, relative));
      if (!(await file.exists()) || url.pathname.endsWith("/")) {
        // Only navigations fall back to the SPA shell. Answering a missing
        // asset with index.html turns "model not installed" into a JSON parse
        // error several layers away from the cause.
        if (extname(relative) && !request.headers.get("accept")?.includes("text/html")) {
          return new Response("Not found", { status: 404, headers: securityHeaders });
        }
        file = Bun.file(join(root, "index.html"));
      }
      return new Response(file, { headers: { ...securityHeaders, "Cache-Control": "no-store", "Content-Type": mime[extname(file.name ?? "")] ?? file.type ?? "application/octet-stream" } });
    },
  });
}
