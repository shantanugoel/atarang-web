import { useEffect, useRef, useState } from "react";
import { Cloud, FileArrowUp, Gauge, HardDrives, SpinnerGap, X } from "@phosphor-icons/react";
import type { OriginalRecord } from "../../../storage/database";
import { getCloudConfiguration, runCloudSeparation } from "../../separation/cloudClient";
import { qualifiedLocalRoute, runLocalSeparation } from "../../separation/localSeparation";
import styles from "./SeparationSheet.module.css";

interface Props { original: OriginalRecord; onClose(): void; onImportPackage(): void; onCloudPackage(files: File[], purge: () => Promise<void>): Promise<void> }
type Progress = { stage: string; progress: number };
type LocalRoute = Awaited<ReturnType<typeof qualifiedLocalRoute>>;

export function SeparationSheet({ original, onClose, onImportPackage, onCloudPackage }: Props) {
  const config = getCloudConfiguration();
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [localRoute, setLocalRoute] = useState<LocalRoute>(null);
  const [routeChecked, setRouteChecked] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sheet = useRef<HTMLElement>(null);
  const close = () => { if (!progress) onClose(); };

  useEffect(() => { let active = true; void qualifiedLocalRoute().then((route) => { if (active) { setLocalRoute(route); setRouteChecked(true); } }); return () => { active = false; }; }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !controller.current) onClose();
      if (event.key !== "Tab" || !sheet.current) return;
      const values = Array.from(sheet.current.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input:not(:disabled)"));
      if (!values.length) return;
      const first = values[0]!;
      const last = values.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);

  const startCloud = async () => {
    if (!config) return;
    setError("");
    const active = new AbortController();
    controller.current = active;
    try {
      const result = await runCloudSeparation(original, config, setProgress, active.signal);
      await onCloudPackage(result.files, result.purge);
      onClose();
    } catch (value) {
      setError(active.signal.aborted ? "Cancelled. Server cleanup was requested." : value instanceof Error ? value.message : "separation_failed");
    } finally {
      setProgress(null);
      controller.current = null;
    }
  };

  const startLocal = async () => {
    if (!localRoute) return;
    setError("");
    const active = new AbortController();
    controller.current = active;
    try {
      await runLocalSeparation(original, localRoute.model, localRoute.capability, setProgress, active.signal);
      onClose();
    } catch (value) {
      setError(active.signal.aborted ? "Local separation cancelled; no result was published." : value instanceof Error ? value.message : "separation_failed");
    } finally {
      setProgress(null);
      controller.current = null;
    }
  };

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={sheet} tabIndex={-1} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="separation-title"><header><div><h2 id="separation-title">{confirm ? "Confirm cloud upload" : "Separate this song"}</h2><p>{confirm ? "Review exactly what leaves this browser." : "Choose where the verified four-stem result comes from."}</p></div><button aria-label="Close separation options" onClick={close} disabled={Boolean(progress)}><X /></button></header>
    {progress ? <div className={styles.consent}><div className={styles.running} role="status"><SpinnerGap />{progress.stage.replaceAll("_", " ")} · {Math.round(progress.progress * 100)}%<button onClick={() => controller.current?.abort(new Error("cancelled"))}>Cancel</button></div><p>The operation publishes all four verified stems atomically. Cancelling leaves the current Library item unchanged.</p></div>
      : confirm && config ? <div className={styles.consent}><Cloud /><dl><div><dt>Server</dt><dd>{config.origin}</dd></div><div><dt>Audio upload</dt><dd>{(original.byteLength / 1_000_000).toFixed(1)} MB</dd></div><div><dt>Model</dt><dd>HTDemucs · four stems</dd></div><div><dt>Input deletion</dt><dd>Immediately after verified packaging</dd></div><div><dt>Result expiry</dt><dd>24 hours, or immediately after local import</dd></div></dl><p><strong>This audio will leave this browser.</strong> The deployment key is kept only for this browser session.</p><div className={styles.consentActions}><button onClick={() => setConfirm(false)}>Back</button><button className={styles.confirm} onClick={() => void startCloud()}>Confirm upload</button></div>{error && <p role="alert">Cloud job failed safely: {error}</p>}</div>
        : <div className={styles.routes}><article aria-disabled={!localRoute}><Gauge /><div><strong>Local on this device</strong><span>{!routeChecked ? "Checking the exact model and device qualification…" : localRoute ? `${localRoute.capability.status === "slow" ? "Cloud is recommended, but Local is available" : "Qualified for Local"} at measured RTF ${localRoute.capability.rtf?.toFixed(2)}. Audio stays in this browser.` : "Unavailable until the exact model and device pass the 30-second correctness, memory, and speed qualification."}</span></div><button disabled={!localRoute} onClick={() => void startLocal()}>{localRoute ? "Start local" : routeChecked ? "Not qualified" : "Checking…"}</button></article><article aria-disabled={!config}><Cloud /><div><strong>Cloud on your server</strong><span>{config ? `Configured for ${config.origin}. A separate consent screen appears before every upload.` : "Configure a server and session-only deployment key in Settings. Audio is never uploaded automatically."}</span></div><button disabled={!config} onClick={() => setConfirm(true)}>{config ? "Review upload" : "Unavailable"}</button></article><article><HardDrives /><div><strong>Verified package</strong><span>Import a canonical manifest plus vocals, drums, bass, and other files generated elsewhere.</span></div><button onClick={onImportPackage}><FileArrowUp />Import package</button></article>{error && <p role="alert">Separation failed safely: {error}</p>}</div>}
    <footer>Local availability is device-specific and expires after 30 days. A remembered preference never bypasses these checks.</footer></section></div>;
}
