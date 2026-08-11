import type { StemKind } from "@atarang/contracts";
import { runtimeAssets } from "../generated/runtime-assets";
import type { SeparationRecord } from "../storage/database";
import { getBlob } from "../storage/repositories";
import { uuidV7 } from "../storage/ids";
import { pitchCorrectionSemitones } from "./dsp";

const HEADER_BYTES = 8 * Int32Array.BYTES_PER_ELEMENT;
const RING_SECONDS = 3;

interface RingDescriptor { kind: StemKind; sab: SharedArrayBuffer; capacityFrames: number }
export interface StemMixerState { gain: number; muted: boolean; solo: boolean }
export interface PracticePlaybackSettings { loopEnabled: boolean; loopStartUs: number; loopEndUs: number; repetitions: number; pauseSeconds: number }
export interface DspPlaybackSettings { speed: number; pitchSemitones: number }
export interface MetronomePlaybackSettings {enabled:boolean;countIn:0|2|4;beats:{timeUs:number;downbeat:boolean}[]}
export interface RecordedAsset {sha256:string;blobId:string;opfsPath:string;byteLength:number;mediaType:"audio/wav"}
export interface RecordingResult {sampleRate:number;durationFrames:number;mic:RecordedAsset;backing:RecordedAsset;deviceSettings:MediaTrackSettings;startedAt:string;endedAt:string}
interface StretchNode extends AudioWorkletNode { configure(options:unknown):Promise<unknown>;start(options?:unknown):Promise<unknown>;schedule(options:unknown):Promise<unknown>;latency():Promise<number> }
interface StretchFactory {
  (context:AudioContext,options:AudioWorkletNodeOptions):Promise<StretchNode>;
  moduleUrl?:string;
}
export interface SeparatedPlaybackSnapshot {
  ready: boolean;
  playing: boolean;
  currentTimeUs: number;
  durationUs: number;
  error: string;
  driftFrames: number;
  underruns: number;
  repetition: number;
  metronomeClicks:number;
}

const initialSnapshot = (separation: SeparationRecord): SeparatedPlaybackSnapshot => ({
  ready: false,
  playing: false,
  currentTimeUs: 0,
  durationUs: Math.round(separation.manifest.original.durationFrames / separation.manifest.original.sampleRate * 1_000_000),
  error: "",
  driftFrames: 0,
  underruns: 0,
  repetition: 1,
  metronomeClicks:0,
});

export class SeparatedAudioEngine {
  readonly #separation: SeparationRecord;
  readonly #listeners = new Set<() => void>();
  #snapshot: SeparatedPlaybackSnapshot;
  #context: AudioContext | null = null;
  #node: AudioWorkletNode | null = null;
  #worker: Worker | null = null;
  #rings: RingDescriptor[] = [];
  #generation = 0;
  #sourceFrame = 0;
  #wantedPlaying = false;
  #disposed = false;
  #mixer: Record<StemKind, StemMixerState> | null = null;
  #practice: PracticePlaybackSettings;
  #dsp: DspPlaybackSettings = { speed:1,pitchSemitones:0 };
  #stretchNode: StretchNode | null = null;
  #masterNode: GainNode | null = null;
  #metronome:MetronomePlaybackSettings={enabled:false,countIn:0,beats:[]};
  #recording:null|{requestId:string;operationId:string;startedAt:string;worker:Worker;node:AudioWorkletNode;stream:MediaStream;deviceSettings:MediaTrackSettings} = null;

  constructor(separation: SeparationRecord) {
    this.#separation = separation;
    this.#snapshot = initialSnapshot(separation);
    this.#practice = { loopEnabled:false,loopStartUs:0,loopEndUs:this.#snapshot.durationUs,repetitions:1,pauseSeconds:0 };
  }

  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };

  #update(patch: Partial<SeparatedPlaybackSnapshot>) {
    if (this.#disposed) return;
    this.#snapshot = { ...this.#snapshot, ...patch };
    this.#listeners.forEach((listener) => listener());
  }

  async initialize() {
    if (this.#context || this.#disposed) return;
    if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
      this.#update({ error: "Four-stem playback requires cross-origin-isolated shared memory." });
      return;
    }
    try {
      const context = new AudioContext({ latencyHint: "playback", sampleRate: this.#separation.manifest.original.sampleRate });
      this.#context = context;
      await context.audioWorklet.addModule(runtimeAssets.audioWorklet);
      const stretchModule = await import(runtimeAssets.signalsmithStretch) as {default:StretchFactory};
      stretchModule.default.moduleUrl = runtimeAssets.signalsmithStretch;
      const stretch=await stretchModule.default(context,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      await stretch.configure({preset:"cheaper",splitComputation:true});
      await stretch.start({active:true,semitones:this.#pitchCorrection()});
      if (this.#disposed) { stretch.disconnect();if(context.state!=="closed")await context.close(); return; }
      const master=context.createGain();master.gain.value=1;master.connect(context.destination);this.#masterNode=master;
      stretch.connect(master);this.#stretchNode=stretch;
      await this.#loadAt(0);
    } catch (error) {
      this.#update({ error: error instanceof Error ? error.message : "Four-stem audio could not be initialized." });
    }
  }

  async #loadAt(timeUs: number) {
    const context = this.#context;
    if (!context) return;
    this.#worker?.terminate();
    this.#node?.disconnect();
    this.#generation += 1;
    const generation = this.#generation;
    if(this.#practice.loopEnabled&&timeUs>=this.#practice.loopEndUs)timeUs=this.#practice.loopStartUs;
    const sourceFrame = Math.round(timeUs / 1_000_000 * context.sampleRate);
    const capacityFrames = Math.round(context.sampleRate * RING_SECONDS);
    this.#rings = this.#separation.manifest.stems.map(({ kind }) => ({
      kind,
      capacityFrames,
      sab: new SharedArrayBuffer(HEADER_BYTES + capacityFrames * 2 * Float32Array.BYTES_PER_ELEMENT),
    }));
    this.#sourceFrame = sourceFrame;
    const node = new AudioWorkletNode(context, "atarang-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [2,2],
      processorOptions: { rings: this.#rings, generation, sourceFrame, practice:this.#practiceDescriptor(context.sampleRate),dsp:{speed:this.#dsp.speed},metronome:this.#metronomeDescriptor(context.sampleRate) },
    });
    this.#node = node;
    node.connect(this.#stretchNode??this.#masterNode??context.destination,0,0);node.connect(this.#masterNode??context.destination,1,0);
    node.port.onmessage = ({ data }) => {
      if (data.generation !== this.#generation) return;
      if (data.type === "clock") {
        this.#sourceFrame = data.sourceFrame;
        this.#update({ currentTimeUs: Math.min(this.#snapshot.durationUs, Math.round(data.sourceFrame / data.sampleRate * 1_000_000)), driftFrames: data.driftFrames, underruns: data.underruns, repetition:data.repetition,metronomeClicks:data.metronomeClicks });
      }
      if (data.type === "ended") {
        this.#wantedPlaying = false;
        this.#update({ playing: false, currentTimeUs: this.#snapshot.durationUs });
      }
      if(data.type === "practiceComplete"){this.#wantedPlaying=false;this.#update({playing:false,currentTimeUs:Math.round(data.sourceFrame/context.sampleRate*1_000_000),repetition:data.repetition})}
    };
    if (this.#mixer) node.port.postMessage({ type: "mixer", mixer: this.#mixer });
    this.#update({ ready: false, playing: false, currentTimeUs: timeUs, error: "", driftFrames: 0, underruns: 0, repetition:1,metronomeClicks:0 });

    const blobIds = this.#separation.manifest.stems.map(({ kind }) => this.#separation.bindings[kind]);
    const blobs = await Promise.all(blobIds.map((blobId) => getBlob(blobId)));
    if (generation !== this.#generation || this.#disposed) return;
    if (blobs.some((blob) => !blob)) throw new Error("A stored stem is missing.");
    const worker = new Worker(runtimeAssets.ioWorker, { type: "module", name: "atarang-stem-stream" });
    this.#worker = worker;
    worker.onmessage = ({ data }) => {
      if (data.generation !== this.#generation) return;
      if (data.type === "playback/ready") {
        this.#update({ ready: true });
        if (this.#wantedPlaying) { node.port.postMessage({ type: "play" }); this.#update({ playing: true }); }
      }
      if (data.type === "playback/error") this.#update({ ready: false, playing: false, error: `Stem playback failed: ${data.code}` });
    };
    worker.onerror = () => this.#update({ ready: false, playing: false, error: "Stem playback worker failed." });
    worker.postMessage({
      type: "playback/stream",
      requestId: uuidV7(),
      songId: this.#separation.originalId,
      generation,
      targetSampleRate: context.sampleRate,
      startTime: timeUs / 1_000_000,
      loop: this.#practice.loopEnabled ? { startTime:this.#practice.loopStartUs/1_000_000,endTime:this.#practice.loopEndUs/1_000_000 } : undefined,
      items: this.#rings.map((ring, index) => ({ ...ring, opfsPath: blobs[index]!.opfsPath })),
    });
  }

  async toggle() {
    if (!this.#context || !this.#node) return;
    if(this.#practice.loopEnabled&&this.#snapshot.repetition>=this.#practice.repetitions)await this.seekTo(this.#practice.loopStartUs/1_000_000);
    if (this.#snapshot.currentTimeUs >= this.#snapshot.durationUs) await this.seekTo(0);
    this.#wantedPlaying = !this.#wantedPlaying;
    if (this.#wantedPlaying) {
      await this.#context.resume();
      if (this.#snapshot.ready) { this.#node?.port.postMessage({ type: "play" }); this.#update({ playing: true }); }
    } else {
      this.#node.port.postMessage({ type: "pause" });
      this.#update({ playing: false });
    }
  }

  seekBy(seconds: number) { void this.seekTo(this.#snapshot.currentTimeUs / 1_000_000 + seconds); }
  async seekTo(seconds: number) {
    const targetUs = Math.round(Math.max(0, Math.min(this.#snapshot.durationUs / 1_000_000, seconds)) * 1_000_000);
    await this.#loadAt(targetUs);
  }

  setMixer(mixer: Record<StemKind, StemMixerState>) {
    this.#mixer = mixer;
    this.#node?.port.postMessage({ type: "mixer", mixer });
  }

  setMasterGain(gain:number){if(this.#masterNode)this.#masterNode.gain.value=Math.max(0,Math.min(3.2,gain))}

  #practiceDescriptor(outputSampleRate:number){return{loopEnabled:this.#practice.loopEnabled,loopStartFrame:Math.round(this.#practice.loopStartUs/1_000_000*outputSampleRate),loopEndFrame:Math.round(this.#practice.loopEndUs/1_000_000*outputSampleRate),repetitions:this.#practice.repetitions,pauseFrames:Math.round(this.#practice.pauseSeconds*outputSampleRate)}}

  setPractice(settings:PracticePlaybackSettings){
    const bounded={loopEnabled:settings.loopEnabled&&settings.loopEndUs-settings.loopStartUs>=500_000&&settings.loopEndUs<=this.#snapshot.durationUs,loopStartUs:Math.max(0,Math.min(this.#snapshot.durationUs,Math.round(settings.loopStartUs))),loopEndUs:Math.max(0,Math.min(this.#snapshot.durationUs,Math.round(settings.loopEndUs))),repetitions:Math.max(1,Math.min(999,Math.round(settings.repetitions))),pauseSeconds:Math.max(0,Math.min(10,settings.pauseSeconds))};
    const streamChanged=bounded.loopEnabled!==this.#practice.loopEnabled||bounded.loopStartUs!==this.#practice.loopStartUs||bounded.loopEndUs!==this.#practice.loopEndUs;
    this.#practice=bounded;
    if(streamChanged&&this.#context){void this.#loadAt(this.#snapshot.currentTimeUs).catch(error=>this.#update({error:error instanceof Error?error.message:"Loop could not be applied."}));return}
    if(this.#context)this.#node?.port.postMessage({type:"practice",practice:this.#practiceDescriptor(this.#context.sampleRate)});
  }

  #pitchCorrection(){return pitchCorrectionSemitones(this.#dsp.speed,this.#dsp.pitchSemitones)}
  setDsp(settings:DspPlaybackSettings){this.#dsp={speed:Math.max(.5,Math.min(1,settings.speed)),pitchSemitones:Math.max(-12,Math.min(12,Math.round(settings.pitchSemitones)))};this.#node?.port.postMessage({type:"dsp",dsp:{speed:this.#dsp.speed}});void this.#stretchNode?.schedule({semitones:this.#pitchCorrection(),tonalityHz:8000})}
  #metronomeDescriptor(outputSampleRate:number){return{enabled:this.#metronome.enabled,countIn:this.#metronome.countIn,beats:this.#metronome.beats.map(beat=>({frame:Math.round(beat.timeUs/1_000_000*outputSampleRate),downbeat:beat.downbeat}))}}
  setMetronome(settings:MetronomePlaybackSettings){this.#metronome=settings;this.#node?.port.postMessage({type:"metronome",metronome:this.#context?this.#metronomeDescriptor(this.#context.sampleRate):{enabled:false,countIn:0,beats:[]}})}

  async startRecording(operationId:string){const context=this.#context,stretch=this.#stretchNode;if(!context||!stretch||this.#recording)throw new Error("recording_unavailable");if(!crossOriginIsolated||typeof SharedArrayBuffer==="undefined")throw new Error("recording_requires_isolation");const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:2},echoCancellation:false,noiseSuppression:false,autoGainControl:false}}),track=stream.getAudioTracks()[0];if(!track){stream.getTracks().forEach(item=>item.stop());throw new Error("recording_device_lost")}const capacityFrames=Math.round(context.sampleRate*6),makeRing=()=>({capacityFrames,sab:new SharedArrayBuffer(HEADER_BYTES+capacityFrames*2*Float32Array.BYTES_PER_ELEMENT)}),mic=makeRing(),backing=makeRing(),requestId=uuidV7(),worker=new Worker(runtimeAssets.recordingWorker,{type:"module",name:"atarang-recording-writer"});await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("recording_writer_timeout")),5000);worker.onmessage=({data})=>{if(data.requestId!==requestId)return;if(data.type==="recording/ready"){clearTimeout(timeout);resolve()}if(data.type==="recording/error"){clearTimeout(timeout);reject(new Error(data.code))}};worker.onerror=()=>reject(new Error("recording_writer_failed"));worker.postMessage({type:"recording/start",requestId,operationId,sampleRate:context.sampleRate,mic,backing})});const recorder=new AudioWorkletNode(context,"atarang-recorder",{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{mic,backing}}),source=context.createMediaStreamSource(stream);source.connect(recorder,0,0);stretch.connect(recorder,0,1);recorder.connect(context.destination);recorder.port.postMessage({type:"recording/start"});const startedAt=new Date().toISOString(),deviceSettings=track.getSettings();this.#recording={requestId,operationId,startedAt,worker,node:recorder,stream,deviceSettings};track.addEventListener("ended",()=>{if(this.#recording?.requestId===requestId)recorder.port.postMessage({type:"recording/stop"})},{once:true});return{startedAt,deviceSettings}}
  async stopRecording():Promise<RecordingResult>{const session=this.#recording;if(!session)throw new Error("recording_not_active");this.#recording=null;session.node.port.postMessage({type:"recording/stop"});session.stream.getTracks().forEach(track=>track.stop());const result=await new Promise<{sampleRate:number;durationFrames:number;mic:RecordedAsset;backing:RecordedAsset}>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("recording_writer_timeout")),10000);session.worker.onmessage=({data})=>{if(data.requestId!==session.requestId)return;if(data.type==="recording/complete"){clearTimeout(timeout);resolve(data)}if(data.type==="recording/error"){clearTimeout(timeout);reject(new Error(data.code))}};session.worker.onerror=()=>reject(new Error("recording_writer_failed"));session.worker.postMessage({type:"recording/stop",requestId:session.requestId})}).finally(()=>{session.node.disconnect();session.worker.terminate()});return{...result,deviceSettings:session.deviceSettings,startedAt:session.startedAt,endedAt:new Date().toISOString()}}

  dispose() {
    this.#disposed = true;
    this.#worker?.terminate();
    this.#node?.disconnect();
    this.#stretchNode?.disconnect();
    this.#masterNode?.disconnect();
    if(this.#recording){this.#recording.stream.getTracks().forEach(track=>track.stop());this.#recording.node.disconnect();this.#recording.worker.terminate();this.#recording=null}
    void this.#context?.close();
    this.#listeners.clear();
  }
}
