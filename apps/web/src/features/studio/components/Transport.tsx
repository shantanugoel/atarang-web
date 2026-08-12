import { ArrowCounterClockwise, Metronome, Pause, Play, Record, Repeat, SkipBack, SkipForward, X } from "@phosphor-icons/react";
import { useStudioStore } from "../studioStore";
import type { ImportedPlayback } from "../useImportedAudio";
import type { WaveformRecord } from "../../../storage/database";
import type {BeatGridV1} from "@atarang/contracts";
import { useMemo, useRef } from "react";
import styles from "./Transport.module.css";

const bars = Array.from({length: 128}, (_, i) => 12 + Math.abs(Math.sin(i * 1.71) * 28 + Math.sin(i * .31) * 17));

const formatTime = (timeUs: number) => { const seconds = Math.max(0, Math.round(timeUs / 1_000_000)); return `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`; };

function displayPeaks(waveform: WaveformRecord | null | undefined, target = 128) {
  if (!waveform?.levels.length) return bars;
  const level = waveform.levels.reduce((best, candidate) => Math.abs(candidate.max.length-target) < Math.abs(best.max.length-target) ? candidate : best);
  const count = Math.min(target, level.max.length);
  const raw = Array.from({length:count}, (_, output) => {
    const start = Math.floor(output * level.max.length / count); const end = Math.max(start+1, Math.floor((output+1)*level.max.length/count)); let peak=0;
    for (let index=start;index<end;index++) peak=Math.max(peak,Math.abs(level.min[index]??0),Math.abs(level.max[index]??0),level.rms[index]??0);
    return peak;
  });
  const maximum = Math.max(...raw, Number.EPSILON);
  return raw.map((peak) => Math.max(3, Math.min(52, 3 + peak / maximum * 46)));
}

export function Transport({ importedPlayback, waveform, waveformStatus = "idle",beatGrid,stemsAvailable = false }: { importedPlayback?: ImportedPlayback | undefined; waveform?: WaveformRecord | null | undefined; waveformStatus?: "idle"|"analyzing"|"ready"|"error";beatGrid?:BeatGridV1|null|undefined;stemsAvailable?:boolean }) {
  const state = useStudioStore();
  const playing = importedPlayback?.playing ?? state.playing;
  const currentTimeUs = importedPlayback?.currentTimeUs ?? 102_000_000;
  const durationUs = importedPlayback?.durationUs || 238_000_000;
  const imported = Boolean(importedPlayback);
  const recording=importedPlayback?.recording??state.recording;
  const peaks = useMemo(() => displayPeaks(waveform), [waveform]);
  const waveformRef=useRef<HTMLDivElement>(null);
  const waveformPath=useMemo(()=>{const points=peaks.map((height,index)=>[index/Math.max(1,peaks.length-1)*1000,Math.max(4,height/52*44)] as const);if(!points.length)return"";const upper=points.map(([x,y])=>`${x.toFixed(1)},${(50-y).toFixed(1)}`).join(" L "),lower=[...points].reverse().map(([x,y])=>`${x.toFixed(1)},${(50+y).toFixed(1)}`).join(" L ");return`M ${upper} L ${lower} Z`},[peaks]);
  const waveformReady = !imported || waveformStatus === "ready";
  const position = `${Math.min(100, Math.max(0, currentTimeUs / durationUs * 100))}%`;
  const loopLeft = `${Math.min(100, Math.max(0, state.loopStartUs / durationUs * 100))}%`;
  const loopWidth = `${Math.min(100, Math.max(0, (state.loopEndUs-state.loopStartUs) / durationUs * 100))}%`;
  const beatStride=Math.max(1,Math.ceil((beatGrid?.beats.length??0)/600));
  const toggle = () => importedPlayback ? void importedPlayback.toggle() : state.togglePlaying();
  const seekFromPointer=(event:React.PointerEvent<HTMLDivElement>)=>{if(!importedPlayback?.ready)return;const bounds=waveformRef.current?.getBoundingClientRect();if(!bounds)return;const ratio=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));importedPlayback.seekTo(ratio*durationUs/1_000_000)};
  return <section className={styles.transport} aria-label="Waveform and transport" data-source-time-us={currentTimeUs} data-drift-frames={importedPlayback?.driftFrames} data-underruns={importedPlayback?.underruns} data-repetition={importedPlayback?.repetition} data-metronome-clicks={importedPlayback?.metronomeClicks}>
    <div className={styles.waveform}>
      <div className={styles.times}>{[0,.25,.5,.75,1].map((ratio) => <span key={ratio}>{formatTime(durationUs * ratio).replace(/^0/,"")}</span>)}</div>
      <div ref={waveformRef} className={`${styles.bars} ${waveformReady ? "" : styles.pendingWaveform}`} role="slider" tabIndex={waveformReady?0:-1} aria-label={waveformReady ? "Song waveform. Click or drag to seek" : waveformStatus === "error" ? "Waveform unavailable" : "Waveform analysis pending"} aria-valuemin={0} aria-valuemax={Math.round(durationUs/1_000_000)} aria-valuenow={Math.round(currentTimeUs/1_000_000)} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);seekFromPointer(event)}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))seekFromPointer(event)}} onKeyDown={event=>{if(event.key==="ArrowLeft")importedPlayback?.seekBy(-5);if(event.key==="ArrowRight")importedPlayback?.seekBy(5)}}>
        <svg className={styles.waveShape} viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden><path d={waveformPath}/><line x1="0" x2="1000" y1="50" y2="50"/></svg>
        {beatGrid?.reliable&&beatGrid.beats.filter((_,index)=>index%beatStride===0).map((beat,index)=><span aria-hidden="true" data-beat-time-us={beat.timeUs} className={`${styles.beatMarker} ${beat.downbeat?styles.downbeat:""}`} style={{left:`${beat.timeUs/durationUs*100}%`}} key={`${beat.timeUs}-${index}`}/>) }
        {state.loopEnabled && <span className={styles.loopRegion} style={{left:loopLeft,width:loopWidth,right:"auto"}}><b>A</b><b>B</b></span>}
        {imported && !waveformReady && <span className={styles.pendingLabel}>{waveformStatus === "error" ? "Waveform unavailable" : "Analyzing waveform…"}</span>}
        <span className={styles.playhead} style={{ left: position }} />
        {state.loopEnabled&&<button className={styles.clearLoop} onPointerDown={event=>event.stopPropagation()} onClick={()=>state.clearLoop(durationUs)}><X/>Clear loop</button>}
      </div>
    </div>
    <div className={styles.controls}>
      <div className={styles.time}><strong>{formatTime(currentTimeUs)}</strong><span>/</span><b>{formatTime(durationUs)}</b></div>
      <div className={styles.mainControls}>
        <button disabled={Boolean(importedPlayback && !importedPlayback.ready)} onClick={() => importedPlayback?.seekTo(0)} aria-label="Skip to start"><SkipBack /></button>
        <button disabled={Boolean(importedPlayback && !importedPlayback.ready)} onClick={() => importedPlayback?.seekBy(-10)} aria-label="Rewind 10 seconds"><ArrowCounterClockwise /></button>
        <button disabled={Boolean(importedPlayback && !importedPlayback.ready)} className={styles.play} onClick={toggle} aria-label={playing ? "Pause" : "Play"} aria-pressed={playing}>{playing ? <Pause weight="fill"/> : <Play weight="fill"/>}</button>
        <button disabled={Boolean(importedPlayback && !importedPlayback.ready)} onClick={() => importedPlayback?.seekBy(10)} aria-label="Forward 10 seconds" className={styles.forward}><ArrowCounterClockwise /></button>
        <button disabled={Boolean(importedPlayback && !importedPlayback.ready)} onClick={() => importedPlayback?.seekTo(durationUs / 1_000_000)} aria-label="Skip to end"><SkipForward /></button>
      </div>
      <div className={styles.secondary}>
        <button className={state.loopEnabled ? styles.active : ""} onClick={state.toggleLoop} aria-label={state.loopEnabled ? "Disable loop" : "Enable loop"} aria-pressed={state.loopEnabled}><Repeat /></button>
        <button disabled={imported&&!stemsAvailable} title={imported&&!stemsAvailable?"The click track plays with four-stem playback. Separate this song to enable it.":undefined} className={state.metronome ? styles.active : ""} onClick={state.toggleMetronome} aria-label="Toggle metronome" aria-pressed={state.metronome}><Metronome /></button>
        <button disabled={imported&&!importedPlayback?.toggleRecording} title={imported&&!importedPlayback?.toggleRecording?"Import a four-stem package to record aligned mic and backing streams.":undefined} className={recording ? styles.recording : ""} onClick={()=>importedPlayback?.toggleRecording?void importedPlayback.toggleRecording():state.toggleRecording()} aria-label={recording ? "Stop recording" : "Record"} aria-pressed={recording}><Record weight={recording ? "fill" : "regular"}/></button>
      </div>
    </div>
  </section>;
}
