import { ArrowCounterClockwise, MagnifyingGlassMinus, MagnifyingGlassPlus, Metronome, Pause, Play, Record, Repeat, SkipBack, SkipForward, X } from "@phosphor-icons/react";
import { useStudioStore } from "../studioStore";
import type { ImportedPlayback } from "../useImportedAudio";
import type { WaveformRecord } from "../../../storage/database";
import type {BeatGridV1} from "@atarang/contracts";
import { useEffect, useMemo, useRef } from "react";
import { MAX_ZOOM, PEAKS_PER_SCREEN, displayPeaks, formatTime, timeTicks } from "../waveformView";
import styles from "./Transport.module.css";

export function Transport({ importedPlayback, waveform, waveformStatus = "idle",beatGrid,stemsAvailable = false }: { importedPlayback?: ImportedPlayback | undefined; waveform?: WaveformRecord | null | undefined; waveformStatus?: "idle"|"analyzing"|"ready"|"error";beatGrid?:BeatGridV1|null|undefined;stemsAvailable?:boolean }) {
  const state = useStudioStore();
  const playing = importedPlayback?.playing ?? state.playing;
  const currentTimeUs = importedPlayback?.currentTimeUs ?? 102_000_000;
  const durationUs = importedPlayback?.durationUs || 238_000_000;
  const imported = Boolean(importedPlayback);
  const recording=importedPlayback?.recording??state.recording;
  const zoom=state.zoom;
  const peaks = useMemo(() => displayPeaks(waveform, PEAKS_PER_SCREEN*zoom), [waveform,zoom]);
  const {step,ticks}=useMemo(()=>timeTicks(durationUs,zoom),[durationUs,zoom]);
  const waveformRef=useRef<HTMLDivElement>(null),scrollerRef=useRef<HTMLDivElement>(null);
  const waveformPath=useMemo(()=>{const points=peaks.map((height,index)=>[index/Math.max(1,peaks.length-1)*1000,Math.max(4,height/52*44)] as const);if(!points.length)return"";const upper=points.map(([x,y])=>`${x.toFixed(1)},${(50-y).toFixed(1)}`).join(" L "),lower=[...points].reverse().map(([x,y])=>`${x.toFixed(1)},${(50+y).toFixed(1)}`).join(" L ");return`M ${upper} L ${lower} Z`},[peaks]);
  const waveformReady = !imported || waveformStatus === "ready";
  const position = `${Math.min(100, Math.max(0, currentTimeUs / durationUs * 100))}%`;
  const loopLeft = `${Math.min(100, Math.max(0, state.loopStartUs / durationUs * 100))}%`;
  const loopWidth = `${Math.min(100, Math.max(0, (state.loopEndUs-state.loopStartUs) / durationUs * 100))}%`;
  const beatStride=Math.max(1,Math.ceil((beatGrid?.beats.length??0)/(600*zoom)));
  const toggle = () => importedPlayback ? void importedPlayback.toggle() : state.togglePlaying();
  const seekFromPointer=(event:React.PointerEvent<HTMLDivElement>)=>{if(!importedPlayback?.ready)return;const bounds=waveformRef.current?.getBoundingClientRect();if(!bounds)return;const ratio=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));importedPlayback.seekTo(ratio*durationUs/1_000_000)};
  // Zoomed in, the playhead leaves the screen within seconds. Recentre only once
  // it reaches the edge, so a view the user scrolled to stays put while it is
  // still on screen.
  useEffect(()=>{const scroller=scrollerRef.current,track=waveformRef.current;if(!scroller||!track||zoom===1)return;const x=currentTimeUs/durationUs*track.clientWidth,margin=scroller.clientWidth*.15;if(x<scroller.scrollLeft+margin||x>scroller.scrollLeft+scroller.clientWidth-margin)scroller.scrollLeft=x-scroller.clientWidth/2},[currentTimeUs,durationUs,zoom]);
  return <section className={styles.transport} aria-label="Waveform and transport" data-source-time-us={currentTimeUs} data-zoom={zoom} data-drift-frames={importedPlayback?.driftFrames} data-underruns={importedPlayback?.underruns} data-repetition={importedPlayback?.repetition} data-metronome-clicks={importedPlayback?.metronomeClicks}>
    <div className={styles.waveform}>
      <div ref={scrollerRef} className={styles.scroller}>
        <div className={styles.track} style={{width:`${zoom*100}%`}}>
          <div className={styles.times}>{ticks.map((second)=><span key={second} style={{left:`${second*1_000_000/durationUs*100}%`}}>{formatTime(second*1_000_000,step<1?1:0).replace(/^0/,"")}</span>)}</div>
          {/* A touch drag pans the zoomed view, so touch seeks on release: the
              browser cancels the pointer once it takes the gesture as a scroll,
              which leaves a tap seeking and a pan not. A mouse still drags to seek. */}
          <div ref={waveformRef} className={`${styles.bars} ${waveformReady ? "" : styles.pendingWaveform}`} role="slider" tabIndex={waveformReady?0:-1} aria-label={waveformReady ? "Song waveform. Click or drag to seek" : waveformStatus === "error" ? "Waveform unavailable" : "Waveform analysis pending"} aria-valuemin={0} aria-valuemax={Math.round(durationUs/1_000_000)} aria-valuenow={Math.round(currentTimeUs/1_000_000)} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);if(event.pointerType!=="touch")seekFromPointer(event)}} onPointerMove={event=>{if(event.pointerType!=="touch"&&event.currentTarget.hasPointerCapture(event.pointerId))seekFromPointer(event)}} onPointerUp={event=>{if(event.pointerType==="touch")seekFromPointer(event)}} onKeyDown={event=>{if(event.key==="ArrowLeft")importedPlayback?.seekBy(-5);if(event.key==="ArrowRight")importedPlayback?.seekBy(5);if(event.key==="+"||event.key==="=")state.zoomBy(1);if(event.key==="-")state.zoomBy(-1)}}>
            <svg className={styles.waveShape} viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden><path d={waveformPath}/><line x1="0" x2="1000" y1="50" y2="50"/></svg>
            {beatGrid?.reliable&&beatGrid.beats.filter((_,index)=>index%beatStride===0).map((beat,index)=><span aria-hidden="true" data-beat-time-us={beat.timeUs} className={`${styles.beatMarker} ${beat.downbeat?styles.downbeat:""}`} style={{left:`${beat.timeUs/durationUs*100}%`}} key={`${beat.timeUs}-${index}`}/>) }
            {state.loopEnabled && <span className={styles.loopRegion} style={{left:loopLeft,width:loopWidth,right:"auto"}}><b>A</b><b>B</b></span>}
            {imported && !waveformReady && <span className={styles.pendingLabel}>{waveformStatus === "error" ? "Waveform unavailable" : "Analyzing waveform…"}</span>}
            <span className={styles.playhead} style={{ left: position }} />
          </div>
        </div>
      </div>
      <div className={styles.overlay}>
        {state.loopEnabled&&<button className={styles.chip} onClick={()=>state.clearLoop(durationUs)}><X/>Clear loop</button>}
        <span className={styles.chip}>
          <button disabled={zoom===1} onClick={()=>state.zoomBy(-1)} aria-label="Zoom out"><MagnifyingGlassMinus/></button>
          <b>{zoom}×</b>
          <button disabled={zoom===MAX_ZOOM} onClick={()=>state.zoomBy(1)} aria-label="Zoom in"><MagnifyingGlassPlus/></button>
        </span>
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
