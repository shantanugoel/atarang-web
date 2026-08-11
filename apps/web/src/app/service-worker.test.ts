import {describe,expect,test} from "bun:test";

const source=await Bun.file(new URL("./service-worker.ts",import.meta.url)).text();

describe("service worker privacy boundary",()=>{
  test("never intercepts authenticated, ranged, API, or model requests",()=>{
    expect(source).toContain('request.headers.has("Authorization")');
    expect(source).toContain('request.headers.has("Range")');
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain('url.pathname.startsWith("/models/")');
  });
  test("only cache-routes paths in the generated immutable precache",()=>{
    expect(source).toContain("precachePaths.has(url.pathname)");
    expect(source).not.toContain("cache.put(fetchEvent.request");
  });
});
