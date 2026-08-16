import {describe,expect,test} from "bun:test";

const source=await Bun.file(new URL("./service-worker.ts",import.meta.url)).text();
const PRECACHE_MANIFEST="/precache.json";

describe("service worker privacy boundary",()=>{
  test("never intercepts authenticated, ranged, API, or model requests",()=>{
    expect(source).toContain('request.headers.has("Authorization")');
    expect(source).toContain('request.headers.has("Range")');
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain('url.pathname.startsWith("/models/")');
  });
  // Was asserted through the name of a variable that decided it, which stopped
  // existing when serving stopped needing the manifest at all. The property is
  // the same one: only install and activate put anything in the cache, from the
  // generated list, so whatever the fetch handler finds there is vouched for.
  test("serves from the cache and never writes to it",()=>{
    const handler=source.slice(source.indexOf('addEventListener("fetch"'));
    expect(handler).toContain("caches.match(");
    expect(handler).not.toContain("cache.put");
    expect(handler).not.toContain("cache.addAll");
  });
  // The bug this file is guarding against booted an app with every file already
  // on disk straight into a network request it could not make.
  test("reading the cache does not wait on the network",()=>{
    const handler=source.slice(source.indexOf('addEventListener("fetch"'));
    expect(handler).not.toContain(PRECACHE_MANIFEST);
    expect(handler).not.toContain("populate(");
  });
});
