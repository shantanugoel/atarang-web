import { DownloadSimple, ShieldCheck, ShieldWarning, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { PERSISTENCE_ADVICE, usePersistenceRequest } from "./persistentStorage";
import { useModelManager } from "../features/separation/useModelManager";
import { missingAudioOriginalIds, subscribeLibrary } from "../storage/repositories";
import styles from "./StorageNotice.module.css";

// This renders inside the root layout, and reading sessionStorage throws where
// storage is blocked for the origin. A reassurance banner must not be able to
// take the whole application down.
//
// The dismissal remembers *which* warning was put away, so the day a song's
// audio actually goes missing the notice comes back once: a risk that has
// already cost the user something is not the warning they dismissed.
const dismissedForSession = { get: () => { try { return sessionStorage.getItem("atarang.storage.notice") ?? ""; } catch { return ""; } }, set: (value: string) => { try { sessionStorage.setItem("atarang.storage.notice", value); } catch { /* Then it comes back on the next page. */ } } };

/**
 * Says out loud that the browser can reclaim the library.
 *
 * Persistence is already requested at import; browsers routinely decline it,
 * and when they later reclaim the space a separated song silently becomes an
 * original again. The remedy is only available to the user, so the risk has to
 * be visible before it costs them anything — and honest about the fact that
 * asking may not work.
 */
export function StorageNotice() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(dismissedForSession.get);
  const [lost, setLost] = useState(false);
  const { evicted, manifest, progress, download } = useModelManager();
  // The answer stays on screen rather than updating `persisted`: a banner that
  // vanishes the moment the browser says yes reads the same as one that failed.
  const { state: persistence, request } = usePersistenceRequest();

  useEffect(() => { void (navigator.storage?.persisted?.() ?? Promise.resolve(true)).then(setPersisted, () => setPersisted(true)); }, []);
  // Songs that have lost their audio right now, not a quarantine note saying it
  // happened once: recovering or removing the last affected song has to be able
  // to put this warning away, or it nags about a problem the user has fixed.
  useEffect(() => { const check = () => void missingAudioOriginalIds().then((ids) => setLost(ids.size > 0), () => undefined); check(); return subscribeLibrary(check); }, []);

  const notice = lost ? "lost" : "risk";
  // Granted, still checking, or this exact warning put away for the session.
  if (persisted !== false || dismissed === notice) return null;

  const dismiss = () => { dismissedForSession.set(notice); setDismissed(notice); };

  return <div className={styles.notice} role={lost && persistence !== "granted" ? "alert" : "status"}>
    {persistence === "granted" ? <ShieldCheck className={styles.granted} aria-hidden /> : <ShieldWarning aria-hidden />}
    <p>
      {persistence === "granted"
        ? <><b>Your browser granted persistent storage.</b> Songs, stems and takes now stay on this device until you delete them. A backup is still the only thing that survives losing this browser profile.</>
        : lost
        ? <><b>This browser has already deleted audio from your library.</b> The affected songs are marked “Audio missing” in your Library; re-import the source file from your computer to play one again. Their lyrics, charts and practice settings are untouched.</>
        : evicted
        ? <><b>The separation model was reclaimed by this browser.</b> Storage here is not persistent, so songs, stems and takes can go the same way.</>
        : <><b>This browser can reclaim Atarang's storage.</b> Songs, stems and recorded takes live on this device only, and are deleted without warning when space runs low.</>}
      {persistence === "denied" && <> Your browser declined the request. {PERSISTENCE_ADVICE}</>}
    </p>
    <div className={styles.actions}>
      {evicted && manifest && persistence !== "granted" && <button className={styles.primary} disabled={Boolean(progress)} onClick={() => void download()}>
        <DownloadSimple aria-hidden />{progress ? `Downloading… ${Math.round(progress.completedBytes / progress.totalBytes * 100)}%` : "Download model again"}
      </button>}
      {/* Named for what it does. "Keep my library" reads like a setting the user
          already has, next to a warning that the browser can take it away. */}
      {(persistence === "idle" || persistence === "pending") && <button disabled={persistence === "pending"} onClick={() => void request()}>{persistence === "pending" ? "Asking your browser…" : "Request persistent storage"}</button>}
      <button className={styles.dismiss} aria-label="Dismiss storage notice" onClick={dismiss}><X aria-hidden /></button>
    </div>
  </div>;
}
