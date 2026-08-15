import { runtimeAssets } from "../../generated/runtime-assets";
import type { OriginalRecord, SeparationRecord, WaveformLevel, WaveformRecord } from "../../storage/database";
import {CURRENT_BEAT_ALGORITHM,CURRENT_CHORD_ALGORITHMS,type BeatGridV1,type ChordAlgorithmV1,type ChordAnalysisV1} from "@atarang/contracts";
import { chordBoundaries } from "../analysis/chordDetection";
import { uuidV7 } from "../../storage/ids";
import {withSongMutationLease} from "../../storage/mutationLease";
import { getBeatGrid,getBlob,getChordAnalysis,getWaveform,putBeatGrid,putChordAnalysis,putWaveform } from "../../storage/repositories";

const ALGORITHM_VERSION = "atarang-waveform/1" as const;
const active = new Map<string, Promise<WaveformRecord>>();
const activeStemChords = new Map<string, Promise<void>>();
// Held apart from the promise so that a caller arriving mid-decode still gets
// progress. The alternative — attaching the callback only to the call that
// started the run — silently stops reporting the moment a re-render calls in
// again, which is exactly when the song is long enough to need the report.
const stemChordProgress = new Map<string, (fraction: number) => void>();

function chordDocumentFrom(originalId: string, algorithmVersion: ChordAlgorithmV1, analysis: { segments: ChordAnalysisV1["segments"]; key: string | null }, now: string): ChordAnalysisV1 {
  // The detector reports the key it decoded against; a duration-weighted vote
  // over the segments would just name whichever chord was held longest.
  let confidenceTotal = 0, durationTotal = 0;
  for (const segment of analysis.segments) { const duration = segment.endTimeUs - segment.startTimeUs; confidenceTotal += duration * segment.confidence; durationTotal += duration; }
  return { schema: "atarang.chords/1", originalId, revision: 0, algorithmVersion, key: analysis.key, confidence: durationTotal ? confidenceTotal / durationTotal : 0, segments: analysis.segments, updatedAt: now };
}

function runAnalysisWorker<T>(message: object, completeType: string, errorType: string, onProgress?: { type: string; report: (frames: number) => void }) {
  const requestId = uuidV7();
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(runtimeAssets.analysisWorker, { type: "module", name: "atarang-analysis" });
    worker.onmessage = ({ data }) => {
      if (data.requestId !== requestId) return;
      if (data.type === completeType) { worker.terminate(); resolve(data as T); }
      if (data.type === errorType) { worker.terminate(); reject(new Error(data.code)); }
      if (onProgress && data.type === onProgress.type) onProgress.report(data.frames);
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
export async function ensureStemChordAnalysis(original: OriginalRecord, separation: SeparationRecord, onProgress?: (fraction: number) => void) {
  // The mixture pass first, always. It writes the beat grid this decode places
  // its chords on — without it the boundaries fall back to fixed half-seconds —
  // and it writes a chord analysis of its own, so letting the two run at once
  // means racing to be the last one to save. Repeated calls are deduplicated,
  // so this costs nothing once the song has been analysed.
  await ensureWaveform(original).catch(() => {});
  const existing = await getChordAnalysis(original.id);
  // Only an analysis that already came from the stems is left alone. A decode of
  // the mixture — learned or not — had to find the harmony through the drums and
  // the vocal line, and this pass does not.
  // ponytail: a song decoded from stems on a browser that could not load the
  // model keeps that decode even if the model later works. The per-song
  // re-analyse action is the way out; nothing here can tell the difference
  // without running the model to find out.
  if (existing?.document.algorithmVersion.endsWith("-stems")) return;
  if (onProgress) stemChordProgress.set(original.id, onProgress); else stemChordProgress.delete(original.id);
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
    // The "other" stem is the one the worker counts frames against.
    const stemFrames = separation.manifest.stems.find((stem) => stem.kind === "other")?.durationFrames ?? 0;
    const result = await runAnalysisWorker<{ segments: ChordAnalysisV1["segments"]; key: string | null; algorithm: ChordAlgorithmV1 }>(
      { type: "chords/analyze", songId: original.id, generation: 1, otherOpfsPath, bassOpfsPath, boundaries: chordBoundaries(beats?.document.beats.map((beat) => beat.timeUs) ?? [], beats?.document.reliable ?? false, durationUs) },
      "chords/complete", "chords/error",
      stemFrames ? { type: "chords/progress", report: (frames) => stemChordProgress.get(original.id)?.(Math.min(1, frames / stemFrames)) } : undefined,
    );
    const now = new Date().toISOString();
    await putChordAnalysis({ id: original.id, originalId: original.id, schemaVersion: 1, createdAt: now, updatedAt: now, document: chordDocumentFrom(original.id, result.algorithm, result, now) });
  })().finally(() => { activeStemChords.delete(original.id); stemChordProgress.delete(original.id); });

  activeStemChords.set(original.id, promise);
  return promise;
}

/**
 * The in-flight slot is claimed before the first await, not after the lookups.
 *
 * `useWaveform` and `useBeatGrid` mount together and both call this, and the
 * three storage reads gave them all the time they needed to pass the in-flight
 * check one after the other. Both then took the song lease; one analysed and
 * one was refused. `useBeatGrid` recovered through its library subscription,
 * but `useWaveform` has none, so it sat on "Retry chord detection" for an
 * analysis that had in fact succeeded and was already stored. Claiming the slot
 * synchronously is what makes the second caller a second caller — widening the
 * lease would only move the race.
 */
export function ensureWaveform(original: OriginalRecord): Promise<WaveformRecord> {
  const running = active.get(original.id); if (running) return running;
  const promise = (async () => {
    const [existing,beats,chords] = await Promise.all([getWaveform(original.id),getBeatGrid(original.id),getChordAnalysis(original.id)]);
    // Any current chord algorithm counts. Requiring the mixture one exactly would
    // re-run the whole pass on every open of a song whose chords have since been
    // upgraded to the stem decode, and then overwrite that better answer.
    // A grid the user corrected counts as current whatever detector produced it:
    // the analysis below refuses to overwrite it, so asking for it again would
    // re-run the whole pass on every open and never settle.
    const beatsCurrent=beats?.document.algorithmVersion===CURRENT_BEAT_ALGORITHM||beats?.document.userEdited;
    if (existing?.algorithmVersion === ALGORITHM_VERSION&&beatsCurrent&&CURRENT_CHORD_ALGORITHMS.includes(chords?.document.algorithmVersion as ChordAlgorithmV1)) return existing;
    return withSongMutationLease(original.id,()=>analyze(original));
  })().finally(() => active.delete(original.id));
  active.set(original.id, promise); return promise;
}

async function analyze(original: OriginalRecord) {
  const blob = await getBlob(original.blobId); if (!blob) throw new Error("result_integrity_failed");
  const result = await runAnalysisWorker<{ sampleRate:number; channels:number; durationFrames:number; levels:WaveformLevel[];beatAnalysis:{bpm:number;reliability:number;reliable:boolean;beatsFrames:number[];downbeatPhase:number};chordAnalysis:{segments:ChordAnalysisV1["segments"];key:string|null;algorithm:ChordAlgorithmV1} }>(
    { type:"waveform/analyze", songId:original.id, generation:1, opfsPath:blob.opfsPath },
    "waveform/complete", "waveform/error",
  );
  const now = new Date().toISOString();
  const {beatAnalysis,chordAnalysis,...waveformResult}=result,record: WaveformRecord = { id:original.id, originalId:original.id, schemaVersion:1, createdAt:now, updatedAt:now, algorithmVersion:ALGORITHM_VERSION, ...waveformResult };
  const document:BeatGridV1={schema:"atarang.beats/1",originalId:original.id,revision:0,algorithmVersion:CURRENT_BEAT_ALGORITHM,bpm:beatAnalysis.bpm,reliability:beatAnalysis.reliability,reliable:beatAnalysis.reliable,userEdited:false,beats:beatAnalysis.beatsFrames.map((frame,index)=>{const beatInBar=(((index-beatAnalysis.downbeatPhase)%4+4)%4+1) as 1|2|3|4;return{timeUs:Math.round(frame/result.sampleRate*1_000_000),beatInBar,downbeat:beatInBar===1}}),updatedAt:now};
  const [existingBeat,existingChords]=await Promise.all([getBeatGrid(original.id),getChordAnalysis(original.id)]);
  const writes:Promise<unknown>[]=[putWaveform(record)];
  // A decode of the stems saw harmony this pass had to guess at through the
  // drums and the vocal line, so it is not overwritten by one — the same way a
  // beat grid the user corrected is not. Re-running this pass for its waveform
  // or its beats used to cost the better chords as a side effect.
  if(!existingChords?.document.algorithmVersion.endsWith("-stems"))writes.push(putChordAnalysis({id:original.id,originalId:original.id,schemaVersion:1,createdAt:now,updatedAt:now,document:chordDocumentFrom(original.id,chordAnalysis.algorithm,chordAnalysis,now)}));
  if(!existingBeat?.document.userEdited)writes.push(putBeatGrid({id:original.id,originalId:original.id,schemaVersion:1,createdAt:now,updatedAt:now,document}));
  await Promise.all(writes);
  return record;
}
