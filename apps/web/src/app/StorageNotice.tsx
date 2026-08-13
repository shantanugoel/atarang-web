import { DownloadSimple, ShieldWarning, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useModelManager } from "../features/separation/useModelManager";
import styles from "./StorageNotice.module.css";

// This renders inside the root layout, and reading sessionStorage throws where
// storage is blocked for the origin. A reassurance banner must not be able to
// take the whole application down.
const dismissedForSession = { get: () => { try { return sessionStorage.getItem("atarang.storage.notice") === "1"; } catch { return false; } }, set: () => { try { sessionStorage.setItem("atarang.storage.notice", "1"); } catch { /* Then it comes back on the next page. */ } } };

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
  const [declined, setDeclined] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedForSession.get);
  const { evicted, manifest, progress, download } = useModelManager();

  useEffect(() => { void (navigator.storage?.persisted?.() ?? Promise.resolve(true)).then(setPersisted, () => setPersisted(true)); }, []);

  // Granted, still checking, or put away for this session. Nothing to say.
  if (persisted !== false || dismissed) return null;

  const request = async () => {
    const granted = await navigator.storage.persist();
    setPersisted(granted);
    setDeclined(!granted);
  };
  const dismiss = () => { dismissedForSession.set(); setDismissed(true); };

  return <div className={styles.notice} role="status">
    <ShieldWarning aria-hidden />
    <p>
      {evicted
        ? <><b>The separation model was reclaimed by this browser.</b> Storage here is not persistent, so songs, stems and takes can go the same way.</>
        : <><b>This browser can reclaim Atarang's storage.</b> Songs, stems and recorded takes live on this device only, and are deleted without warning when space runs low.</>}
      {declined && <> Your browser declined the request — it usually grants persistence once a site is bookmarked, installed, or used regularly. Until then, keep a backup.</>}
    </p>
    <div className={styles.actions}>
      {evicted && manifest && <button className={styles.primary} disabled={Boolean(progress)} onClick={() => void download()}>
        <DownloadSimple aria-hidden />{progress ? `Downloading… ${Math.round(progress.completedBytes / progress.totalBytes * 100)}%` : "Download model again"}
      </button>}
      {!declined && <button onClick={() => void request()}>Keep my library</button>}
      <button className={styles.dismiss} aria-label="Dismiss storage notice" onClick={dismiss}><X aria-hidden /></button>
    </div>
  </div>;
}
