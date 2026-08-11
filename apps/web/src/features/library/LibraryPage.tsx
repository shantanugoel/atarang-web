import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, ClockCounterClockwise, FileAudio, FolderOpen, HardDrives, MagnifyingGlass, Plus, SpinnerGap, Trash, WarningCircle, YoutubeLogo } from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router";
import { importLocalFile, type ImportProgress } from "../../storage/importer";
import { removeOriginal } from "../../storage/repositories";
import { importSeparationPackage } from "../separation/separationImporter";
import { cloudCapabilities, getCloudConfiguration, runYouTubeSeparation, type CloudProgress } from "../separation/cloudClient";
import { useLibrary } from "./useLibrary";
import styles from "./LibraryPage.module.css";

const formatDuration = (timeUs: number) => { const seconds = Math.round(timeUs / 1_000_000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,"0")}`; };
const formatBytes = (bytes: number) => bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1_000))} KB` : bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1_000_000_000).toFixed(2)} GB`;
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
const errorText: Record<string,string> = { unsupported_format: "This audio format is not supported by this browser.", media_too_large: "Choose audio under 20 minutes and 1 GB.", quota_exceeded: "Not enough browser storage is available for a safe import.", storage_unavailable: "Browser storage is unavailable. Your library was not changed." };

export function LibraryPage() {
  const { songs, usage, loading } = useLibrary();
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [youtubeProcessing, setYoutubeProcessing] = useState<"server"|"browser">("server");
  const [youtubeEnabled, setYoutubeEnabled] = useState<boolean | null>(null);
  const [youtubeProgress, setYoutubeProgress] = useState<CloudProgress | null>(null);
  const youtubeController = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const filteredSongs = useMemo(() => songs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(query.toLowerCase())), [query, songs]);
  const cloud = getCloudConfiguration();
  const importing = progress !== null || youtubeProgress !== null;

  useEffect(() => {
    let active = true;
    if (!cloud) { setYoutubeEnabled(false); return; }
    void cloudCapabilities(cloud).then((value: {youtubeEnabled?:boolean}) => { if (active) setYoutubeEnabled(Boolean(value.youtubeEnabled)); }, () => { if (active) setYoutubeEnabled(false); });
    return () => { active = false; };
  }, [cloud?.origin, cloud?.deploymentKey]);

  const importFile = async (file?: File) => {
    if (!file || importing) return;
    setError("");
    try {
      const song = await importLocalFile(file, setProgress);
      setProgress(null);
      await navigate(`/studio/${song.id}`);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "storage_unavailable";
      setProgress(null); setError(errorText[code] ?? "Import failed safely. Your existing library was not changed.");
    } finally { if (inputRef.current) inputRef.current.value = ""; }
  };

  const progressPercent = progress?.totalBytes ? Math.round(progress.completedBytes / progress.totalBytes * 100) : 0;
  const fetchYoutube = async () => {
    if (!cloud || !youtubeEnabled || !rightsConfirmed || importing) return;
    setError("");
    const controller = new AbortController(); youtubeController.current = controller;
    try {
      const result = await runYouTubeSeparation(youtubeUrl, cloud, setYoutubeProgress, controller.signal, (file) => importLocalFile(file, setProgress), youtubeProcessing);
      if(result.files)await importSeparationPackage(result.original, result.files, () => undefined);
      try { await result.purge(); } catch { setError("Imported successfully; temporary result cleanup will retry by retention policy."); }
      setYoutubeUrl(""); setRightsConfirmed(false);
      await navigate(`/studio/${result.original.id}`);
    } catch (caught) {
      setError(controller.signal.aborted ? "YouTube acquisition cancelled. Any source already verified and imported into your Library is retained." : caught instanceof Error ? caught.message : "youtube_acquisition_failed");
    } finally { setProgress(null); setYoutubeProgress(null); youtubeController.current = null; }
  };
  const removeSong = async (id: string, title: string) => { if (window.confirm(`Remove “${title}” and its generated audio from this browser? This never affects the source file on your computer.`)) await removeOriginal(id); };
  return <div className={styles.page} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
    <header><div><h1>Library</h1><p>Your music stays in this browser.</p></div><button className={styles.import} disabled={importing} onClick={() => inputRef.current?.click()}>{importing ? <SpinnerGap className={styles.spin}/> : <Plus weight="bold"/>}{importing ? "Importing…" : "Import audio"}</button><input ref={inputRef} className="sr-only" aria-label="Choose audio to import" type="file" accept="audio/*,.flac" onChange={(event) => void importFile(event.target.files?.[0])}/></header>
    {progress && <div className={styles.progress} role="status"><SpinnerGap className={styles.spin}/><div><strong>{progress.phase === "preflight" ? "Checking storage and audio" : progress.phase === "writing" ? "Writing to protected staging" : progress.phase === "verifying" ? "Verifying content-addressed copy" : "Publishing to your Library"}</strong><span>{progress.phase === "preflight" ? "Nothing appears in the Library until verification passes." : `${progressPercent}% complete`}</span></div><progress max="100" value={progressPercent}/></div>}
    {youtubeProgress && <div className={styles.progress} role="status"><SpinnerGap className={styles.spin}/><div><strong>{youtubeProgress.stage.replaceAll("_", " ")}</strong><span>{Math.round(youtubeProgress.progress*100)}% · successful acquisitions are reused on this server</span></div><progress max="100" value={youtubeProgress.progress*100}/><button onClick={()=>youtubeController.current?.abort(new Error("cancelled"))}>Cancel</button></div>}
    {error && <div className={styles.error} role="alert"><WarningCircle weight="fill"/><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <section className={styles.youtube} aria-labelledby="youtube-heading"><YoutubeLogo weight="fill"/><div><h2 id="youtube-heading">Fetch from YouTube</h2><p>{youtubeEnabled ? "The authorized server fetches and deduplicates the source. Choose where separation runs." : cloud ? "The saved deployment key was rejected, or YouTube acquisition is disabled." : "Configure this server and its session-only deployment key in Settings."}</p></div>{youtubeEnabled&&<form onSubmit={event=>{event.preventDefault();void fetchYoutube()}}><label><span>YouTube URL</span><input type="url" value={youtubeUrl} onChange={event=>setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" required/></label><fieldset className={styles.processing}><legend>Separation</legend><label><input type="radio" name="youtube-processing" value="server" checked={youtubeProcessing==="server"} onChange={()=>setYoutubeProcessing("server")}/><span><b>Separate on server</b> Uses this host’s GPU and imports four finished stems.</span></label><label><input type="radio" name="youtube-processing" value="browser" checked={youtubeProcessing==="browser"} onChange={()=>setYoutubeProcessing("browser")}/><span><b>Fetch only; separate in this browser</b> Imports the source, then opens Studio for local separation.</span></label></fieldset><label className={styles.rights}><input type="checkbox" checked={rightsConfirmed} onChange={event=>setRightsConfirmed(event.target.checked)}/><span>I confirm I am authorized to download and process this content.</span></label><button disabled={!youtubeUrl||!rightsConfirmed||importing}>{youtubeProgress?"Working…":youtubeProcessing==="server"?"Fetch and separate":"Fetch to browser"}</button></form>}</section>
    <div className={styles.toolbar}><label><MagnifyingGlass/><span className="sr-only">Search library</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search songs"/></label><button><ClockCounterClockwise/> Recently added</button></div>
    <section className={styles.table} aria-label="Songs">
      <div className={styles.tableHead}><span>Song</span><span>Duration</span><span>Added</span><span>Assets</span><span>Actions</span></div>
      {!loading && filteredSongs.length === 0 && <div className={styles.empty}><FileAudio weight="thin"/><strong>{query ? "No matching songs" : "Import your first song"}</strong><p>{query ? "Try a different title or artist." : "Drop an audio file here, or choose Import audio. Files remain on this device."}</p>{!query && <button onClick={() => inputRef.current?.click()}><FolderOpen/> Choose audio</button>}</div>}
      {filteredSongs.map((song) => <div className={styles.row} key={song.id}>
        <span className={styles.art}><FileAudio weight="duotone"/></span>
        <span className={styles.song}><strong>{song.title}</strong><small>{song.artist}</small></span>
        <span>{formatDuration(song.durationUs)}</span><span>{formatDate(song.createdAt)}</span><span className={styles.asset}><CheckCircle weight="fill"/> {"separated" in song && song.separated ? "4 stems" : "Original"}</span>
        <span className={styles.rowActions}><Link to={`/studio/${song.id}`}>Open</Link><button aria-label={`Remove ${song.title}`} onClick={() => void removeSong(song.id, song.title)}><Trash/></button></span>
      </div>)}
    </section>
    <footer><span><HardDrives/> {formatBytes(usage)} used by local audio assets</span><Link to="/settings"><FolderOpen/> Manage storage</Link></footer>
  </div>;
}
