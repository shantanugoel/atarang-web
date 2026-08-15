import { afterEach, describe, expect, test } from "bun:test";
import { withSongMutationLease } from "./mutationLease";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

/** A LockManager that only knows `ifAvailable`, which is all this module uses.
 *  `otherTab` stands in for a lock some other tab is holding. */
function lockHarness() {
  const state = { otherTab: false, requests: 0, concurrent: 0, peak: 0 };
  const held = new Set<string>();
  const locks = {
    request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) => {
      state.requests++;
      if (held.has(name) || state.otherTab) return callback(null);
      held.add(name);
      state.peak = Math.max(state.peak, ++state.concurrent);
      try { return await callback({ name, mode: "exclusive" } as Lock); }
      finally { state.concurrent--; held.delete(name); }
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
  return state;
}

/** The path taken by browsers without `navigator.locks`: a localStorage claim
 *  with an expiry, plus a heartbeat that renews it. */
function fallbackHarness() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } }, configurable: true });
  Object.defineProperty(globalThis, "window", { value: { setInterval: () => 0, clearInterval: () => undefined }, configurable: true });
  return store;
}

afterEach(() => {
  for (const name of ["navigator", "localStorage", "window"]) Reflect.deleteProperty(globalThis, name);
});

describe("withSongMutationLease", () => {
  test("queues same-tab callers instead of refusing them", async () => {
    const state = lockHarness();
    const first = deferred<string>();
    const order: string[] = [];
    const analysis = withSongMutationLease("song", async () => { order.push("analysis"); return first.promise; });
    const separation = withSongMutationLease("song", async () => { order.push("separation"); return "separated"; });
    await settle();
    // The second caller has not even asked for the lock yet — this is the case
    // that used to be reported as another tab holding the song.
    expect(order).toEqual(["analysis"]);
    expect(state.requests).toBe(1);
    first.resolve("analysed");
    expect(await analysis).toBe("analysed");
    expect(await separation).toBe("separated");
    expect(order).toEqual(["analysis", "separation"]);
    expect(state.peak).toBe(1);
  });

  test("still reports a genuinely different tab", async () => {
    const state = lockHarness();
    state.otherTab = true;
    await expect(withSongMutationLease("song", async () => "never")).rejects.toThrow("song_busy_in_another_tab");
  });

  test("a failed turn releases the queue and writes nothing", async () => {
    lockHarness();
    let ran = false;
    const failed = withSongMutationLease("song", async () => { throw new Error("analysis_failed"); });
    const next = withSongMutationLease("song", async () => { ran = true; return "ok"; });
    await expect(failed).rejects.toThrow("analysis_failed");
    expect(await next).toBe("ok");
    expect(ran).toBe(true);
  });

  test("different songs do not wait for each other", async () => {
    lockHarness();
    const blocker = deferred<string>();
    const held = withSongMutationLease("song-a", () => blocker.promise);
    expect(await withSongMutationLease("song-b", async () => "b")).toBe("b");
    blocker.resolve("a");
    expect(await held).toBe("a");
  });

  test("queues the same way on the localStorage fallback", async () => {
    const store = fallbackHarness();
    const first = deferred<string>();
    const order: string[] = [];
    const analysis = withSongMutationLease("song", async () => { order.push("analysis"); return first.promise; });
    const separation = withSongMutationLease("song", async () => { order.push("separation"); return "separated"; });
    await settle();
    expect(order).toEqual(["analysis"]);
    first.resolve("analysed");
    await analysis;
    expect(await separation).toBe("separated");
    expect(order).toEqual(["analysis", "separation"]);
    expect(store.size).toBe(0);
  });

  test("the fallback still refuses a claim another tab holds", async () => {
    const store = fallbackHarness();
    store.set("atarang:song:song:fallback", JSON.stringify({ token: "other-tab", expiresAt: Date.now() + 15_000 }));
    await expect(withSongMutationLease("song", async () => "never")).rejects.toThrow("song_busy_in_another_tab");
  });
});
