const CACHE = "atarang-shell-v2";
const PRECACHE_MANIFEST = "/precache.json";
let precachePaths = new Set<string>();
let precacheLoading: Promise<void> | null = null;

async function loadPrecache() {
  const cache = await caches.open(CACHE);
  const response = await fetch(PRECACHE_MANIFEST, { cache: "no-store" }).catch(() => cache.match(PRECACHE_MANIFEST));
  if (!response?.ok) throw new Error("precache_manifest_unavailable");
  const paths = await response.clone().json() as string[];
  precachePaths = new Set(paths);
  await cache.put(PRECACHE_MANIFEST, response);
  await cache.addAll(paths);
}

function ensurePrecache() {
  if (precachePaths.size) return Promise.resolve();
  precacheLoading ??= loadPrecache().finally(() => { precacheLoading = null; });
  return precacheLoading;
}

self.addEventListener("install", (event) => {
  (event as ExtendableEvent).waitUntil(loadPrecache());
});

self.addEventListener("activate", (event) => {
  (event as ExtendableEvent).waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await loadPrecache();
    await (self as unknown as ServiceWorkerGlobalScope).clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const fetchEvent = event as FetchEvent;
  const request = fetchEvent.request;
  if (request.method !== "GET" || request.headers.has("Authorization") || request.headers.has("Range")) return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/models/")) return;
  if (request.mode === "navigate") {
    fetchEvent.respondWith(fetch(request).catch(async () => (await caches.match("/index.html")) ?? Response.error()));
    return;
  }
  fetchEvent.respondWith((async () => {
    try { await ensurePrecache(); } catch { return fetch(request); }
    if (!precachePaths.has(url.pathname)) return fetch(request);
    return (await caches.match(request)) ?? fetch(request);
  })());
});

export {};
