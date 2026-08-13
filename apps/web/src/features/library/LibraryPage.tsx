import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, ClockCounterClockwise, FileAudio, FolderOpen, HardDrives, MagnifyingGlass, Microphone, Plus, SpinnerGap, Trash, WarningCircle, Waveform, YoutubeLogo } from "@phosphor-icons/react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { importLocalFile, type ImportProgress } from "../../storage/importer";
import { getBlob, removeAnalysis, removeOriginal, removePerformance, removeSeparation } from "../../storage/repositories";
import { fileForOpfsPath } from "../../storage/opfs";
import { importSeparationPackage } from "../separation/separationImporter";
import { cloudCapabilities, getCloudConfiguration, runYouTubeSeparation, type CloudProgress } from "../separation/cloudClient";
import { stageLabel } from "../separation/stageLabel";
import { useLibrary } from "./useLibrary";
import styles from "./LibraryPage.module.css";
import demoUrl from "../../assets/backbeat.mp3";
import {DEMO_TRACK} from "../studio/useDemoAudio";

const formatDuration = (timeUs: number) => { const seconds = Math.round(timeUs / 1_000_000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,"0")}`; };
const formatBytes = (bytes: number) => bytes === 0 ? "0 KB" : bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1_000))} KB` : bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1_000_000_000).toFixed(2)} GB`;
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
const errorText: Record<string,string> = { unsupported_format: "This audio format is not supported by this browser.", media_too_large: "Choose audio under 20 minutes and 1 GB.", quota_exceeded: "Not enough browser storage is available for a safe import.", storage_unavailable: "Browser storage is unavailable. Your library was not changed." };

export function LibraryPage() {
  const { songs, performances, usage, categoryUsage, loading } = useLibrary();
  // In the URL, so Back returns to the list you were reading and a reload keeps
  // it. The search box below stays local: half-typed text is not a view.
  const [params,setParams]=useSearchParams();
  const category=(["originals","separated","performances"] as const).find(item=>item===params.get("category"))??"originals";
  const setCategory=(value:typeof category)=>setParams(value==="originals"?{}:{category:value},{replace:true});
  const [query, setQuery] = useState("");
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [previewId,setPreviewId]=useState<string>();
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
  const visibleSongs=filteredSongs.filter(song=>category!=="separated"||"separated" in song&&song.separated);
  const originalById=useMemo(()=>new Map(songs.map(song=>[song.id,song])),[songs]);
  const visiblePerformances=performances.filter(take=>{const song=originalById.get(take.originalId);return `${song?.title??""} ${song?.artist??""}`.toLowerCase().includes(query.toLowerCase())});
  const cloud = getCloudConfiguration();
  const importing = progress !== null || youtubeProgress !== null;

  useEffect(()=>{setSelected(new Set());setPreviewId(undefined)},[category]);
  useEffect(()=>setSelected(new Set()),[query]);

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
      // Landing straight in Studio silently decides for the user whether stems
      // get made. The sheet that already asks that question is one query
      // parameter away, and the demo row has always used it.
      await navigate(`/studio/${song.id}?separate=1`);
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
      await navigate(`/studio/${result.original.id}${result.files ? "" : "?separate=1"}`);
    } catch (caught) {
      setError(controller.signal.aborted ? "YouTube acquisition cancelled. Any source already verified and imported into your Library is retained." : caught instanceof Error ? caught.message : "youtube_acquisition_failed");
    } finally { setProgress(null); setYoutubeProgress(null); youtubeController.current = null; }
  };
  const removeSong = async (id: string, title: string) => { if (window.confirm(`Remove “${title}” and its generated audio from this browser? This never affects the source file on your computer.`)) await removeOriginal(id); };
  const removeSongAnalysis=async(id:string,title:string)=>{if(window.confirm(`Remove the waveform, beat grid and chord analysis for “${title}”? The song, lyrics, separation and takes stay.`))await removeAnalysis(id)};
  const removeSongSeparation=async(id:string,title:string)=>{if(window.confirm(`Remove the four separated stems for “${title}”? The original, analysis and takes stay.`))await removeSeparation(id)};
  const removeTake=async(id:string)=>{if(window.confirm("Remove this recorded take from this browser? This cannot be undone."))await removePerformance(id)};
  const selectionIds=category==="performances"?visiblePerformances.map(take=>take.id):visibleSongs.map(song=>song.id);
  const toggleSelected=(id:string)=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next});
  const removeSelected=async()=>{if(!selected.size)return;const label=category==="originals"?"songs and their generated assets":category==="separated"?"separations (the originals and takes stay)":"recorded takes";if(!window.confirm(`Remove ${selected.size} selected ${label}?`))return;try{for(const id of selected)await(category==="originals"?removeOriginal(id):category==="separated"?removeSeparation(id):removePerformance(id));setSelected(new Set())}catch{setError("Some selected items could not be removed. Nothing still referenced was deleted.")}};
  const addDemo=async()=>{if(importing)return;setError("");try{const response=await fetch(new URL(demoUrl,import.meta.url));const blob=await response.blob();const song=await importLocalFile(new File([blob],`${DEMO_TRACK.title}.mp3`,{type:"audio/mpeg"}),setProgress);setProgress(null);await navigate(`/studio/${song.id}?separate=1`)}catch(caught){setProgress(null);setError(caught instanceof Error?caught.message:"demo_import_failed")}};
  return <div className={styles.page} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
    <header><div><h1>Library</h1><p>Your music stays in this browser.</p></div><button className={styles.import} disabled={importing} onClick={() => inputRef.current?.click()}>{importing ? <SpinnerGap className={styles.spin}/> : <Plus weight="bold"/>}{importing ? "Importing…" : "Import audio"}</button><input ref={inputRef} className="sr-only" aria-label="Choose audio to import" type="file" accept="audio/*,.flac" onChange={(event) => void importFile(event.target.files?.[0])}/></header>
    {progress && <div className={styles.progress} role="status"><SpinnerGap className={styles.spin}/><div><strong>{progress.phase === "preflight" ? "Checking storage and audio" : progress.phase === "writing" ? "Writing to protected staging" : progress.phase === "verifying" ? "Verifying content-addressed copy" : "Publishing to your Library"}</strong><span>{progress.phase === "preflight" ? "Nothing appears in the Library until verification passes." : `${progressPercent}% complete`}</span></div><progress max="100" value={progressPercent}/></div>}
    {youtubeProgress && <div className={styles.progress} role="status"><SpinnerGap className={styles.spin}/><div><strong>{stageLabel(youtubeProgress.stage)}</strong><span>{Math.round(youtubeProgress.progress*100)}% · successful acquisitions are reused on this server</span></div><progress max="100" value={youtubeProgress.progress*100}/><button onClick={()=>youtubeController.current?.abort(new Error("cancelled"))}>Cancel</button></div>}
    {error && <div className={styles.error} role="alert"><WarningCircle weight="fill"/><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <section className={styles.youtube} aria-labelledby="youtube-heading"><YoutubeLogo weight="fill"/><div><h2 id="youtube-heading">Fetch from YouTube</h2><p>{youtubeEnabled ? "The authorized server fetches and deduplicates the source. Choose where separation runs." : cloud ? "The saved deployment key was rejected, or YouTube acquisition is disabled." : "Configure this server and its session-only deployment key in Settings."}</p></div>{youtubeEnabled&&<form onSubmit={event=>{event.preventDefault();void fetchYoutube()}}><label><span>YouTube URL</span><input type="url" value={youtubeUrl} onChange={event=>setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" required/></label><fieldset className={styles.processing}><legend>Separation</legend><label><input type="radio" name="youtube-processing" value="server" checked={youtubeProcessing==="server"} onChange={()=>setYoutubeProcessing("server")}/><span><b>Separate on server</b> Uses this host’s GPU and imports four finished stems.</span></label><label><input type="radio" name="youtube-processing" value="browser" checked={youtubeProcessing==="browser"} onChange={()=>setYoutubeProcessing("browser")}/><span><b>Fetch only; separate in this browser</b> Imports the source, then opens Studio for local separation.</span></label></fieldset><label className={styles.rights}><input type="checkbox" checked={rightsConfirmed} onChange={event=>setRightsConfirmed(event.target.checked)}/><span>I confirm I am authorized to download and process this content.</span></label><button disabled={!youtubeUrl||!rightsConfirmed||importing}>{youtubeProgress?"Working…":youtubeProcessing==="server"?"Fetch and separate":"Fetch to browser"}</button></form>}</section>
    <nav className={styles.categories} aria-label="Library category">{(["originals","separated","performances"] as const).map(item=><button key={item} aria-current={category===item?"page":undefined} onClick={()=>setCategory(item)}>{item[0]!.toUpperCase()+item.slice(1)}<span>{item==="performances"?performances.length:item==="separated"?songs.filter(song=>"separated" in song&&song.separated).length:songs.length+(songs.some(song=>song.contentSha256===DEMO_TRACK.sha256)?0:1)}</span><small>{formatBytes(categoryUsage[item])}</small></button>)}</nav>
    <div className={styles.toolbar}><label><MagnifyingGlass/><span className="sr-only">Search library</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${category}`}/></label>{selected.size?<button className={styles.bulkRemove} onClick={()=>void removeSelected()}><Trash/>Remove selected ({selected.size})</button>:<span className={styles.sortNote}><ClockCounterClockwise/> Newest first</span>}</div>
    <section className={styles.table} aria-label="Songs">
      <div className={styles.tableHead}><span><input type="checkbox" aria-label="Select all visible items" checked={selectionIds.length>0&&selectionIds.every(id=>selected.has(id))} onChange={()=>setSelected(selectionIds.every(id=>selected.has(id))?new Set():new Set(selectionIds))}/>Song</span><span>Duration</span><span>Added</span><span>Assets</span><span>Actions</span></div>
      {category==="originals"&&!songs.some(song=>song.contentSha256===DEMO_TRACK.sha256)&&!query&&<div className={`${styles.row} ${styles.demoRow}`}><span className={styles.art}><FileAudio weight="duotone"/></span><span className={styles.song}><strong>{DEMO_TRACK.title} <small>DEMO</small></strong><small>{DEMO_TRACK.artist} · {DEMO_TRACK.license}</small></span><span>{formatDuration(DEMO_TRACK.durationUs)}</span><span>Bundled</span><span className={styles.asset}>Ready to add</span><span className={styles.rowActions}><button onClick={()=>void addDemo()}>Add &amp; separate</button><Link to="/studio">Preview</Link></span></div>}
      {!loading && category!=="performances"&&visibleSongs.length === 0 && (query||category==="separated") && <div className={styles.empty}><FileAudio weight="thin"/><strong>{query ? "No matching songs" : "No separated songs"}</strong><p>{query ? "Try a different title or artist." : "Open an original and choose Separate to create four playable stems."}</p></div>}
      {category!=="performances"&&visibleSongs.map((song) => <div className={`${styles.row} ${selected.has(song.id)?styles.selected:""}`} key={song.id}>
        <input className={styles.select} type="checkbox" aria-label={`Select ${song.title}`} checked={selected.has(song.id)} onChange={()=>toggleSelected(song.id)}/>
        <span className={styles.art}><FileAudio weight="duotone"/></span>
        <span className={styles.song}><strong>{song.title}</strong><small>{song.artist}</small></span>
        <span>{formatDuration(song.durationUs)}</span><span>{formatDate(song.createdAt)}</span><span className={styles.asset}><CheckCircle weight="fill"/> {"separated" in song && song.separated ? "4 stems" : "Original"}</span>
        <span className={styles.rowActions}><Link to={`/studio/${song.id}`}>Open</Link><button aria-label={`Preview ${song.title}`} onClick={()=>setPreviewId(current=>current===song.id?undefined:song.id)}><FileAudio/></button>{category==="separated"?<button aria-label={`Remove separation for ${song.title}`} onClick={()=>void removeSongSeparation(song.id,song.title)}><Trash/></button>:<><Link to={`/studio/${song.id}?separate=1`}>{"separated" in song&&song.separated?"Separate again":"Separate"}</Link>{"analyzed" in song&&song.analyzed&&<button aria-label={`Remove analysis for ${song.title}`} onClick={()=>void removeSongAnalysis(song.id,song.title)}><Waveform/></button>}<button aria-label={`Remove ${song.title}`} onClick={() => void removeSong(song.id, song.title)}><Trash/></button></>}</span>
        {previewId===song.id&&<div className={styles.inlinePreview}><InlinePreview blobId={song.blobId} title={song.title}/></div>}
      </div>)}
      {category==="performances"&&visiblePerformances.map(take=>{const song=originalById.get(take.originalId);return <div className={`${styles.row} ${selected.has(take.id)?styles.selected:""}`} key={take.id}><input className={styles.select} type="checkbox" aria-label={`Select take from ${song?.title??"recording"}`} checked={selected.has(take.id)} onChange={()=>toggleSelected(take.id)}/><span className={`${styles.art} ${styles.takeArt}`}><Microphone weight="fill"/></span><span className={styles.song}><strong>{song?.title??"Recorded take"}</strong><small>{song?.artist??"Local performance"}</small></span><span>{formatDuration(Math.round(take.manifest.durationFrames/take.manifest.sampleRate*1_000_000))}</span><span>{formatDate(take.createdAt)}</span><span className={styles.asset}><Waveform/>Take</span><span className={styles.rowActions}><Link to={`/studio/${take.originalId}`}>Open takes</Link><button aria-label="Remove recorded take" onClick={()=>void removeTake(take.id)}><Trash/></button></span></div>})}
      {!loading&&category==="performances"&&visiblePerformances.length===0&&<div className={styles.empty}><Microphone weight="thin"/><strong>{query?"No matching takes":"No performances yet"}</strong><p>Record in Studio and every completed take will appear here.</p></div>}
    </section>
    <footer><span><HardDrives/> {formatBytes(usage)} used by local audio assets</span><Link to="/settings"><FolderOpen/> Manage storage</Link></footer>
  </div>;
}

function InlinePreview({blobId,title}:{blobId:string;title:string}){
  const[url,setUrl]=useState<string>(),[failed,setFailed]=useState(false);
  useEffect(()=>{let active=true,objectUrl="";void getBlob(blobId).then(blob=>{if(!blob)throw new Error("missing_blob");return fileForOpfsPath(blob.opfsPath)}).then(file=>{objectUrl=URL.createObjectURL(file);if(active)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[blobId]);
  if(failed)return <span role="alert">Preview is unavailable. The source may have been reclaimed by the browser.</span>;
  if(!url)return <span role="status">Opening preview…</span>;
  return <audio controls preload="metadata" src={url} aria-label={`Preview ${title}`}/>;
}
