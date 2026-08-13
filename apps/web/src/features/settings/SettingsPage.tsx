import { useCallback, useEffect, useRef, useState } from "react";
import { CloudSlash, Cpu, Database, DownloadSimple, MusicNotesSimple, ShieldCheck, UploadSimple, Waveform } from "@phosphor-icons/react";
import { libraryUsage, putSetting } from "../../storage/repositories";
import {downloadBackup,restoreBackup} from "../../storage/backup";
import {userMessage} from "../../app/errorText";
import {listQuarantine,runIntegrityScan} from "../../storage/integrity";
import {useModelManager} from "../separation/useModelManager";
import {cloudCapabilities,getCloudConfiguration,setCloudConfiguration} from "../separation/cloudClient";
import {cloudErrorMessage} from "../separation/stageLabel";
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
  local_worker_stalled: "The performance test made no progress for 90 seconds and was stopped. The model is still installed; separation may still work.",
  local_capability_failed: "The performance test could not run on this device. The model is still installed; try Cloud separation if local separation also fails.",
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
  if (model.qualifying) return `Running optional performance test… ${Math.round(model.qualificationProgress * 100)}%`;
  const installed = model.models[0];
  if (!installed) return "No model installed";
  const capability = model.capability?.modelArtifactId === installed.id ? model.capability : null;
  if (capability?.status === "qualified") return `Ready · RTF ${capability.rtf?.toFixed(2)}`;
  if (capability?.status === "slow") return `Ready, but slower than cloud · RTF ${capability.rtf?.toFixed(2)}`;
  return "Ready · not benchmarked";
}
const formatBytes = (bytes: number) => bytes < 1_000_000 ? `${Math.round(bytes / 1_000)} KB` : bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1_000_000_000).toFixed(1)} GB`;

export function SettingsPage() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const[backupStatus,setBackupStatus]=useState(""),[quarantineCount,setQuarantineCount]=useState(0);const restoreInput=useRef<HTMLInputElement>(null);
  const model=useModelManager(),modelInput=useRef<HTMLInputElement>(null);
  const existingCloud=getCloudConfiguration();
  const[cloudOrigin,setCloudOrigin]=useState(existingCloud?.origin??location.origin),[cloudKey,setCloudKey]=useState(existingCloud?.deploymentKey??""),[cloudStatus,setCloudStatus]=useState(existingCloud?"Configured for this session.":"Not configured.");
  const refresh = useCallback(async () => { const [estimate, persisted, localBytes] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? false, libraryUsage()]); setStorage({ persisted, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, libraryBytes: localBytes }); }, []);
  useEffect(() => { void refresh();void runIntegrityScan().then(()=>listQuarantine()).then(items=>setQuarantineCount(items.length)); }, [refresh]);
  const requestPersistence = async () => { const granted = await navigator.storage.persist(); await putSetting("storage.persistence", { granted, checkedAt: new Date().toISOString() }); await refresh(); };
  const saveCloudConfiguration = async () => {
    // Parsed before anything else, because `new URL` on a half-typed address
    // throws the browser's own "Failed to construct 'URL': Invalid URL" — a
    // sentence about a constructor, shown to someone who mistyped a hostname.
    let origin: string;
    try { origin = new URL(cloudOrigin).origin; }
    catch { setCloudStatus("Enter the full server address, including https://, such as https://atarang.example.com."); return; }
    try {
      const value={origin,deploymentKey:cloudKey};
      setCloudStatus("Checking server…");
      await cloudCapabilities(value);
      setCloudConfiguration(value);
      setCloudStatus("Server capability verified for this session.");
    } catch (error) {
      setCloudConfiguration(null);
      setCloudStatus(cloudErrorMessage(error));
    }
  };
  return <div className={styles.page}><header><h1>Settings</h1><p>Storage, audio, privacy, and capabilities.</p></header>
    <div className={styles.layout}><nav aria-label="Settings sections"><a href="#storage" className={styles.selected}><Database/>Storage</a><a href="#audio"><Waveform/>Audio</a><a href="#chords"><MusicNotesSimple/>Chords</a><a href="#models"><Cpu/>Models</a><a href="#privacy"><ShieldCheck/>Privacy</a></nav>
      <div className={styles.content}>
        <section id="storage"><h2>Browser storage</h2><p>Atarang stores your library locally using IndexedDB and the Origin Private File System.</p><dl><div><dt>Persistence</dt><dd className={storage?.persisted ? styles.good : ""}>{storage ? storage.persisted ? "Granted" : "Not granted" : "Checking…"}</dd></div><div><dt>Imported originals</dt><dd>{storage ? formatBytes(storage.libraryBytes) : "Checking…"}</dd></div><div><dt>Origin usage</dt><dd>{storage ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)}` : "Checking…"}</dd></div><div><dt>Recovery notices</dt><dd>{quarantineCount||"None"}</dd></div></dl><div className={styles.actions}>{!storage?.persisted && <button className={styles.primary} onClick={() => void requestPersistence()}>Request persistent storage</button>}<button onClick={() => void refresh()}>Refresh usage</button></div><h3>Backup and restore</h3><p>Backups include originals, separated stems, takes, practice settings, lyrics, charts, and saved chord voicings. Every binary is checksum-verified before restore publishes anything.</p><div className={styles.actions}><button className={styles.primary} onClick={()=>{setBackupStatus("Preparing verified backup…");void downloadBackup(true).then(()=>setBackupStatus("Backup ready."),error=>setBackupStatus(userMessage(error,backupErrors,"The backup could not be written. Your library is unchanged.")))}}><DownloadSimple/>Backup library</button><button onClick={()=>restoreInput.current?.click()}><UploadSimple/>Restore backup</button><input ref={restoreInput} className="sr-only" type="file" accept=".zip,.atarang-backup.zip,application/zip" aria-label="Choose Atarang backup" onChange={event=>{const file=event.target.files?.[0];if(!file)return;setBackupStatus("Verifying backup…");void restoreBackup(file).then(result=>{setBackupStatus(`Restored ${result.originals} songs and ${result.performances} takes.`);void refresh()},error=>setBackupStatus(userMessage(error,restoreErrors,"The backup could not be restored. Your existing library is unchanged.")));event.target.value=""}}/></div>{backupStatus&&<p role="status">{backupStatus}</p>}</section>
        <section id="audio"><h2>Audio engine</h2><dl><div><dt>Cross-origin isolation</dt><dd className={crossOriginIsolated ? styles.good : ""}>{crossOriginIsolated ? "Enabled" : "Unavailable"}</dd></div><div><dt>Shared memory</dt><dd>{typeof SharedArrayBuffer === "undefined" ? "Transfer-buffer fallback" : "Available"}</dd></div><div><dt>Output</dt><dd>System default</dd></div></dl></section>
        <UserChordLibrary/>
        <section id="models"><h2>Browser separation model</h2><p>Download the four-stem model once to separate songs in this browser. Every model piece is checksum-verified before it is installed.</p><dl><div><dt>Installed models</dt><dd>{model.models.length?model.models.map(item=>item.manifest.modelId).join(", "):"None"}</dd></div><div><dt>Download size</dt><dd>{model.manifest?formatBytes(model.manifest.totalBytes):"Loading…"}</dd></div><div><dt>This browser</dt><dd className={model.models.length&&!model.qualifying?styles.good:""}>{deviceReadout(model)}</dd></div></dl><div className={styles.actions}>{model.manifest&&!model.progress&&!model.models.some(item=>item.id===model.manifest?.modelArtifactId)&&<button className={styles.primary} onClick={()=>void model.download()}><DownloadSimple/>Download browser model · {formatBytes(model.manifest.totalBytes)}</button>}{model.progress&&<button onClick={model.cancel}>Cancel download · {Math.round(model.progress.completedBytes/model.progress.totalBytes*100)}%</button>}{model.models[0]&&<button disabled={model.qualifying} onClick={()=>void model.probe(model.models[0]!.id)}><Cpu/>{model.qualifying?`Testing… ${Math.round(model.qualificationProgress*100)}%`:"Test performance (optional)"}</button>}{model.qualifying&&<button onClick={model.cancel}>Cancel test</button>}</div>{model.manifest&&<p role="status">{model.models.some(item=>item.id===model.manifest?.modelArtifactId)?"The browser model is installed and enabled. The optional test only measures this device’s performance and continues if you visit Library or Studio.":"The built-in model is ready for an explicit, verified download."}</p>}<details className={styles.advanced}><summary>Advanced model package</summary><p>Only use this if you maintain a separately reviewed Atarang model manifest.</p><button onClick={()=>modelInput.current?.click()}><UploadSimple/>Import a model manifest</button><input ref={modelInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Import a model manifest" onChange={event=>{const file=event.target.files?.[0];if(file)void model.importManifest(file);event.target.value=""}}/></details>{model.error&&<p role="alert">{modelErrorMessage(model.error)}</p>}</section>
        <section id="privacy"><h2>Cloud processing</h2><div className={styles.notice}><CloudSlash/><div><strong>Cloud is never automatic</strong><p>Audio only leaves this browser after per-operation confirmation.</p></div></div><div className={styles.cloudForm}><label>Server origin<input type="url" value={cloudOrigin} onChange={event=>setCloudOrigin(event.target.value)} placeholder="https://atarang.example.com"/></label><label>Deployment key<input type="password" value={cloudKey} onChange={event=>setCloudKey(event.target.value)} autoComplete="off" placeholder="Session-only operator key"/></label><p>The deployment key remains in session storage and is cleared when this tab session ends. It is not included in backups.</p><div className={styles.actions}><button className={styles.primary} onClick={()=>void saveCloudConfiguration()}>Save and test</button><button onClick={()=>{setCloudConfiguration(null);setCloudKey("");setCloudStatus("Session configuration cleared.")}}>Clear session</button></div><p role="status">{cloudStatus}</p></div></section>
      </div>
    </div>
  </div>;
}
