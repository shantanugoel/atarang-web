import {useEffect,useRef,useState}from"react";
import{DownloadSimple,Microphone,Play,Trash,Waveform}from"@phosphor-icons/react";
import type{PerformanceManifestV1}from"@atarang/contracts";
import{downloadTakeAsset,exportPerformanceWav,previewPerformanceFiles}from"../../recording/exportPerformance";
import{usePerformances}from"../../recording/usePerformances";
import styles from"./TakesWorkspace.module.css";

const seconds=(value:number)=>Math.round(value/100_000)/10;

function TakePreview({take,number}:{take:PerformanceManifestV1;number:number}){
  const[sources,setSources]=useState<{take:string;reference:string;cleanup:()=>Promise<void>}>(),[mode,setMode]=useState<"take"|"reference">("take"),[status,setStatus]=useState("");
  const audio=useRef<HTMLAudioElement>(null),pending=useRef<{time:number;play:boolean}|undefined>(undefined),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  useEffect(()=>()=>{if(sources){URL.revokeObjectURL(sources.take);URL.revokeObjectURL(sources.reference);void sources.cleanup()}},[sources]);
  useEffect(()=>{setSources(undefined);setStatus("")},[take.revision]);
  const prepare=async()=>{setStatus("Preparing preview…");try{const files=await previewPerformanceFiles(take);if(!mounted.current){void files.cleanup();return}setSources({take:URL.createObjectURL(files.take),reference:URL.createObjectURL(files.reference),cleanup:files.cleanup});setMode("take");setStatus("")}catch{if(mounted.current)setStatus("Preview unavailable")}};
  const compare=(next:"take"|"reference")=>{const player=audio.current;if(!player||next===mode)return;const trimStart=take.edit.trimStartUs/1_000_000,time=player.currentTime+(next==="reference"?trimStart:-trimStart);pending.current={time:Math.max(0,time),play:!player.paused};setMode(next)};
  const ready=()=>{const player=audio.current,next=pending.current;if(!player||!next)return;player.currentTime=Math.min(next.time,Number.isFinite(player.duration)?player.duration:next.time);if(next.play)void player.play();pending.current=undefined};
  if(!sources)return<div className={styles.preview}><button disabled={status==="Preparing preview…"} onClick={()=>void prepare()}><Play/>Preview take</button><span role="status">{status}</span></div>;
  return<div className={styles.preview}><div role="group" aria-label={`Take ${number} comparison`}><button aria-pressed={mode==="take"} onClick={()=>compare("take")}>Take mix</button><button aria-pressed={mode==="reference"} onClick={()=>compare("reference")}>Reference</button></div><audio ref={audio} aria-label={`Take ${number} ${mode} preview`} controls src={sources[mode]} onLoadedMetadata={ready}/></div>;
}

export function TakesWorkspace({originalId}:{originalId?:string}){
  const{takes,save,remove}=usePerformances(originalId);
  const updateTime=(take:PerformanceManifestV1,key:"trimStartUs"|"trimEndUs"|"fadeInUs"|"fadeOutUs",value:number)=>{const durationUs=Math.round(take.durationFrames/take.sampleRate*1_000_000),edit={...take.edit,[key]:Math.max(0,Math.min(durationUs,Math.round(value*1_000_000)))};if(edit.trimEndUs<=edit.trimStartUs)return;save({...take,edit})};
  const updateGain=(take:PerformanceManifestV1,key:"micGain"|"backingGain",value:number)=>save({...take,edit:{...take.edit,[key]:value}});
  const discard=(take:PerformanceManifestV1)=>{if(confirm("Discard this take? This cannot be undone."))void remove(take.performanceId)};
  if(takes===undefined)return<div className={styles.empty}>Opening takes…</div>;
  if(!takes.length)return<div className={styles.empty}><Microphone weight="thin"/><strong>No takes yet</strong><p>Use the red Record control to capture separate dry microphone and backing streams.</p></div>;
  return<div className={styles.list} role="tabpanel">{takes.map((take,index)=>{const number=takes.length-index;return<article key={take.performanceId}><header><div><strong>Take {number}</strong><span>{new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(new Date(take.startedAt))} · {seconds(take.edit.trimEndUs-take.edit.trimStartUs)} s</span></div><div><button onClick={()=>void exportPerformanceWav(take)}><DownloadSimple/>Export mix WAV</button><button aria-label={`Discard take ${number}`} onClick={()=>discard(take)}><Trash/></button></div></header><div className={styles.wave}><Waveform/>{Math.round(take.sampleRate/1000)} kHz · aligned dual stream</div><TakePreview take={take} number={number}/><div className={styles.mix}><label>Mic mix <output>{Math.round((take.edit.micGain??.72)*100)}%</output><input aria-label={`Take ${number} mic mix`} type="range" min="0" max="2" step="0.05" value={take.edit.micGain??.72} onChange={event=>updateGain(take,"micGain",Number(event.target.value))}/></label><label>Backing mix <output>{Math.round((take.edit.backingGain??.72)*100)}%</output><input aria-label={`Take ${number} backing mix`} type="range" min="0" max="2" step="0.05" value={take.edit.backingGain??.72} onChange={event=>updateGain(take,"backingGain",Number(event.target.value))}/></label></div><div className={styles.edits}><label>Trim start<input aria-label={`Take ${number} trim start`} type="number" min="0" step="0.1" value={seconds(take.edit.trimStartUs)} onChange={event=>updateTime(take,"trimStartUs",Number(event.target.value))}/></label><label>Trim end<input aria-label={`Take ${number} trim end`} type="number" min="0.1" step="0.1" value={seconds(take.edit.trimEndUs)} onChange={event=>updateTime(take,"trimEndUs",Number(event.target.value))}/></label><label>Fade in<input type="number" min="0" step="0.1" value={seconds(take.edit.fadeInUs)} onChange={event=>updateTime(take,"fadeInUs",Number(event.target.value))}/></label><label>Fade out<input type="number" min="0" step="0.1" value={seconds(take.edit.fadeOutUs)} onChange={event=>updateTime(take,"fadeOutUs",Number(event.target.value))}/></label></div><footer><button onClick={()=>downloadTakeAsset(take,"mic")}>Dry mic WAV</button><button onClick={()=>downloadTakeAsset(take,"backing")}>Backing WAV</button><span>Input offset {take.inputOffsetUs/1000} ms</span></footer></article>})}</div>;
}
