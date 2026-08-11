interface ProcessorPort { postMessage(message: unknown): void; onmessage: ((event: MessageEvent) => void) | null }
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: ProcessorPort; constructor(options?: unknown); }
declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

type StemKind = "vocals" | "drums" | "bass" | "other";
interface RingDescriptor { kind: StemKind; sab: SharedArrayBuffer; capacityFrames: number }
interface PracticeDescriptor { loopEnabled: boolean; loopStartFrame: number; loopEndFrame: number; repetitions: number; pauseFrames: number }
interface MetronomeDescriptor {enabled:boolean;countIn:0|2|4;beats:{frame:number;downbeat:boolean}[]}

class AtarangProcessor extends AudioWorkletProcessor {
  #playing = false;
  #rings: RingDescriptor[] = [];
  #sourceFrame = 0;
  #generation = 0;
  #clockFrames = 0;
  #ended = false;
  #loopCount = 0;
  #pauseRemaining = 0;
  #speed = 1;
  #readPhase = 0;
  #metronome:MetronomeDescriptor={enabled:false,countIn:0,beats:[]};
  #beatIndex=0;#clickRemaining=0;#clickLength=1;#clickPhase=0;#clickFrequency=1000;
  #clickCount=0;
  #countingIn=false;#countInRemaining=0;#countInFrames=0;
  #practice: PracticeDescriptor = { loopEnabled: false, loopStartFrame: 0, loopEndFrame: 0, repetitions: 1, pauseFrames: 0 };
  #mixer: Record<StemKind,{gain:number;muted:boolean;solo:boolean}> = {
    vocals:{gain:1,muted:false,solo:false},drums:{gain:1,muted:false,solo:false},bass:{gain:1,muted:false,solo:false},other:{gain:1,muted:false,solo:false},
  };

  constructor(options?: { processorOptions?: { rings?:RingDescriptor[];generation?:number;sourceFrame?:number;practice?:PracticeDescriptor;dsp?:{speed:number};metronome?:MetronomeDescriptor } }) {
    super();
    const settings = options?.processorOptions;
    this.#load(settings?.rings ?? [], settings?.generation ?? 0, settings?.sourceFrame ?? 0, settings?.practice,settings?.dsp,settings?.metronome);
    this.port.onmessage = ({data}) => {
      if(data?.type === "play") this.#beginPlay();
      if(data?.type === "pause") this.#playing = false;
      if(data?.type === "load") this.#load(data.rings,data.generation,data.sourceFrame,data.practice,data.dsp,data.metronome);
      if(data?.type === "mixer") this.#mixer = data.mixer;
      if(data?.type === "practice") this.#setPractice(data.practice);
      if(data?.type === "dsp") this.#setDsp(data.dsp);
      if(data?.type === "metronome") this.#setMetronome(data.metronome);
    };
  }

  #setPractice(practice?: PracticeDescriptor) {
    if (!practice) return;
    this.#practice = practice;
    this.#loopCount = 0;
    this.#pauseRemaining = 0;
  }

  #setDsp(dsp?:{speed:number}){if(dsp)this.#speed=Math.max(.5,Math.min(1,dsp.speed))}
  #seekBeat(){this.#beatIndex=this.#metronome.beats.findIndex(beat=>beat.frame>=this.#sourceFrame);if(this.#beatIndex<0)this.#beatIndex=this.#metronome.beats.length}
  #setMetronome(metronome?:MetronomeDescriptor){if(metronome){this.#metronome=metronome;this.#clickCount=0}this.#seekBeat()}
  #beginPlay(){this.#playing=true;this.#countInRemaining=this.#metronome.beats.length?this.#metronome.countIn:0;this.#countingIn=this.#countInRemaining>0;this.#countInFrames=0}

  #load(rings:RingDescriptor[],generation:number,sourceFrame:number,practice?:PracticeDescriptor,dsp?:{speed:number},metronome?:MetronomeDescriptor) {
    this.#rings=rings;this.#generation=generation;this.#sourceFrame=sourceFrame;this.#clockFrames=0;this.#ended=false;
    this.#readPhase=0;this.#setDsp(dsp);this.#setMetronome(metronome);
    this.#setPractice(practice);
  }

  #consumeOne(outputIndex:number,left:Float32Array,right:Float32Array,available:number) {
    const soloActive=Object.values(this.#mixer).some(value=>value.solo);
    for(const ring of this.#rings){
      const header=new Int32Array(ring.sab,0,8),data=new Float32Array(ring.sab,32),settings=this.#mixer[ring.kind],audible=!settings.muted&&(!soloActive||settings.solo);
      const read=Atomics.load(header,0),next=available>1?(read+1)%ring.capacityFrames:read;
      if(audible){const inverse=1-this.#readPhase;left[outputIndex]=left[outputIndex]!+(data[read*2]!*inverse+data[next*2]!*this.#readPhase)*settings.gain;right[outputIndex]=right[outputIndex]!+(data[read*2+1]!*inverse+data[next*2+1]!*this.#readPhase)*settings.gain}
    }
    left[outputIndex]=Math.max(-1,Math.min(1,left[outputIndex]!));right[outputIndex]=Math.max(-1,Math.min(1,right[outputIndex]!));
    this.#readPhase+=this.#speed;
    if(this.#readPhase>=1){this.#readPhase-=1;for(const ring of this.#rings){const header=new Int32Array(ring.sab,0,8),read=Atomics.load(header,0);Atomics.store(header,0,(read+1)%ring.capacityFrames);Atomics.sub(header,2,1);Atomics.add(header,7,1)}this.#sourceFrame+=1}
  }

  #atLoopBoundary() {
    this.#loopCount += 1;
    if(this.#loopCount >= this.#practice.repetitions){
      this.#playing=false;
      this.port.postMessage({type:"practiceComplete",generation:this.#generation,sourceFrame:this.#sourceFrame,repetition:this.#loopCount});
      return;
    }
    this.#pauseRemaining=this.#practice.pauseFrames;
    if(this.#pauseRemaining===0){this.#sourceFrame=this.#practice.loopStartFrame;this.#seekBeat()}
  }

  #renderClick(index:number,left?:Float32Array,right?:Float32Array){if(!left||!right)return;if(this.#metronome.enabled){while(this.#beatIndex<this.#metronome.beats.length&&this.#metronome.beats[this.#beatIndex]!.frame<=this.#sourceFrame){const beat=this.#metronome.beats[this.#beatIndex++]!;this.#clickLength=Math.max(1,Math.round(sampleRate*.035));this.#clickRemaining=this.#clickLength;this.#clickPhase=0;this.#clickFrequency=beat.downbeat?1320:880;this.#clickCount++}}if(this.#clickRemaining>0){const elapsed=this.#clickLength-this.#clickRemaining,envelope=Math.exp(-7*elapsed/this.#clickLength),value=Math.sin(this.#clickPhase)*envelope*.22;left[index]=value;right[index]=value;this.#clickPhase+=2*Math.PI*this.#clickFrequency/sampleRate;this.#clickRemaining--}}
  #renderCountIn(index:number,left?:Float32Array,right?:Float32Array){if(!left||!right)return;if(this.#countInFrames<=0&&this.#countInRemaining>0){this.#clickLength=Math.max(1,Math.round(sampleRate*.035));this.#clickRemaining=this.#clickLength;this.#clickPhase=0;this.#clickFrequency=this.#countInRemaining===1?1320:880;this.#clickCount++;this.#countInRemaining--;const sourceInterval=this.#metronome.beats.length>1?this.#metronome.beats[1]!.frame-this.#metronome.beats[0]!.frame:sampleRate/2;this.#countInFrames=Math.max(1,Math.round(sourceInterval/this.#speed))}if(this.#clickRemaining>0){const elapsed=this.#clickLength-this.#clickRemaining,envelope=Math.exp(-7*elapsed/this.#clickLength),value=Math.sin(this.#clickPhase)*envelope*.22;left[index]=value;right[index]=value;this.#clickPhase+=2*Math.PI*this.#clickFrequency/sampleRate;this.#clickRemaining--}this.#countInFrames--;if(this.#countInRemaining===0&&this.#countInFrames<=0)this.#countingIn=false}

  #postClock() {
    const reads=this.#rings.map(ring=>Atomics.load(new Int32Array(ring.sab,0,8),7));
    const underruns=this.#rings.reduce((sum,ring)=>sum+Atomics.load(new Int32Array(ring.sab,0,8),5),0);
    this.port.postMessage({type:"clock",generation:this.#generation,sourceFrame:this.#sourceFrame,sampleRate,driftFrames:Math.max(...reads)-Math.min(...reads),underruns,repetition:this.#loopCount+1,metronomeClicks:this.#clickCount});
  }

  process(_inputs:Float32Array[][],outputs:Float32Array[][]) {
    const left=outputs[0]?.[0],right=outputs[0]?.[1],clickLeft=outputs[1]?.[0],clickRight=outputs[1]?.[1];if(!left||!right)return true;left.fill(0);right.fill(0);clickLeft?.fill(0);clickRight?.fill(0);
    if(!this.#playing||this.#rings.length!==4)return true;
    let outputOffset=0;
    while(outputOffset<left.length&&this.#playing){
      if(this.#countingIn){this.#renderCountIn(outputOffset,clickLeft,clickRight);outputOffset++;this.#clockFrames++;continue}
      if(this.#pauseRemaining>0){
        const silent=Math.min(left.length-outputOffset,this.#pauseRemaining);for(let index=0;index<silent;index++)this.#renderClick(outputOffset+index,clickLeft,clickRight);this.#pauseRemaining-=silent;outputOffset+=silent;this.#clockFrames+=silent;
        if(this.#pauseRemaining===0){this.#sourceFrame=this.#practice.loopStartFrame;this.#seekBeat()}
        continue;
      }
      if(this.#practice.loopEnabled&&this.#sourceFrame>=this.#practice.loopEndFrame){this.#atLoopBoundary();continue}
      const available=this.#rings.map(ring=>Atomics.load(new Int32Array(ring.sab,0,8),2));
      const allEnded=this.#rings.every(ring=>Atomics.load(new Int32Array(ring.sab,0,8),3)===1),minimum=Math.min(...available);
      if(minimum===0){
        if(allEnded&&!this.#ended){this.#ended=true;this.#playing=false;this.port.postMessage({type:"ended",generation:this.#generation,sourceFrame:this.#sourceFrame})}
        else if(!allEnded){for(const ring of this.#rings)Atomics.add(new Int32Array(ring.sab,0,8),5,1)}
        break;
      }
      if(minimum<2&&!allEnded){for(const ring of this.#rings)Atomics.add(new Int32Array(ring.sab,0,8),5,1);break}
      this.#renderClick(outputOffset,clickLeft,clickRight);this.#consumeOne(outputOffset,left,right,minimum);outputOffset+=1;this.#clockFrames+=1;
      if(this.#practice.loopEnabled&&this.#sourceFrame>=this.#practice.loopEndFrame)this.#atLoopBoundary();
    }
    if(this.#clockFrames>=sampleRate/10){this.#clockFrames%=Math.max(1,Math.round(sampleRate/10));this.#postClock()}
    return true;
  }
}

registerProcessor("atarang-processor",AtarangProcessor);

interface RecordingRingDescriptor{sab:SharedArrayBuffer;capacityFrames:number}
class AtarangRecorderProcessor extends AudioWorkletProcessor{
  #recording=false;#mic:RecordingRingDescriptor;#backing:RecordingRingDescriptor;
  constructor(options?:{processorOptions?:{mic:RecordingRingDescriptor;backing:RecordingRingDescriptor}}){super();const settings=options?.processorOptions;if(!settings)throw new Error("recording rings are required");this.#mic=settings.mic;this.#backing=settings.backing;this.port.onmessage=({data})=>{if(data?.type==="recording/start")this.#recording=true;if(data?.type==="recording/stop")this.#recording=false}}
  #write(ring:RecordingRingDescriptor,input:Float32Array[]|undefined,frames:number){const header=new Int32Array(ring.sab,0,8),available=Atomics.load(header,2);if(available+frames>ring.capacityFrames){Atomics.store(header,4,1);this.#recording=false;this.port.postMessage({type:"recording/overflow"});return false}const samples=new Float32Array(ring.sab,32),write=Atomics.load(header,0),left=input?.[0],right=input?.[1]??left;for(let frame=0;frame<frames;frame++){const target=(write+frame)%ring.capacityFrames;samples[target*2]=left?.[frame]??0;samples[target*2+1]=right?.[frame]??0}Atomics.store(header,0,(write+frames)%ring.capacityFrames);Atomics.add(header,2,frames);Atomics.add(header,6,frames);return true}
  process(inputs:Float32Array[][],outputs:Float32Array[][]){for(const channel of outputs[0]??[])channel.fill(0);if(!this.#recording)return true;const frames=inputs[0]?.[0]?.length??inputs[1]?.[0]?.length??128;if(!this.#write(this.#mic,inputs[0],frames))return true;this.#write(this.#backing,inputs[1],frames);return true}
}
registerProcessor("atarang-recorder",AtarangRecorderProcessor);
