import { DownloadSimple, ShieldCheck, ShieldWarning, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { PERSISTENCE_ADVICE, usePersistenceRequest } from "./persistentStorage";
import { useModelManager } from "../features/separation/useModelManager";
import { missingAudioOriginalIds, listOriginals, subscribeLibrary } from "../storage/repositories";
import styles from "./StorageNotice.module.css";

// This renders inside the root layout, and reading sessionStorage throws where
// storage is blocked for the origin. A reassurance banner must not be able to
// take the whole application down.
//
// The dismissal remembers *which* warning was put away, so the day a song's
// audio actually goes missing the notice comes back once: a risk that has
// already cost the user something is not the warning they dismissed.
const dismissedForSession = { get: () => { try { return sessionStorage.getItem("atarang.storage.notice") ?? ""; } catch { return ""; } }, set: (value: string) => { try { sessionStorage.setItem("atarang.storage.notice", value); } catch { /* Then it comes back on the next page. */ } } };

// IndexedDB can be wiped whole while localStorage survives, so the highest
// count of songs this browser has ever seen is remembered out here. An empty
// library under a non-zero marker is a cleared profile — whether the browser
// did it or the user did, the empty state deserves one honest sentence either
// way.
const everCount = { get: () => { try { return Number(localStorage.getItem("atarang.library.everCount") ?? 0); } catch { return 0; } }, set: (value: number) => { try { localStorage.setItem("atarang.library.everCount", String(value)); } catch { /* The next visit re-learns it. */ } } };

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
  const [cleared, setCleared] = useState(false);
  // Dismissal remembers how much was on disk when the warning went away, in
  // hundred-megabyte buckets. A model or songs added later change the picture,
  // so the same session's dismissal does not bury a risk that has grown.
  const [usageBucket, setUsageBucket] = useState(0);
  const [blockedByPersistence, setBlockedByPersistence] = useState(false);
  const { evicted, manifest, progress, download, error } = useModelManager();
  // The answer stays on screen rather than updating `persisted`: a banner that
  // vanishes the moment the browser says yes reads the same as one that failed.
  const { state: persistence, request } = usePersistenceRequest();

  useEffect(() => { void (navigator.storage?.persisted?.() ?? Promise.resolve(true)).then(setPersisted, () => setPersisted(true)); }, []);
  // Songs that have lost their audio right now, not a quarantine note saying it
  // happened once: recovering or removing the last affected song has to be able
  // to put this warning away, or it nags about a problem the user has fixed.
  useEffect(() => {
    const check = () => void Promise.all([missingAudioOriginalIds(), listOriginals()]).then(([ids, originals]) => {
      setLost(ids.size > 0);
      const seen = everCount.get();
      if (originals.length > seen) everCount.set(originals.length);
      setCleared(originals.length === 0 && seen > 0);
    }, () => undefined);
    check();
    return subscribeLibrary(check);
  }, []);
  // The model download is exactly when the risk picture changes, so re-read
  // the meter alongside it rather than on an interval nobody needs.
  useEffect(() => { void navigator.storage?.estimate?.().then((estimate) => setUsageBucket(Math.round((estimate.usage ?? 0) / 104_857_600)), () => undefined); }, [progress]);
  useEffect(() => { if (error === "persistence_denied") setBlockedByPersistence(true); }, [error]);

  const notice = cleared ? "cleared" : lost ? "lost" : "risk";
  const [dismissedNotice, dismissedBucket] = dismissed.split("@");
  // Granted, still checking, or this exact warning put away for the session at
  // this size — a bigger library re-raises it.
  if (persisted !== false || (dismissedNotice === notice && Number(dismissedBucket ?? 0) >= usageBucket)) return null;

  const dismiss = () => { const key = `${notice}@${usageBucket}`; dismissedForSession.set(key); setDismissed(key); };

  return <div className={styles.notice} role={(lost || cleared) && persistence !== "granted" ? "alert" : "status"}>
    {persistence === "granted" ? <ShieldCheck className={styles.granted} aria-hidden /> : <ShieldWarning aria-hidden />}
    <p>
      {persistence === "granted"
        ? <><b>Your browser granted persistent storage.</b> Songs, stems and takes now stay on this device until you delete them. A backup is still the only thing that survives losing this browser profile.</>
        : lost
        ? <><b>This browser has already deleted audio from your library.</b> The affected songs are marked “Audio missing” in your Library; re-import the source file from your computer to play one again. Their lyrics, charts and practice settings are untouched.</>
        : cleared
        ? <><b>Your Atarang library is empty.</b> If you did not delete these songs yourself, this browser cleared the app's storage. Restore a backup from Settings → Storage, or import your songs again.</>
        : evicted
        ? <><b>The separation model was reclaimed by this browser.</b> Storage here is not persistent, so songs, stems and takes can go the same way.</>
        : <><b>This browser can reclaim Atarang's storage.</b> Songs, stems and recorded takes live on this device only, and are deleted without warning when space runs low.</>}
      {persistence === "denied" && <> Your browser declined the request. {PERSISTENCE_ADVICE}</>}
      {blockedByPersistence && <> The model was not downloaded: this browser will not protect the space it needs. {PERSISTENCE_ADVICE}</>}
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
