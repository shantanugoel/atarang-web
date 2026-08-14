import { useEffect, useRef, useState } from "react";
import { Cloud, FileArrowUp, Gauge, HardDrives, SpinnerGap, X } from "@phosphor-icons/react";
import type { OriginalRecord } from "../../../storage/database";
import { getCloudConfiguration, runCloudSeparation } from "../../separation/cloudClient";
import { REPOSITORY, useCloudAvailability } from "../../separation/cloudAvailability";
import { localSeparationErrorMessage, probeLocalBrowser, qualifiedLocalRoute, runLocalSeparation, type LocalBrowserSupport } from "../../separation/localSeparation";
import { cloudErrorMessage, separationEstimate, stageLabel } from "../../separation/stageLabel";
import styles from "./SeparationSheet.module.css";

interface Props { original: OriginalRecord;replacing:boolean; onClose(): void; onImportPackage(): void; onCloudPackage(files: File[], purge: () => Promise<void>): Promise<void>;onLocalFailure(message:string):void }
type Progress = { stage: string; progress: number };
type LocalRoute = Awaited<ReturnType<typeof qualifiedLocalRoute>>;

export function SeparationSheet({ original,replacing, onClose, onImportPackage, onCloudPackage,onLocalFailure }: Props) {
  const availability = useCloudAvailability();
  const config = getCloudConfiguration();
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [localRoute, setLocalRoute] = useState<LocalRoute>(null);
  const [routeChecked, setRouteChecked] = useState(false);
  const [localSupport,setLocalSupport]=useState<LocalBrowserSupport|null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sheet = useRef<HTMLElement>(null);
  const close = () => { if (!progress) onClose(); };

  useEffect(() => { let active = true; void qualifiedLocalRoute().then(async(route) => {if(!active)return;setLocalRoute(route);const support=route?await probeLocalBrowser(route.model.id):null;if(active){setLocalSupport(support);setRouteChecked(true)}},()=>{if(active){setError("Browser separation availability could not be checked.");setRouteChecked(true)}}); return () => { active = false; controller.current?.abort(new Error("cancelled")); }; }, []);
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
    // Opened straight after an import there is nothing to go back to — the
    // Library and its file input unmounted on the way here — so focus is handed
    // to the Studio rather than dropped on the body and reset to page top.
    return () => { document.removeEventListener("keydown", onKey); const target = previous?.isConnected && previous !== document.body ? previous : document.querySelector<HTMLElement>("[role='tab']"); target?.focus(); };
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
      setError(active.signal.aborted ? "Cancelled. The server was asked to delete its copy of your audio." : cloudErrorMessage(value));
    } finally {
      setProgress(null);
      controller.current = null;
    }
  };

  const startLocal = async () => {
    if (!localRoute||!localSupport?.available) return;
    setError("");
    onLocalFailure("");
    const active = new AbortController();
    controller.current = active;
    try {
      await runLocalSeparation(original, localRoute.model, localRoute.capability, setProgress, active.signal);
      onClose();
    } catch (value) {
      const message=active.signal.aborted?"Local separation cancelled; no result was published.":localSeparationErrorMessage(value instanceof Error?value.message:"separation_failed");setError(message);onLocalFailure(message);
    } finally {
      setProgress(null);
      controller.current = null;
    }
  };

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={sheet} tabIndex={-1} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="separation-title"><header><div><h2 id="separation-title">{confirm ? "Confirm cloud upload" : replacing?"Separate this song again":"Separate this song"}</h2><p>{confirm ? "Review exactly what leaves this browser." : replacing?"The current stems stay available until all four replacements are verified.":"Choose where the four stems are made."}</p></div><button aria-label="Close separation options" onClick={close} disabled={Boolean(progress)}><X /></button></header>
    {progress ? <div className={styles.consent}><div className={styles.running} role="status"><SpinnerGap />{stageLabel(progress.stage)} · {Math.round(progress.progress * 100)}%<button onClick={() => controller.current?.abort(new Error("cancelled"))}>Cancel</button></div><p>All four stems are added together or not at all. Cancelling leaves this song exactly as it is.</p></div>
      : confirm && config ? <div className={styles.consent}><Cloud /><dl><div><dt>Server</dt><dd>{config.origin}</dd></div><div><dt>Audio upload</dt><dd>{(original.byteLength / 1_000_000).toFixed(1)} MB</dd></div><div><dt>Model</dt><dd>HTDemucs · four stems</dd></div><div><dt>Input deletion</dt><dd>Immediately after verified packaging</dd></div><div><dt>Result expiry</dt><dd>24 hours, or immediately after local import</dd></div></dl><p><strong>This audio will leave this browser.</strong> The deployment key is kept only for this browser session.</p><div className={styles.consentActions}><button onClick={() => setConfirm(false)}>Back</button><button className={styles.confirm} onClick={() => void startCloud()}>Confirm upload</button></div>{error && <p role="alert">Cloud job failed safely: {error}</p>}</div>
        : <div className={styles.routes}><article aria-disabled={!localRoute||!localSupport?.available}><Gauge /><div><strong>Local on this device</strong><span>{!routeChecked?"Checking the installed model and this device…":!localRoute?"Install the verified browser model in Settings to use local separation.":!localSupport?.available?localSeparationErrorMessage(localSupport?.reason??"webgpu_probe_failed"):localRoute.capability?.rtf!==undefined?`${localRoute.capability.status==="slow"?"Ready, but slower than cloud":"Measured and ready"} — ${separationEstimate(localRoute.capability.rtf)}. Audio stays in this browser.`:localSupport.backend==="wasm"?"No WebGPU adapter here, so this runs on the processor. Audio stays in this browser; expect several minutes per song.":"WebGPU is ready. The optional speed test in Settings is not required."}</span></div><button disabled={!localRoute||!localSupport?.available} onClick={() => void startLocal()}>{!routeChecked?"Checking…":!localRoute?"Model not installed":localSupport?.available?"Start local":"Unavailable here"}</button></article><article aria-disabled={!config}><Cloud /><div><strong>Cloud on your server</strong><span>{config ? `Configured for ${config.origin}. A separate consent screen appears before every upload.` : availability === "checking" ? "Checking whether this deployment has a server…" : availability === "found" ? "Enter the deployment key in Settings. Audio is never uploaded automatically." : <>Cloud separation runs on a server you host yourself, and this deployment does not include one. Audio is never uploaded automatically. Separate in this browser instead, or <a href={REPOSITORY} target="_blank" rel="noreferrer">host your own copy</a>.</>}</span></div><button disabled={!config} onClick={() => setConfirm(true)}>{config ? "Review upload" : availability === "none" ? "Self-hosted only" : "Unavailable"}</button></article><article><HardDrives /><div><strong>Verified package</strong><span>Import vocals, drums, bass and other files made elsewhere, along with the manifest that describes them.</span></div><button onClick={onImportPackage}><FileArrowUp />Import package</button></article>{error && <p role="alert">{error}</p>}<button className={styles.skip} onClick={close}>Skip for now and just play the song</button></div>}
    <footer>An installed model runs after a quick graphics check. The optional speed test is remembered for 30 days.</footer></section></div>;
}
