import { useEffect, useRef, useState } from "react";
import { DotsThreeVertical, ListBullets, MusicNotes, PencilSimple, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { Link, useParams, useSearchParams } from "react-router";
import type { OriginalRecord } from "../../storage/database";
import { getOriginal } from "../../storage/repositories";
import { Mixer } from "./components/Mixer";
import { PracticeInspector } from "./components/PracticeInspector";
import { LyricsWorkspace } from "./components/LyricsWorkspace";
import { Transport } from "./components/Transport";
import {SeparationSheet} from "./components/SeparationSheet";
import { useImportedAudio } from "./useImportedAudio";
import { DEMO_TRACK, useDemoAudio } from "./useDemoAudio";
import { useSeparatedAudio } from "./useSeparatedAudio";
import { useWaveform } from "./useWaveform";
import { usePracticePersistence } from "./usePracticePersistence";
import {useBeatGrid} from "./useBeatGrid";
import {useSeparation} from "../separation/useSeparation";
import {importSeparationPackage,type SeparationImportProgress} from "../separation/separationImporter";
import { useStudioStore } from "./studioStore";
import styles from "./StudioPage.module.css";

export function StudioPage() {
  const { songId } = useParams();
  const [searchParams,setSearchParams]=useSearchParams();
  const [original, setOriginal] = useState<OriginalRecord | null | undefined>(songId ? undefined : null);
  const toggleMetronome = useStudioStore((s) => s.toggleMetronome);
  const toggleRecording = useStudioStore((s) => s.toggleRecording);
  const setLoopStart = useStudioStore((s) => s.setLoopStart);
  const setLoopEnd = useStudioStore((s) => s.setLoopEnd);
  const loopEnabled = useStudioStore((s) => s.loopEnabled);
  const loopStartUs = useStudioStore((s) => s.loopStartUs);
  const loopEndUs = useStudioStore((s) => s.loopEndUs);
  const speed = useStudioStore((s) => s.speed);
  const masterLevel = useStudioStore((s) => s.masterLevel);
  const waveform = useWaveform(original ?? undefined);
  const beats=useBeatGrid(original??undefined);
  const separation=useSeparation(original??undefined);
  const importedPlayback = useImportedAudio(separation === null ? original ?? undefined : undefined,speed,10 ** (masterLevel/20));
  const separatedPlayback = useSeparatedAudio(separation ?? undefined,beats.grid);
  const demoPlayback = useDemoAudio(speed, original === null,10 ** (masterLevel/20));
  const playback = original ? (separation ? separatedPlayback : importedPlayback) : demoPlayback;
  const separationInput=useRef<HTMLInputElement>(null);
  const[separationProgress,setSeparationProgress]=useState<SeparationImportProgress|null>(null);
  const[separationSheet,setSeparationSheet]=useState(false);
  const[separationError,setSeparationError]=useState("");
  const playbackToggle = playback.toggle;
  const playbackSeekBy = playback.seekBy;
  usePracticePersistence(original ?? undefined, playback.currentTimeUs, playback.playing, playback.ready, playback.seekTo);
  useEffect(()=>{if(separation===null&&playback.playing&&loopEnabled&&playback.currentTimeUs>=loopEndUs)playback.seekTo(loopStartUs/1_000_000)},[loopEnabled,loopEndUs,loopStartUs,playback.currentTimeUs,playback.playing,playback.seekTo,separation]);

  useEffect(() => { let active = true; if (!songId) { setOriginal(null); return; } setOriginal(undefined); void getOriginal(songId).then((record) => { if (active) setOriginal(record ?? null); }); return () => { active = false; }; }, [songId]);
  useEffect(()=>{if(original&&searchParams.get("separate")==="1"&&separation===null){setSeparationSheet(true);setSearchParams({}, {replace:true})}},[original,searchParams,separation,setSearchParams]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space" || event.key.toLowerCase() === "k") { event.preventDefault(); void playbackToggle(); }
      if (event.key.toLowerCase() === "j") playbackSeekBy(-10);
      if (event.key.toLowerCase() === "l") playbackSeekBy(10);
      if (event.key.toLowerCase() === "i" && original) setLoopStart(playback.currentTimeUs, original.durationUs);
      if (event.key.toLowerCase() === "o" && original) setLoopEnd(playback.currentTimeUs, original.durationUs);
      if (event.key.toLowerCase() === "m") toggleMetronome();
      if (event.key.toLowerCase() === "r") { if(playback.toggleRecording)void playback.toggleRecording();else if(!original)toggleRecording(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [original, playback.currentTimeUs, playbackSeekBy, playbackToggle, setLoopEnd, setLoopStart, toggleMetronome, toggleRecording]);

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
          <button className="icon-button" aria-label={imported&&separation===null?"Open separation options":"Show track list"} onClick={()=>imported&&separation===null?setSeparationSheet(true):undefined}><ListBullets /></button>
          {imported&&<input ref={separationInput} className="sr-only" type="file" multiple accept="application/json,.json,audio/*,.flac" aria-label="Choose manifest and four stem files" onChange={event=>void attachSeparation(event.target.files)}/>}
          <button className="icon-button" aria-label="Edit song"><PencilSimple /></button>
          <button className="icon-button" aria-label="More song actions"><DotsThreeVertical /></button>
        </div>
      </section>
      <div className={styles.workspace}>
        <Mixer available={Boolean(separation)} />
        <LyricsWorkspace originalId={original?.id} songTitle={original?.title ?? DEMO_TRACK.title} artistName={original?.artist} durationUs={original?.durationUs ?? DEMO_TRACK.durationUs} currentTimeUs={playback.currentTimeUs} seekTo={playback.seekTo} />
        <PracticeInspector durationUs={original?.durationUs ?? DEMO_TRACK.durationUs} currentTimeUs={playback.currentTimeUs} pitchAvailable={Boolean(separation)} beatGrid={beats.grid} adjustTempo={beats.adjustTempo} />
      </div>
      {(playback.error||playback.recordingError||separationError) && <div className={styles.playbackError} role="alert"><WarningCircle/>{playback.error||playback.recordingError||`Stem package failed: ${separationError}`}</div>}
      {separationProgress&&<div className={styles.separationProgress} role="status"><SpinnerGap className={styles.spin}/>{separationProgress.phase==="preflight"?"Checking four-stem package…":separationProgress.phase==="writing"?"Verifying and storing stems…":"Publishing separation…"}</div>}
      <Transport importedPlayback={playback} waveform={waveform.waveform} waveformStatus={imported ? waveform.status : "ready"} beatGrid={beats.grid} />
      {separationSheet&&original&&<SeparationSheet original={original} onClose={()=>setSeparationSheet(false)} onImportPackage={()=>{setSeparationSheet(false);separationInput.current?.click()}} onCloudPackage={attachCloudSeparation}/>}
    </div>
  );
}
