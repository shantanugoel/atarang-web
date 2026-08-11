import{afterEach,describe,expect,test}from"bun:test";
import{findSyncedLyrics}from"./lrclib";

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch});

describe("LRCLIB lookup",()=>{
  test("prefers a synced exact title, artist, and duration match",async()=>{
    globalThis.fetch=(async()=>new Response(JSON.stringify([
      {id:1,trackName:"Song",artistName:"Someone",duration:200,syncedLyrics:"[00:01.00]wrong"},
      {id:2,trackName:"Song",artistName:"Artist",duration:180,syncedLyrics:"[00:01.00]right"}
    ]),{status:200})) as unknown as typeof fetch;
    await expect(findSyncedLyrics({trackName:"Song",artistName:"Artist",durationSeconds:181})).resolves.toBe("[00:01.00]right");
  });

  test("returns null when no synced result exists",async()=>{
    globalThis.fetch=(async()=>new Response(JSON.stringify([{id:1,trackName:"Song",artistName:"Artist",duration:180,syncedLyrics:null}]),{status:200})) as unknown as typeof fetch;
    await expect(findSyncedLyrics({trackName:"Song"})).resolves.toBeNull();
  });
});
