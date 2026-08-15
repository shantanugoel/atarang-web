import { describe, expect, test } from "bun:test";
import { keepScreenAwake } from "./wakeLock";

function harness(visibility: DocumentVisibilityState = "visible") {
  const listeners: Array<() => void> = [];
  let requests = 0;
  const releases: string[] = [];
  const doc = {
    visibilityState: visibility,
    addEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => { listeners.push(handler as () => void); },
    removeEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => { listeners.splice(listeners.indexOf(handler as () => void), 1); },
  };
  const locks: Array<{ id: string; released: boolean }> = [];
  const nav = {
    wakeLock: {
      request: async () => {
        const lock = { id: `lock-${++requests}`, released: false, release: async () => { lock.released = true; releases.push(lock.id); } };
        locks.push(lock);
        return lock as unknown as WakeLockSentinel;
      },
    },
  } as unknown as Navigator;
  const fire = () => { for (const l of [...listeners]) l(); };
  return {
    doc: doc as unknown as Document, nav, listeners, releases, locks,
    requests: () => requests,
    show: () => { doc.visibilityState = "visible"; fire(); },
    hide: () => { doc.visibilityState = "hidden"; for (const lock of locks) if (!lock.released) lock.released = true; fire(); },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("keepScreenAwake", () => {
  test("takes a lock and releases it when stopped", async () => {
    const h = harness();
    const stop = keepScreenAwake(h.nav, h.doc);
    await settle();
    expect(h.requests()).toBe(1);
    stop();
    await settle();
    expect(h.releases).toEqual(["lock-1"]);
    expect(h.listeners).toHaveLength(0);
  });

  test("re-acquires when the page becomes visible again", async () => {
    const h = harness("hidden");
    const stop = keepScreenAwake(h.nav, h.doc);
    await settle();
    expect(h.requests()).toBe(0);
    h.show();
    await settle();
    expect(h.requests()).toBe(1);
    // A second visibilitychange while the lock is held must not stack locks.
    h.show();
    await settle();
    expect(h.requests()).toBe(1);
    stop();
  });

  test("takes a fresh lock after the browser drops one on hide", async () => {
    const h = harness();
    const stop = keepScreenAwake(h.nav, h.doc);
    await settle();
    h.hide();
    await settle();
    expect(h.requests()).toBe(1);
    h.show();
    await settle();
    expect(h.requests()).toBe(2);
    stop();
  });

  test("releases a lock that arrives after stopping", async () => {
    const h = harness();
    keepScreenAwake(h.nav, h.doc)();
    await settle();
    expect(h.releases).toEqual(["lock-1"]);
  });

  test("does nothing where wakeLock is unsupported", async () => {
    const h = harness();
    expect(() => keepScreenAwake({} as Navigator, h.doc)()).not.toThrow();
  });
});
