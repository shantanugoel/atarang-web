import { useCallback, useEffect, useRef, useState } from "react";
import type { BeatGridV1,StemKind } from "@atarang/contracts";
import {assertPerformanceManifest,type PerformanceManifestV1} from "@atarang/contracts";
import { SeparatedAudioEngine, type SeparatedPlaybackSnapshot, type StemMixerState } from "../../audio/SeparatedAudioEngine";
import type { SeparationRecord } from "../../storage/database";
import type {BlobRecord,OperationRecord,PerformanceRecord} from "../../storage/database";
import {failImportOperation,publishPerformance,startImportOperation} from "../../storage/repositories";
import {uuidV7} from "../../storage/ids";
import { useStudioStore } from "./studioStore";
import type { ImportedPlayback } from "./useImportedAudio";

const empty: SeparatedPlaybackSnapshot = { ready: false, playing: false, currentTimeUs: 0, durationUs: 0, error: "", driftFrames: 0, underruns: 0, repetition:1,metronomeClicks:0 };
const mixerFromState = (state: ReturnType<typeof useStudioStore.getState>): Record<StemKind, StemMixerState> => ({
  vocals: { gain: 10 ** (state.levels.vocals / 20), muted: state.muted.vocals, solo: state.soloed.vocals },
  drums: { gain: 10 ** (state.levels.drums / 20), muted: state.muted.drums, solo: state.soloed.drums },
  bass: { gain: 10 ** (state.levels.bass / 20), muted: state.muted.bass, solo: state.soloed.bass },
  other: { gain: 10 ** (state.levels.other / 20), muted: state.muted.other, solo: state.soloed.other },
});

export function useSeparatedAudio(separation?: SeparationRecord, beatGrid?:BeatGridV1|null): ImportedPlayback {
  const [engine, setEngine] = useState<SeparatedAudioEngine | null>(null);
  const [snapshot, setSnapshot] = useState<SeparatedPlaybackSnapshot>(empty);
  const [recording,setRecording]=useState(false),[recordingError,setRecordingError]=useState("");
  const operationRef=useRef<OperationRecord|null>(null);
  const beatGridRef=useRef(beatGrid);beatGridRef.current=beatGrid;

  useEffect(() => {
    if (!separation) { setEngine(null); setSnapshot(empty); return; }
    const next = new SeparatedAudioEngine(separation);
    setEngine(next);
    setSnapshot(next.getSnapshot());
    const refresh = () => setSnapshot(next.getSnapshot());
    const unsubscribeEngine = next.subscribe(refresh);
    next.setMixer(mixerFromState(useStudioStore.getState()));
    const initial=useStudioStore.getState();next.setPractice({loopEnabled:initial.loopEnabled,loopStartUs:initial.loopStartUs,loopEndUs:initial.loopEndUs,repetitions:initial.repetitions,pauseSeconds:initial.pause});
    next.setDsp({speed:initial.speed,pitchSemitones:initial.pitch});
    next.setMetronome({enabled:initial.metronome&&Boolean(beatGridRef.current?.reliable),countIn:initial.countIn as 0|2|4,beats:beatGridRef.current?.beats??[]});
    const unsubscribeMixer = useStudioStore.subscribe((state, previous) => {
      if (state.levels !== previous.levels || state.muted !== previous.muted || state.soloed !== previous.soloed) next.setMixer(mixerFromState(state));
      if(state.loopEnabled!==previous.loopEnabled||state.loopStartUs!==previous.loopStartUs||state.loopEndUs!==previous.loopEndUs||state.repetitions!==previous.repetitions||state.pause!==previous.pause)next.setPractice({loopEnabled:state.loopEnabled,loopStartUs:state.loopStartUs,loopEndUs:state.loopEndUs,repetitions:state.repetitions,pauseSeconds:state.pause});
      if(state.speed!==previous.speed||state.pitch!==previous.pitch)next.setDsp({speed:state.speed,pitchSemitones:state.pitch});
      if(state.metronome!==previous.metronome||state.countIn!==previous.countIn)next.setMetronome({enabled:state.metronome&&Boolean(beatGridRef.current?.reliable),countIn:state.countIn as 0|2|4,beats:beatGridRef.current?.beats??[]});
    });
    void next.initialize();
    return () => { unsubscribeEngine(); unsubscribeMixer(); next.dispose(); };
  }, [separation]);
  useEffect(()=>{if(engine){const state=useStudioStore.getState();engine.setMetronome({enabled:state.metronome&&Boolean(beatGrid?.reliable),countIn:state.countIn as 0|2|4,beats:beatGrid?.beats??[]})}},[beatGrid,engine]);

  const toggle = useCallback(async () => { await engine?.toggle(); }, [engine]);
  const seekBy = useCallback((seconds: number) => engine?.seekBy(seconds), [engine]);
  const seekTo = useCallback((seconds: number) => { void engine?.seekTo(seconds); }, [engine]);
  const toggleRecording=useCallback(async()=>{if(!engine)return;setRecordingError("");try{if(!recording){const now=new Date().toISOString(),operation:OperationRecord={id:uuidV7(),schemaVersion:1,createdAt:now,updatedAt:now,status:"staging",kind:"recording",originalId:separation!.originalId};operationRef.current=operation;await startImportOperation(operation);await engine.startRecording(operation.id);setRecording(true);if(!engine.getSnapshot().playing)await engine.toggle();return}const result=await engine.stopRecording(),operation=operationRef.current;if(!operation)throw new Error("recording_operation_missing");const now=result.endedAt,durationUs=Math.round(result.durationFrames/result.sampleRate*1_000_000),settings=result.deviceSettings,manifest:PerformanceManifestV1={schema:"atarang.performance/1",performanceId:uuidV7(),originalId:separation!.originalId,revision:0,startedAt:result.startedAt,endedAt:result.endedAt,sampleRate:result.sampleRate,channels:2,durationFrames:result.durationFrames,mic:{blobId:result.mic.blobId,sha256:result.mic.sha256,byteLength:result.mic.byteLength,mediaType:"audio/wav"},backing:{blobId:result.backing.blobId,sha256:result.backing.sha256,byteLength:result.backing.byteLength,mediaType:"audio/wav"},inputOffsetUs:0,deviceSettings:{...(settings.sampleRate===undefined?{}:{sampleRate:settings.sampleRate}),...(settings.channelCount===undefined?{}:{channelCount:settings.channelCount}),...(settings.echoCancellation===undefined?{}:{echoCancellation:settings.echoCancellation}),...(settings.noiseSuppression===undefined?{}:{noiseSuppression:settings.noiseSuppression}),...(settings.autoGainControl===undefined?{}:{autoGainControl:settings.autoGainControl})},edit:{trimStartUs:0,trimEndUs:durationUs,fadeInUs:0,fadeOutUs:0},updatedAt:now};assertPerformanceManifest(manifest);const record:PerformanceRecord={id:manifest.performanceId,originalId:manifest.originalId,revision:0,schemaVersion:1,createdAt:result.startedAt,updatedAt:now,manifest},blobs:BlobRecord[]=[result.mic,result.backing].map(asset=>({id:asset.blobId,schemaVersion:1,createdAt:now,updatedAt:now,sha256:asset.sha256,byteLength:asset.byteLength,mediaType:asset.mediaType,opfsPath:asset.opfsPath,referenceCount:1}));await publishPerformance(record,blobs,operation);operationRef.current=null;setRecording(false)}catch(error){const operation=operationRef.current;if(operation)await failImportOperation(operation.id,error instanceof Error?error.message:"recording_failed");operationRef.current=null;setRecording(false);setRecordingError(error instanceof Error?error.message:"recording_failed")}},[engine,recording,separation]);
  return { ...snapshot, toggle, seekBy, seekTo,recording,recordingError,toggleRecording };
}
