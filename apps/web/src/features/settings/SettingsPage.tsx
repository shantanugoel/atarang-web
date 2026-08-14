import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CloudSlash, Cpu, Database, DownloadSimple, Info, MusicNotesSimple, ShieldCheck, UploadSimple, Waveform } from "@phosphor-icons/react";
import {appVersion} from "../../generated/app-version";
import {REPOSITORY, detectedCloudOrigin, useCloudAvailability} from "../separation/cloudAvailability";
import { libraryUsage, putSetting } from "../../storage/repositories";
import {downloadBackup,restoreBackup} from "../../storage/backup";
import {userMessage} from "../../app/errorText";
import {listQuarantine,runIntegrityScan} from "../../storage/integrity";
import {useModelManager} from "../separation/useModelManager";
import {cloudCapabilities,getCloudConfiguration,setCloudDeploymentKey} from "../separation/cloudClient";
import {cloudErrorMessage,separationEstimate} from "../separation/stageLabel";
import styles from "./SettingsPage.module.css";
import{UserChordLibrary}from"../chords/UserChordLibrary";

interface StorageStatus { persisted: boolean; usage: number; quota: number; libraryBytes: number }

const modelErrors: Record<string, string> = {
  built_in_model_unavailable: "This site does not publish the browser separation model, so local separation is unavailable here. Cloud separation and verified packages still work.",
  quota_exceeded: "There is not enough browser storage for the model. Free some space and try again.",
  model_integrity_failed: "The downloaded model did not match its checksums, so nothing was installed.",
  model_download_failed: "The model download did not finish. Your existing setup was not changed.",
  model_source_not_allowed: "The manifest points somewhere this app will not download from. Nothing was installed.",
  cancelled: "Cancelled. Your setup is unchanged.",
  local_worker_stalled: "The speed test made no progress for 90 seconds and was stopped. The model is still installed; separation may still work.",
  local_capability_failed: "The speed test could not run on this device. The model is still installed; try Cloud separation if local separation also fails.",
  local_inference_busy: "Another test or separation is already running. Cancel it before starting this one.",
};
const modelErrorMessage = (code: string) => userMessage(code, modelErrors, "The model operation stopped safely. Your setup is unchanged.");

// Backup and restore fail for different reasons and leave the user in different
// places, so they get separate sentences rather than one shared "it failed".
const backupErrors: Record<string, string> = {
  backup_too_large_for_zip32: "This library is too large for a single backup file. Remove some separated stems or takes and try again.",
  backup_integrity_failed: "A file changed while the backup was being written, so it was discarded rather than saved incomplete.",
  quota_exceeded: "There is not enough free space to assemble the backup. Free some room on this device and try again.",
  storage_unavailable: "Browser storage became unavailable while reading your library. Nothing was changed.",
};
const restoreErrors: Record<string, string> = {
  invalid_backup_zip: "This is not an Atarang backup file.",
  invalid_backup_manifest: "This backup is missing its manifest, or the manifest is unreadable.",
  invalid_backup_central_directory: "This backup file is damaged and could not be opened.",
  invalid_backup_local_header: "This backup file is damaged and could not be opened.",
  backup_crc_mismatch: "A file inside this backup failed its checksum, so nothing was restored.",
  backup_integrity_failed: "This backup did not match its own checksums, so nothing was restored.",
  result_integrity_failed: "A restored file did not match its checksum, so nothing was published.",
  quota_exceeded: "There is not enough browser storage to restore this backup. Free some space and try again.",
  storage_unavailable: "Browser storage is unavailable, so nothing was restored.",
};

// A capability record outlives the weights it measured, so readiness has to be
// answered by the installed model first and the benchmark only after.
function deviceReadout(model: ReturnType<typeof useModelManager>) {
  if (model.qualifying) return `Running optional speed test… ${Math.round(model.qualificationProgress * 100)}%`;
  const installed = model.models[0];
  if (!installed) return "No model installed";
  const capability = model.capability?.modelArtifactId === installed.id ? model.capability : null;
  if (capability?.rtf === undefined) return "Ready · speed not measured";
  if (capability.status === "qualified") return `Ready · ${separationEstimate(capability.rtf)}`;
  if (capability.status === "slow") return `Ready, but slower than cloud · ${separationEstimate(capability.rtf)}`;
  return "Ready · speed not measured";
}
const formatBytes = (bytes: number) => bytes < 1_000_000 ? `${Math.round(bytes / 1_000)} KB` : bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1_000_000_000).toFixed(1)} GB`;
// One list, so the picker, the side navigation and the fallback cannot disagree
// about which sections exist or which one you are looking at.
const SETTING_SECTIONS=[
  {id:"about",label:"About",icon:Info},
  {id:"storage",label:"Storage",icon:Database},
  {id:"audio",label:"Audio",icon:Waveform},
  {id:"chords",label:"Chords",icon:MusicNotesSimple},
  {id:"models",label:"Models",icon:Cpu},
  {id:"privacy",label:"Privacy",icon:ShieldCheck},
] as const;
const settingSection=()=>SETTING_SECTIONS.find(section=>location.hash===`#${section.id}`)?.id??"about";

/** The mark from the browser tab, at a size you can actually see. */
const AtarangMark=()=>(
  <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="7" fill="var(--accent)"/>
    <path d="M13 8.5 22 6.6v11.6a3.1 3.1 0 1 1-2-2.9V11l-5 1.1v8.6a3.1 3.1 0 1 1-2-2.9z" fill="#fff"/>
  </svg>
);

export function SettingsPage() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const[backupStatus,setBackupStatus]=useState(""),[quarantineCount,setQuarantineCount]=useState(0);const restoreInput=useRef<HTMLInputElement>(null);
  const model=useModelManager(),modelInput=useRef<HTMLInputElement>(null);
  const cloudAvailable=useCloudAvailability();
  const existingCloud=getCloudConfiguration();
  const[cloudKey,setCloudKey]=useState(existingCloud?.deploymentKey??""),[cloudStatus,setCloudStatus]=useState("");
  const[section,setSection]=useState(settingSection);
  const refresh = useCallback(async () => { const [estimate, persisted, localBytes] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? false, libraryUsage()]); setStorage({ persisted, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, libraryBytes: localBytes }); }, []);
  useEffect(() => { void refresh();void runIntegrityScan().then(()=>listQuarantine()).then(items=>setQuarantineCount(items.length)); }, [refresh]);
  useEffect(()=>{const sync=()=>{const next=settingSection();setSection(next);if(location.hash){if(location.hash!==`#${next}`)history.replaceState(history.state,"",`#${next}`);document.getElementById(next)?.scrollIntoView()}};sync();addEventListener("hashchange",sync);return()=>removeEventListener("hashchange",sync)},[]);
  const requestPersistence = async () => { const granted = await navigator.storage.persist(); await putSetting("storage.persistence", { granted, checkedAt: new Date().toISOString() }); await refresh(); };
  const saveCloudConfiguration = async () => {
    // The address is whatever detection found, so the only way to get here
    // without one is a deployment that has no server — which the notice above
    // the form already explains.
    const origin = detectedCloudOrigin();
    if (!origin) { setCloudStatus("There is no server on this deployment to save a key for."); return; }
    try {
      setCloudStatus("Checking server…");
      await cloudCapabilities({origin,deploymentKey:cloudKey});
      setCloudDeploymentKey(cloudKey);
      setCloudStatus("Server reached and accepted your key. Saved in this browser.");
    } catch (error) {
      setCloudDeploymentKey(null);
      setCloudStatus(cloudErrorMessage(error));
    }
  };
  return <div className={styles.page}><header><h1>Settings</h1><p>Storage, audio, privacy, and capabilities.</p></header>
    <div className={styles.layout}><label className={styles.sectionPicker}>Settings section<select aria-label="Settings section" value={`#${section}`} onChange={event=>{location.hash=event.target.value}}>{SETTING_SECTIONS.map(({id,label})=><option key={id} value={`#${id}`}>{label}</option>)}</select></label><nav aria-label="Settings sections">{SETTING_SECTIONS.map(({id,label,icon:Icon})=><a key={id} href={`#${id}`} aria-current={section===id?"true":undefined}><Icon/>{label}</a>)}</nav>
      <div className={styles.content}>
        <section id="about"><h2>About</h2>
          <div className={styles.about}>
            <AtarangMark/>
            <div><strong>Atarang</strong><p>Separate songs into stems, mix them the way you need, and record yourself playing along. Everything happens in this browser.</p></div>
          </div>
          <dl className={styles.aboutFacts}><div><dt>Version</dt><dd>{appVersion}</dd></div><div><dt>Author</dt><dd>Shantanu Goel</dd></div></dl>
          <div className={styles.actions}><a className={styles.link} href={REPOSITORY} target="_blank" rel="noreferrer">View the project on GitHub<ArrowSquareOut/></a></div>
        </section>
        <section id="storage"><h2>Browser storage</h2><p>Your songs, stems, takes and settings are kept in this browser, on this device. Nothing is sent anywhere unless you ask for it.</p><dl><div><dt>Protected from cleanup</dt><dd className={storage?.persisted ? styles.good : ""}>{storage ? storage.persisted ? "Yes" : "No" : "Checking…"}</dd></div><div><dt>Songs you imported</dt><dd>{storage ? formatBytes(storage.libraryBytes) : "Checking…"}</dd></div><div><dt>Everything Atarang stores</dt><dd>{storage ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)}` : "Checking…"}</dd></div><div><dt>Damaged files found</dt><dd>{quarantineCount||"None"}</dd></div></dl><div className={styles.actions}>{!storage?.persisted && <button className={styles.primary} onClick={() => void requestPersistence()}>Request persistent storage</button>}<button onClick={() => void refresh()}>Check again</button></div><h3>Backup and restore</h3><p>A backup holds your songs, separated stems, takes, practice settings, lyrics, charts and saved chord shapes. Every file is checked against its checksum before a restore puts anything back.</p><div className={styles.actions}><button className={styles.primary} onClick={()=>{setBackupStatus("Preparing verified backup…");void downloadBackup(true).then(()=>setBackupStatus("Backup ready."),error=>setBackupStatus(userMessage(error,backupErrors,"The backup could not be written. Your library is unchanged.")))}}><DownloadSimple/>Backup library</button><button onClick={()=>restoreInput.current?.click()}><UploadSimple/>Restore backup</button><input ref={restoreInput} className="sr-only" type="file" accept=".zip,.atarang-backup.zip,application/zip" aria-label="Choose Atarang backup" onChange={event=>{const file=event.target.files?.[0];if(!file)return;setBackupStatus("Verifying backup…");void restoreBackup(file).then(result=>{setBackupStatus(`Restored ${result.originals} songs and ${result.performances} takes.`);void refresh()},error=>setBackupStatus(userMessage(error,restoreErrors,"The backup could not be restored. Your existing library is unchanged.")));event.target.value=""}}/></div>{backupStatus&&<p role="status">{backupStatus}</p>}</section>
        {/* These two rows are a diagnostic, so they say what the user loses
            rather than which browser flag is missing. */}
        <section id="audio"><h2>Audio engine</h2><dl><div><dt>Four-stem playback</dt><dd className={crossOriginIsolated ? styles.good : ""}>{crossOriginIsolated ? "Available" : "Not available in this browser"}</dd></div><div><dt>Audio memory</dt><dd>{typeof SharedArrayBuffer === "undefined" ? "Copied between threads (a little slower)" : "Shared between threads"}</dd></div><div><dt>Output</dt><dd>System default</dd></div></dl></section>
        <UserChordLibrary/>
        <section id="models"><h2>Browser separation model</h2><p>Download the four-stem model once to separate songs in this browser. Every piece is checked against its checksum before anything is installed.</p><dl><div><dt>Installed models</dt><dd>{model.models.length?model.models.map(item=>item.manifest.modelId).join(", "):"None"}</dd></div><div><dt>Download size</dt><dd>{model.manifest?formatBytes(model.manifest.totalBytes):"Loading…"}</dd></div><div><dt>This browser</dt><dd className={model.models.length&&!model.qualifying?styles.good:""}>{deviceReadout(model)}</dd></div></dl><div className={styles.actions}>{model.manifest&&!model.progress&&!model.models.some(item=>item.id===model.manifest?.modelArtifactId)&&<button className={styles.primary} onClick={()=>void model.download()}><DownloadSimple/>Download browser model · {formatBytes(model.manifest.totalBytes)}</button>}{model.progress&&<button onClick={model.cancel}>Cancel download · {Math.round(model.progress.completedBytes/model.progress.totalBytes*100)}%</button>}{model.models[0]&&<button disabled={model.qualifying} onClick={()=>void model.probe(model.models[0]!.id)}><Cpu/>{model.qualifying?`Testing… ${Math.round(model.qualificationProgress*100)}%`:"Test this device's speed (optional)"}</button>}{model.qualifying&&<button onClick={model.cancel}>Cancel test</button>}</div>{model.manifest&&<p role="status">{model.models.some(item=>item.id===model.manifest?.modelArtifactId)?"The model is installed and ready. The optional test only measures how fast this device is, and keeps running if you go to Library or Studio.":"The model has not been downloaded yet."}</p>}<details className={styles.advanced}><summary>Advanced model package</summary><p>Only use this if you maintain a separately reviewed Atarang model manifest.</p><button onClick={()=>modelInput.current?.click()}><UploadSimple/>Import a model manifest</button><input ref={modelInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Import a model manifest" onChange={event=>{const file=event.target.files?.[0];if(file)void model.importManifest(file);event.target.value=""}}/></details>{model.error&&<p role="alert">{modelErrorMessage(model.error)}</p>}</section>
        <section id="privacy"><h2>Cloud processing</h2><div className={styles.notice}><CloudSlash/><div><strong>Cloud is never automatic</strong><p>Audio only leaves this browser after you confirm it, every time.</p></div></div>{cloudAvailable==="none"?<div className={styles.notice}><CloudSlash/><div><strong>This app has no server</strong><p>Cloud separation and fetching from YouTube run on a server you host yourself, and this deployment does not include one. Everything else works entirely in this browser. <a href={REPOSITORY} target="_blank" rel="noreferrer">Check GitHub to see how to host your own<ArrowSquareOut/></a></p></div></div>:<div className={styles.cloudForm}><label>Deployment key<input type="password" value={cloudKey} onChange={event=>setCloudKey(event.target.value)} autoComplete="off" placeholder="Operator key for this server"/></label><p>The server address comes with this app; only the key is yours to enter. It is remembered in this browser until you clear it, and is never included in a backup.</p><div className={styles.actions}><button className={styles.primary} onClick={()=>void saveCloudConfiguration()}>Save and test</button><button onClick={()=>{setCloudDeploymentKey(null);setCloudKey("");setCloudStatus("Saved key cleared.")}}>Forget key</button></div><p role="status">{cloudStatus||(existingCloud?"Saved in this browser.":cloudAvailable==="checking"?"Checking for a server…":"A server answered. Enter its deployment key.")}</p></div>}</section>
      </div>
    </div>
  </div>;
}
