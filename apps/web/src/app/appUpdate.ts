import { useEffect, useState } from "react";

/**
 * Calls back with the worker holding a newer build, once there is one.
 *
 * A session here is "leave the tab open on the stand for a week", so an
 * installed copy can sit a release or two behind with nothing on screen saying
 * so. One `update()` at startup covers reopening the tab; past that the browser
 * re-checks the registration on its own about once a day, which is soon enough
 * for a notice nobody is waiting on.
 *
 * `container` is a parameter so this can be tested without a service worker.
 */
export function watchForUpdate(onWaiting: (worker: ServiceWorker) => void, container: ServiceWorkerContainer | undefined = navigator.serviceWorker) {
  if (!container) return () => {};
  let cancelled = false;
  const cleanups: Array<() => void> = [];
  void container.getRegistration().then((registration) => {
    if (!registration || cancelled) return;
    // A worker that is installed while nothing controls the page is the first
    // install, not an update — there is no older build to replace.
    const announce = (worker: ServiceWorker | null) => { if (worker?.state === "installed" && container.controller) onWaiting(worker); };
    const found = () => {
      const installing = registration.installing;
      if (!installing) return announce(registration.waiting);
      const changed = () => announce(installing);
      installing.addEventListener("statechange", changed);
      cleanups.push(() => installing.removeEventListener("statechange", changed));
    };
    announce(registration.waiting);
    registration.addEventListener("updatefound", found);
    cleanups.push(() => registration.removeEventListener("updatefound", found));
    // Rejects offline, which is not worth a word to anyone.
    void registration.update().catch(() => {});
  });
  return () => { cancelled = true; for (const cleanup of cleanups) cleanup(); };
}

/**
 * Swaps in the waiting build and reloads — only ever from a click. Reloading on
 * our own would stop playback, and the tab this happens in is on a music stand
 * with someone recording a take against it.
 */
export function applyUpdate(worker: ServiceWorker) {
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  worker.postMessage("skip-waiting");
}

export function useAppUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => watchForUpdate(setWaiting), []);
  return waiting;
}
