import { runtimeAssets } from "../../generated/runtime-assets";
import type { OriginalRecord, WaveformLevel, WaveformRecord } from "../../storage/database";
import type {BeatGridV1,ChordAnalysisV1} from "@atarang/contracts";
import { uuidV7 } from "../../storage/ids";
import {withSongMutationLease} from "../../storage/mutationLease";
import { getBeatGrid,getBlob,getChordAnalysis,getWaveform,putBeatGrid,putChordAnalysis,putWaveform } from "../../storage/repositories";

const ALGORITHM_VERSION = "atarang-waveform/1" as const;
const active = new Map<string, Promise<WaveformRecord>>();

export async function ensureWaveform(original: OriginalRecord) {
  const [existing,beats,chords] = await Promise.all([getWaveform(original.id),getBeatGrid(original.id),getChordAnalysis(original.id)]);
  if (existing?.algorithmVersion === ALGORITHM_VERSION&&beats?.document.algorithmVersion==="atarang-spectral-flux/1"&&chords?.document.algorithmVersion==="atarang-chroma/1") return existing;
  const running = active.get(original.id); if (running) return running;
  const promise = withSongMutationLease(original.id,()=>analyze(original)).finally(() => active.delete(original.id));
  active.set(original.id, promise); return promise;
}

async function analyze(original: OriginalRecord) {
  const blob = await getBlob(original.blobId); if (!blob) throw new Error("result_integrity_failed");
  const requestId = uuidV7();
  const result = await new Promise<{ sampleRate:number; channels:number; durationFrames:number; levels:WaveformLevel[];beatAnalysis:{bpm:number;reliability:number;reliable:boolean;beatsFrames:number[]};chordAnalysis:{segments:ChordAnalysisV1["segments"]} }>((resolve,reject) => {
    const worker = new Worker(runtimeAssets.analysisWorker, { type: "module", name: "atarang-analysis" });
    worker.onmessage = ({data}) => {
      if (data.requestId !== requestId) return;
      if (data.type === "waveform/complete") { worker.terminate(); resolve(data); }
      if (data.type === "waveform/error") { worker.terminate(); reject(new Error(data.code)); }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("analysis_failed")); };
    worker.postMessage({ type:"waveform/analyze", requestId, songId:original.id, generation:1, opfsPath:blob.opfsPath });
  });
  const now = new Date().toISOString();
  const {beatAnalysis,chordAnalysis,...waveformResult}=result,record: WaveformRecord = { id:original.id, originalId:original.id, schemaVersion:1, createdAt:now, updatedAt:now, algorithmVersion:ALGORITHM_VERSION, ...waveformResult };
  const document:BeatGridV1={schema:"atarang.beats/1",originalId:original.id,revision:0,algorithmVersion:"atarang-spectral-flux/1",bpm:beatAnalysis.bpm,reliability:beatAnalysis.reliability,reliable:beatAnalysis.reliable,userEdited:false,beats:beatAnalysis.beatsFrames.map((frame,index)=>({timeUs:Math.round(frame/result.sampleRate*1_000_000),beatInBar:(index%4+1) as 1|2|3|4,downbeat:index%4===0})),updatedAt:now};
  const weighted=new Map<string,number>();let confidenceTotal=0,durationTotal=0;for(const segment of chordAnalysis.segments){const duration=segment.endTimeUs-segment.startTimeUs;if(segment.chord!=="N")weighted.set(segment.chord,(weighted.get(segment.chord)??0)+duration*segment.confidence);confidenceTotal+=duration*segment.confidence;durationTotal+=duration}const key=Array.from(weighted).sort((a,b)=>b[1]-a[1])[0]?.[0]??null,chordDocument:ChordAnalysisV1={schema:"atarang.chords/1",originalId:original.id,revision:0,algorithmVersion:"atarang-chroma/1",key,confidence:durationTotal?confidenceTotal/durationTotal:0,segments:chordAnalysis.segments,updatedAt:now},existingBeat=await getBeatGrid(original.id),writes:Promise<unknown>[]=[putWaveform(record),putChordAnalysis({id:original.id,originalId:original.id,schemaVersion:1,createdAt:now,updatedAt:now,document:chordDocument})];if(!existingBeat?.document.userEdited)writes.push(putBeatGrid({id:original.id,originalId:original.id,schemaVersion:1,createdAt:now,updatedAt:now,document}));await Promise.all(writes);return record;
}
