const CACHE = "atarang-shell-v2";
const PRECACHE_MANIFEST = "/precache.json";
const SHELL = "/index.html";

// Long enough that a connection worth waiting for wins it, short enough that one
// that is not does not hold a blank app. A dead radio rejects immediately and
// never reaches this; what this exists for is the radio that neither answers nor
// gives up, which is most of what a weak signal actually is.
const NAVIGATION_TIMEOUT_MS = 2_500;

// Filling the cache needs the network. Reading it must never wait on one, and
// these used to be the same code path: a restarted worker — which is most cold
// starts, since they are killed on idle — could not serve a single cached asset
// until it had re-fetched the manifest and re-run addAll, which fetches every
// entry again whatever is already stored. Offline that step throws, every asset
// falls through to a network request that cannot succeed, and an app with all
// of its files on disk fails to boot.
async function populate() {
  const cache = await caches.open(CACHE);
  const response = await fetch(PRECACHE_MANIFEST, { cache: "no-store" });
  if (!response.ok) throw new Error("precache_manifest_unavailable");
  const paths = await response.clone().json() as string[];
  await cache.put(PRECACHE_MANIFEST, response);
  await cache.addAll(paths.filter((path) => path !== SHELL));
  // The host answers /index.html with a redirect to /, and addAll stores what it
  // followed, redirect flag and all. A worker may not answer a navigation with
  // one of those: Safari refuses the page and says so, which is what the cached
  // shell did the first time it was ever reached — offline was broken earlier in
  // the path before, so this never got the chance to show. Storing a plain copy
  // of the body drops the flag and keeps the shell answerable.
  const shellResponse = await fetch(SHELL);
  if (!shellResponse.ok) throw new Error("precache_shell_unavailable");
  await cache.put(SHELL, new Response(await shellResponse.blob(), { status: 200, statusText: "OK", headers: shellResponse.headers }));
  // Every build writes new hashed names into a cache whose name never changes,
  // and nothing removed the ones they replaced — so it grew by a build on every
  // update, tens of megabytes of runtime at a time. A browser pays for that by
  // evicting storage, and on this app the storage worth losing least is the
  // OPFS the 126 MB separation model lives in.
  const keep = new Set([PRECACHE_MANIFEST, ...paths]);
  for (const request of await cache.keys()) {
    if (!keep.has(new URL(request.url).pathname)) await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  (event as ExtendableEvent).waitUntil(populate());
});

self.addEventListener("activate", (event) => {
  (event as ExtendableEvent).waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await populate();
    await (self as unknown as ServiceWorkerGlobalScope).clients.claim();
  })());
});

// The only way a waiting build ever takes over: the user pressed Reload on the
// update notice. Activating on our own would swap the shell out from under a
// take being recorded.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void (self as unknown as ServiceWorkerGlobalScope).skipWaiting();
});

/** The shell, from the network when it is answering and from the cache when it
 *  is not. Network-first with no timeout meant the cached copy was only ever
 *  reached by a fetch that *rejected*; one that merely hung — a weak signal, for
 *  the thirty to ninety seconds the radio keeps trying — showed nothing at all.
 *
 *  A fresh response is deliberately not written back here. The cache holds one
 *  coherent build, put there by install and activate, and a shell saved from a
 *  navigation would name hashed assets that are not stored beside it — which
 *  reads as working until the next time there is no network. */
async function shell(request: Request): Promise<Response> {
  const cached = await caches.match(SHELL);
  if (!cached) return fetch(request);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS); });
  try {
    return (await Promise.race([fetch(request).catch(() => null), timeout])) ?? cached;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const fetchEvent = event as FetchEvent;
  const request = fetchEvent.request;
  if (request.method !== "GET" || request.headers.has("Authorization") || request.headers.has("Range")) return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/models/")) return;
  if (request.mode === "navigate") {
    fetchEvent.respondWith(shell(request));
    return;
  }
  // Read-only, and no manifest needed to decide: everything in here was put
  // there by install or activate from the generated precache, so anything that
  // matches is something the precache vouched for. Anything else is a network
  // request that was going to happen regardless.
  fetchEvent.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});

export {};
