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

  // Enhanced LRC highlights a word at a time and gives chord placement real
  // onsets instead of a character guess, so it wins between equal matches.
  test("prefers word timings between two equally good matches",async()=>{
    globalThis.fetch=(async()=>new Response(JSON.stringify([
      {id:1,trackName:"Song",artistName:"Artist",duration:180,syncedLyrics:"[00:01.00]line only"},
      {id:2,trackName:"Song",artistName:"Artist",duration:180,syncedLyrics:"[00:01.00]<00:01.00>word <00:01.40>timed"}
    ]),{status:200})) as unknown as typeof fetch;
    await expect(findSyncedLyrics({trackName:"Song",artistName:"Artist",durationSeconds:181})).resolves.toContain("<00:01.40>");
  });

  // And never at the cost of matching the right song, which is what a tiebreak
  // rather than a filter means.
  test("still takes the better match over a word-timed wrong one",async()=>{
    globalThis.fetch=(async()=>new Response(JSON.stringify([
      {id:1,trackName:"Other song",artistName:"Someone",duration:400,syncedLyrics:"[00:01.00]<00:01.00>word timed"},
      {id:2,trackName:"Song",artistName:"Artist",duration:180,syncedLyrics:"[00:01.00]right"}
    ]),{status:200})) as unknown as typeof fetch;
    await expect(findSyncedLyrics({trackName:"Song",artistName:"Artist",durationSeconds:181})).resolves.toBe("[00:01.00]right");
  });

  test("returns null when no synced result exists",async()=>{
    globalThis.fetch=(async()=>new Response(JSON.stringify([{id:1,trackName:"Song",artistName:"Artist",duration:180,syncedLyrics:null}]),{status:200})) as unknown as typeof fetch;
    await expect(findSyncedLyrics({trackName:"Song"})).resolves.toBeNull();
  });
});
