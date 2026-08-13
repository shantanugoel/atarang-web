import { useEffect, useRef, useState } from "react";
import { ListBullets, MusicNotes, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { Link, useParams, useSearchParams } from "react-router";
import { Mixer } from "./components/Mixer";
import { PracticeInspector } from "./components/PracticeInspector";
import { LyricsWorkspace } from "./components/LyricsWorkspace";
import { Transport } from "./components/Transport";
import {SeparationSheet} from "./components/SeparationSheet";
import { DEMO_TRACK } from "./useDemoAudio";
import { usePlaybackSession } from "./PlaybackSession";
import { ensureStemChordAnalysis } from "./waveformAnalysis";
import {importSeparationPackage,type SeparationImportProgress} from "../separation/separationImporter";
import { useStudioStore } from "./studioStore";
import styles from "./StudioPage.module.css";

export function StudioPage() {
  const { songId } = useParams();
  const [searchParams,setSearchParams]=useSearchParams();
  // The song, its analysis and its audio outlive this page — they belong to the
  // session above the router, so that leaving the Studio does not stop the music.
  const {original,playback,waveform,waveformStatus,beatGrid,setTempo,separation}=usePlaybackSession();
  const separationInput=useRef<HTMLInputElement>(null);
  const[separationProgress,setSeparationProgress]=useState<SeparationImportProgress|null>(null);
  const[separationSheet,setSeparationSheet]=useState(false);
  const[chordProgress,setChordProgress]=useState<number|null>(null);
  const pane = useStudioStore((s) => s.pane);
  const setPane = useStudioStore((s) => s.setPane);
  const[separationError,setSeparationError]=useState("");

  // Chords first decoded from the mixture are re-decoded from the stems, where
  // the drums and the vocal line are no longer voting on the harmony.
  useEffect(()=>{if(!original||!separation)return;let active=true;void ensureStemChordAnalysis(original,separation,fraction=>{if(active)setChordProgress(fraction)}).finally(()=>{if(active)setChordProgress(null)});return()=>{active=false;setChordProgress(null)}},[original,separation]);
  useEffect(()=>{if(original&&searchParams.get("separate")==="1"){setSeparationError("");setSeparationSheet(true);setSearchParams({}, {replace:true})}},[original,searchParams,setSearchParams]);

  if (original === undefined) return <div className={styles.routeState}><SpinnerGap className={styles.spin}/><span>Opening local audio…</span></div>;
  if (songId && !original) return <div className={styles.routeState}><WarningCircle/><strong>Song not found</strong><span>This item may have been removed from browser storage.</span><Link to="/library">Return to Library</Link></div>;
  const imported = Boolean(original);
  const attachSeparation=async(files:FileList|null)=>{if(!original||!files?.length)return;setSeparationError("");try{await importSeparationPackage(original,files,setSeparationProgress)}catch(error){setSeparationError(error instanceof Error?error.message:"separation_failed")}finally{setSeparationProgress(null);if(separationInput.current)separationInput.current.value=""}};
  const attachCloudSeparation=async(files:File[],purge:()=>Promise<void>)=>{if(!original)return;setSeparationError("");try{await importSeparationPackage(original,files,setSeparationProgress)}catch(error){setSeparationError(error instanceof Error?error.message:"separation_failed");throw error}finally{setSeparationProgress(null)}try{await purge()}catch{setSeparationError("Cloud result imported locally; immediate server purge failed and will retry by retention policy.")}};
  return (
    <div className={styles.studio}>
      <section className={styles.songbar} aria-label="Current song">
        <span className={styles.songIcon}><MusicNotes weight="fill" aria-hidden /></span>
        <div><strong>{original?.title ?? DEMO_TRACK.title}</strong><span>{original?.artist ?? `${DEMO_TRACK.artist} · CC0 demo`}</span></div>
        <div className={styles.songActions}>
          <button className="icon-button" aria-label={imported?separation?"Separate song again":"Separate song":"Show track list"} onClick={()=>{if(imported){setSeparationError("");setSeparationSheet(true)}}}><ListBullets /></button>
          {imported&&<input ref={separationInput} className="sr-only" type="file" multiple accept="application/json,.json,audio/*,.flac" aria-label="Choose manifest and four stem files" onChange={event=>void attachSeparation(event.target.files)}/>}
        </div>
      </section>
      <nav className={styles.paneSwitch} aria-label="Studio panel">
        {(["mix","song","practice"] as const).map(item=><button key={item} aria-pressed={pane===item} onClick={()=>setPane(item)}>{item[0]!.toUpperCase()+item.slice(1)}</button>)}
      </nav>
      <div className={styles.workspace} data-pane={pane}>
        <Mixer available={Boolean(separation)} />
        <LyricsWorkspace originalId={original?.id} songTitle={original?.title ?? DEMO_TRACK.title} artistName={original?.artist} durationUs={original?.durationUs ?? DEMO_TRACK.durationUs} currentTimeUs={playback.currentTimeUs} seekTo={playback.seekTo} />
        <PracticeInspector durationUs={original?.durationUs ?? DEMO_TRACK.durationUs} currentTimeUs={playback.currentTimeUs} stemsAvailable={Boolean(separation)} beatGrid={beatGrid} setTempo={setTempo} />
      </div>
      {(playback.error||playback.recordingError||separationError) && <div className={styles.playbackError} role="alert"><WarningCircle/>{playback.error||playback.recordingError||separationError}</div>}
      {separationProgress&&<div className={styles.separationProgress} role="status"><SpinnerGap className={styles.spin}/>{separationProgress.phase==="preflight"?"Checking four-stem package…":separationProgress.phase==="writing"?"Verifying and storing stems…":"Publishing separation…"}</div>}
      {/* The chords on screen are about to change on their own. Say so, or it reads as a bug. */}
      {chordProgress!==null&&!separationProgress&&<div className={styles.separationProgress} role="status"><SpinnerGap className={styles.spin}/>{`Re-reading chords from the separated stems… ${Math.round(chordProgress*100)}%`}</div>}
      <Transport importedPlayback={playback} waveform={waveform} waveformStatus={imported ? waveformStatus : "ready"} beatGrid={beatGrid} stemsAvailable={Boolean(separation)} />
      {separationSheet&&original&&<SeparationSheet original={original} replacing={Boolean(separation)} onClose={()=>setSeparationSheet(false)} onImportPackage={()=>{setSeparationSheet(false);separationInput.current?.click()}} onCloudPackage={attachCloudSeparation} onLocalFailure={setSeparationError}/>}
    </div>
  );
}
