import {useCallback,useEffect,useState} from "react";
import type {BeatGridV1} from "@atarang/contracts";
import type {OriginalRecord} from "../../storage/database";
import {getBeatGrid,putBeatGrid,subscribeLibrary} from "../../storage/repositories";
import {ensureWaveform} from "./waveformAnalysis";

/**
 * The grid, in three states the caller is expected to tell apart: `undefined`
 * while it is being read, the document once it exists, and `null` only when the
 * analysis has settled without one. Handing back `null` early — carried over
 * from the previous song, or read from storage mid-analysis — is what made the
 * Tempo row claim a result it did not have.
 */
export function useBeatGrid(original?:OriginalRecord){const[grid,setGrid]=useState<BeatGridV1|null|undefined>(original?undefined:null);useEffect(()=>{let active=true,pending=Boolean(original);const refresh=()=>{if(!original){setGrid(null);return}void getBeatGrid(original.id).then(record=>{if(!active)return;if(record)setGrid(record.document);else if(!pending)setGrid(null)},()=>{if(active)setGrid(null)})};if(original){setGrid(undefined);void ensureWaveform(original).then(()=>{pending=false;refresh()},()=>{pending=false;if(active)setGrid(null)})}else setGrid(null);const unsubscribe=subscribeLibrary(refresh);return()=>{active=false;unsubscribe()}},[original]);const setTempo=useCallback((nextBpm:number)=>{if(!original||!grid)return;const bpm=Math.max(30,Math.min(300,Math.round(nextBpm))),intervalUs=60_000_000/bpm,anchor=grid.beats[0]?.timeUs??0,offset=(grid.beats[0]?.beatInBar??1)-1,beats=[] as BeatGridV1["beats"];for(let time=anchor,index=0;time<original.durationUs;time+=intervalUs,index++){const beatInBar=((index+offset)%4+1) as 1|2|3|4;beats.push({timeUs:Math.round(time),beatInBar,downbeat:beatInBar===1})}const now=new Date().toISOString(),document={...grid,bpm,reliability:1,reliable:true,userEdited:true,revision:grid.revision+1,beats,updatedAt:now};setGrid(document);void putBeatGrid({id:original.id,originalId:original.id,schemaVersion:1,createdAt:now,updatedAt:now,document})},[grid,original]);return{grid,setTempo}}
