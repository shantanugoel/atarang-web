import { useEffect } from "react";

/**
 * Holds a screen wake lock until the returned function is called.
 *
 * A tablet on a music stand with a 16-bar loop running is the whole shape of a
 * practice session, and the display sleeping two minutes in is the one thing
 * that breaks it. The browser drops the lock every time the page hides, so it
 * has to be re-taken on `visibilitychange` and not only when playback starts.
 *
 * Firefox has no `navigator.wakeLock`, where this does nothing — which is
 * today's behaviour, so there is nothing to fall back to.
 *
 * `nav`/`doc` are parameters so the behaviour can be tested without a DOM.
 */
// Releasing a lock the browser already took back rejects, and there is nothing
// to do about it but stay out of the console.
const drop = (lock: WakeLockSentinel) => void lock.release().catch(() => {});

export function keepScreenAwake(nav: Navigator = navigator, doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document) {
  let sentinel: WakeLockSentinel | null = null;
  let pending: Promise<unknown> | null = null;
  let cancelled = false;
  // `released` is the sentinel's own flag, set when the browser drops the lock
  // on hide — so a re-show asks for a new one instead of trusting a dead handle.
  // `pending` matters because two visibility events in the same tick would
  // otherwise take two locks and leak the first, and a leaked lock means the
  // screen never sleeps again.
  const acquire = () => {
    if (cancelled || pending || (sentinel && !sentinel.released) || doc.visibilityState !== "visible" || !("wakeLock" in nav)) return;
    // A rejection is normal here — a hidden page, or a battery-saver refusal —
    // and there is nothing worth telling the player about it.
    pending = nav.wakeLock.request("screen").then(
      (lock) => { if (cancelled) return drop(lock); sentinel = lock; },
      () => {},
    ).finally(() => { pending = null; });
  };
  acquire();
  doc.addEventListener("visibilitychange", acquire);
  return () => {
    cancelled = true;
    doc.removeEventListener("visibilitychange", acquire);
    if (sentinel) drop(sentinel);
    sentinel = null;
  };
}

/** Keeps the display awake while `active`, which is "while something is playing". */
export function useWakeLock(active: boolean) {
  useEffect(() => (active ? keepScreenAwake() : undefined), [active]);
}
