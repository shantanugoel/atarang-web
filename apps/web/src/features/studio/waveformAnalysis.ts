import { runtimeAssets } from "../../generated/runtime-assets";
import type { OriginalRecord, SeparationRecord, WaveformLevel, WaveformRecord } from "../../storage/database";
import type {BeatGridV1,ChordAlgorithmV1,ChordAnalysisV1} from "@atarang/contracts";
import { chordBoundaries } from "../analysis/chordDetection";
import { uuidV7 } from "../../storage/ids";
import {withSongMutationLease} from "../../storage/mutationLease";
import { getBeatGrid,getBlob,getChordAnalysis,getWaveform,putBeatGrid,putChordAnalysis,putWaveform } from "../../storage/repositories";

const ALGORITHM_VERSION = "atarang-waveform/1" as const;
const active = new Map<string, Promise<WaveformRecord>>();
const activeStemChords = new Map<string, Promise<void>>();

function chordDocumentFrom(originalId: string, algorithmVersion: ChordAlgorithmV1, analysis: { segments: ChordAnalysisV1["segments"]; key: string | null }, now: string): ChordAnalysisV1 {
  // The detector reports the key it decoded against; a duration-weighted vote
  // over the segments would just name whichever chord was held longest.
  let confidenceTotal = 0, durationTotal = 0;
  for (const segment of analysis.segments) { const duration = segment.endTimeUs - segment.startTimeUs; confidenceTotal += duration * segment.confidence; durationTotal += duration; }
  return { schema: "atarang.chords/1", originalId, revision: 0, algorithmVersion, key: analysis.key, confidence: durationTotal ? confidenceTotal / durationTotal : 0, segments: analysis.segments, updatedAt: now };
}

function runAnalysisWorker<T>(message: object, completeType: string, errorType: string) {
  const requestId = uuidV7();
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(runtimeAssets.analysisWorker, { type: "module", name: "atarang-analysis" });
    worker.onmessage = ({ data }) => {
      if (data.requestId !== requestId) return;
      if (data.type === completeType) { worker.terminate(); resolve(data as T); }
      if (data.type === errorType) { worker.terminate(); reject(new Error(data.code)); }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("analysis_failed")); };
    worker.postMessage({ ...message, requestId });
  });
}

/**
 * Re-decodes chords from the separated stems.
 *
 * The mixture pass has to guess harmony through the drums and the vocal line.
 * Once four stems exist there is a far better answer available, so it is taken.
 */
export async function ensureStemChordAnalysis(original: OriginalRecord, separation: SeparationRecord) {
  const existing = await getChordAnalysis(original.id);
  if (existing?.document.algorithmVersion === "atarang-chroma/2-stems") return;
  const running = activeStemChords.get(original.id);
  if (running) return running;

  const promise = (async () => {
    const paths = new Map<string, string>();
    for (const [kind, blobId] of Object.entries(separation.bindings)) {
      const blob = await getBlob(blobId);
      if (blob) paths.set(kind, blob.opfsPath);
    }
    const bassOpfsPath = paths.get("bass");
    const otherOpfsPath = paths.get("other");
    if (!bassOpfsPath || !otherOpfsPath) return;

    const durationUs = Math.round(separation.manifest.original.durationFrames / separation.manifest.original.sampleRate * 1_000_000);
    const beats = await getBeatGrid(original.id);
    const result = await runAnalysisWorker<{ segments: ChordAnalysisV1["segments"]; key: string | null }>(
      { type: "chords/analyze", songId: original.id, generation: 1, otherOpfsPath, bassOpfsPath, boundaries: chordBoundaries(beats?.document.beats.map((beat) => beat.timeUs) ?? [], beats?.document.reliable ?? false, durationUs) },
      "chords/complete", "chords/error",
    );
    const now = new Date().toISOString();
    await putChordAnalysis({ id: original.id, originalId: original.id, schemaVersion: 1, createdAt: now, updatedAt: now, document: chordDocumentFrom(original.id, "atarang-chroma/2-stems", result, now) });
  })().finally(() => activeStemChords.delete(original.id));

  activeStemChords.set(original.id, promise);
  return promise;
}

export async function ensureWaveform(original: OriginalRecord) {
  const [existing,beats,chords] = await Promise.all([getWaveform(original.id),getBeatGrid(original.id),getChordAnalysis(original.id)]);
  if (existing?.algorithmVersion === ALGORITHM_VERSION&&beats?.document.algorithmVersion==="atarang-spectral-flux/1"&&chords?.document.algorithmVersion==="atarang-chroma/2") return existing;
  const running = active.get(original.id); if (running) return running;
  const promise = withSongMutationLease(original.id,()=>analyze(original)).finally(() => active.delete(original.id));
  active.set(original.id, promise); return promise;
}

async function analyze(original: OriginalRecord) {
  const blob = await getBlob(original.blobId); if (!blob) throw new Error("result_integrity_failed");
  const result = await runAnalysisWorker<{ sampleRate:number; channels:number; durationFrames:number; levels:WaveformLevel[];beatAnalysis:{bpm:number;reliability:number;reliable:boolean;beatsFrames:number[]};chordAnalysis:{segments:ChordAnalysisV1["segments"];key:string|null} }>(
    { type:"waveform/analyze", songId:original.id, generation:1, opfsPath:blob.opfsPath },
    "waveform/complete", "waveform/error",
  );
  const now = new Date().toISOString();
  const {beatAnalysis,chordAnalysis,...waveformResult}=result,record: WaveformRecord = { id:original.id, originalId:original.id, schemaVersion:1, createdAt:now, updatedAt:now, algorithmVersion:ALGORITHM_VERSION, ...waveformResult };
  const document:BeatGridV1={schema:"atarang.beats/1",originalId:original.id,revision:0,algorithmVersion:"atarang-spectral-flux/1",bpm:beatAnalysis.bpm,reliability:beatAnalysis.reliability,reliable:beatAnalysis.reliable,userEdited:false,beats:beatAnalysis.beatsFrames.map((frame,index)=>({timeUs:Math.round(frame/result.sampleRate*1_000_000),beatInBar:(index%4+1) as 1|2|3|4,downbeat:index%4===0})),updatedAt:now};
  const existingBeat=await getBeatGrid(original.id);
  const writes:Promise<unknown>[]=[putWaveform(record),putChordAnalysis({id:original.id,originalId:original.id,schemaVersion:1,createdAt:now,updatedAt:now,document:chordDocumentFrom(original.id,"atarang-chroma/2",chordAnalysis,now)})];
  if(!existingBeat?.document.userEdited)writes.push(putBeatGrid({id:original.id,originalId:original.id,schemaVersion:1,createdAt:now,updatedAt:now,document}));
  await Promise.all(writes);
  return record;
}
