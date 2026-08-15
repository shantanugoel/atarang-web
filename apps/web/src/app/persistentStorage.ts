import { useState } from "react";
import { putSetting } from "../storage/repositories";

/** The only thing a user can actually do about a browser that says no. */
export const PERSISTENCE_ADVICE = "Browsers usually grant this once a site is bookmarked, installed as an app, or used regularly. Bookmark Atarang (Ctrl+D, or ⌘+D on a Mac) or install it from your browser's address bar, then ask again. Until then, keep a backup.";

export type PersistenceState = "idle" | "pending" | "granted" | "denied";

/**
 * Asks the browser to keep the library, and reports all three answers.
 *
 * Asking is a call into another program that takes a moment and can refuse, so
 * every place that asks owes the user the same three states — waiting, yes, no.
 * Each caller used to show only some of them, so a granted request looked
 * exactly like a button that did nothing.
 */
export function usePersistenceRequest(onSettled?: () => unknown) {
  const [state, setState] = useState<PersistenceState>("idle");
  const request = async () => {
    setState("pending");
    let granted = false;
    try { granted = await navigator.storage.persist(); } catch { /* A browser that throws has refused, as far as the user is concerned. */ }
    setState(granted ? "granted" : "denied");
    try { await putSetting("storage.persistence", { granted, checkedAt: new Date().toISOString() }); } catch { /* Persistence is advisory; the answer above is what matters. */ }
    await onSettled?.();
  };
  return { state, request };
}
