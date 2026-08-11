import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import FFT from "fft.js";
import {detectBeatGrid} from "../features/analysis/beatDetection";
import {classifyChroma,mergeChordWindows} from "../features/analysis/chordDetection";

interface WaveformRequest { type: "waveform/analyze"; requestId: string; songId: string; generation: number; opfsPath: string }
const BASE_BUCKET = 256;
const LEVEL_BUCKETS = [256, 1024, 4096, 16384] as const;
const FFT_SIZE=2048,HOP_FRAMES=1024;

async function fileForPath(path: string) {
  const parts = path.split("/").filter(Boolean); const name = parts.pop();
  if (!name) throw new Error("invalid_source");
  let directory = await navigator.storage.getDirectory();
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return (await directory.getFileHandle(name)).getFile();
}

function aggregateLevel(baseMin: number[], baseMax: number[], baseMeanSquare: number[], baseCounts: number[], factor: number) {
  const length = Math.ceil(baseMin.length / factor);
  const min = new Float32Array(length); const max = new Float32Array(length); const rms = new Float32Array(length);
  for (let output = 0; output < length; output++) {
    let low = 1; let high = -1; let weightedSquares = 0; let count = 0;
    for (let index = output * factor; index < Math.min(baseMin.length, (output + 1) * factor); index++) {
      low = Math.min(low, baseMin[index]!); high = Math.max(high, baseMax[index]!);
      weightedSquares += baseMeanSquare[index]! * baseCounts[index]!; count += baseCounts[index]!;
    }
    min[output] = low; max[output] = high; rms[output] = count ? Math.sqrt(weightedSquares / count) : 0;
  }
  return { min, max, rms };
}

self.onmessage = async ({ data }: MessageEvent<WaveformRequest>) => {
  if (data.type !== "waveform/analyze") return;
  const identity = { requestId: data.requestId, songId: data.songId, generation: data.generation };
  try {
    const file = await fileForPath(data.opfsPath);
    const input = new Input({ source: new BlobSource(file, { maxCacheSize: 8 * 1024 * 1024 }), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error("unsupported_format");
    const sampleRate = await track.getSampleRate(); const channels = await track.getNumberOfChannels();
    const sink = new AudioSampleSink(track);
    const fft=new FFT(FFT_SIZE),fftInput=new Array<number>(FFT_SIZE).fill(0),fftOutput=fft.createComplexArray(),previousMagnitude=new Float64Array(FFT_SIZE/2+1),analysisBuffer=new Float32Array(FFT_SIZE),flux:number[]=[],chroma=new Float64Array(12),chordWindows:{startFrame:number;endFrame:number;chord:string;confidence:number}[]=[];let analysisFill=0,chordFrameCount=0,chordWindowStart=0;
    const flushChord=(endFrame:number)=>{if(!chordFrameCount)return;const value=classifyChroma(chroma);chordWindows.push({startFrame:chordWindowStart,endFrame,chord:value.chord,confidence:value.confidence});chroma.fill(0);chordFrameCount=0;chordWindowStart=endFrame};
    const analyzeFrame=()=>{for(let index=0;index<FFT_SIZE;index++)fftInput[index]=analysisBuffer[index]!*(.5-.5*Math.cos(2*Math.PI*index/(FFT_SIZE-1)));fft.realTransform(fftOutput,fftInput);let novelty=0;for(let bin=1;bin<=FFT_SIZE/2;bin++){const magnitude=Math.log1p(Math.hypot(fftOutput[bin*2]!,fftOutput[bin*2+1]!)),difference=magnitude-previousMagnitude[bin]!;if(difference>0)novelty+=difference;previousMagnitude[bin]=magnitude;const frequency=bin*sampleRate/FFT_SIZE;if(frequency>=55&&frequency<=5000){const midi=Math.round(69+12*Math.log2(frequency/440)),pitchClass=(midi%12+12)%12;chroma[pitchClass]=chroma[pitchClass]!+magnitude}}flux.push(novelty);chordFrameCount++;const analyzedEnd=(flux.length-1)*HOP_FRAMES+FFT_SIZE;if(chordFrameCount>=Math.max(1,Math.round(sampleRate/HOP_FRAMES)))flushChord(analyzedEnd);analysisBuffer.copyWithin(0,HOP_FRAMES);analysisFill-=HOP_FRAMES};
    const baseMin: number[] = []; const baseMax: number[] = []; const baseMeanSquare: number[] = []; const baseCounts: number[] = [];
    let bucketMin = 1; let bucketMax = -1; let bucketSumSquares = 0; let bucketCount = 0; let durationFrames = 0; let lastProgress = 0;
    const flush = () => { if (!bucketCount) return; baseMin.push(bucketMin); baseMax.push(bucketMax); baseMeanSquare.push(bucketSumSquares / bucketCount); baseCounts.push(bucketCount); bucketMin=1;bucketMax=-1;bucketSumSquares=0;bucketCount=0; };
    for await (const sample of sink.samples()) {
      const mono = new Float32Array(sample.numberOfFrames);
      for (let channel = 0; channel < sample.numberOfChannels; channel++) {
        const plane = new Float32Array(sample.numberOfFrames);
        sample.copyTo(plane, { format: "f32-planar", planeIndex: channel });
        for (let frame = 0; frame < plane.length; frame++) mono[frame] = mono[frame]! + plane[frame]! / sample.numberOfChannels;
      }
      for (const value of mono) {
        bucketMin = Math.min(bucketMin, value); bucketMax = Math.max(bucketMax, value); bucketSumSquares += value * value; bucketCount++; durationFrames++;
        if (bucketCount === BASE_BUCKET) flush();
        analysisBuffer[analysisFill++]=value;if(analysisFill===FFT_SIZE)analyzeFrame();
      }
      sample.close();
      if (durationFrames - lastProgress >= sampleRate) { lastProgress = durationFrames; self.postMessage({ type: "waveform/progress", ...identity, durationFrames }); }
    }
    flush(); input.dispose();
    const levels = LEVEL_BUCKETS.map((framesPerBucket) => ({ framesPerBucket, ...aggregateLevel(baseMin, baseMax, baseMeanSquare, baseCounts, framesPerBucket / BASE_BUCKET) }));
    flushChord(durationFrames);if(chordWindows.length&&chordWindows.at(-1)!.endFrame<durationFrames)chordWindows.at(-1)!.endFrame=durationFrames;const beatAnalysis=detectBeatGrid(flux,sampleRate,HOP_FRAMES,durationFrames),chordAnalysis={segments:mergeChordWindows(chordWindows,sampleRate)};
    const transfer = levels.flatMap((level) => [level.min.buffer, level.max.buffer, level.rms.buffer]);
    self.postMessage({ type: "waveform/complete", ...identity, sampleRate, channels, durationFrames, levels,beatAnalysis,chordAnalysis }, { transfer });
  } catch (error) {
    self.postMessage({ type: "waveform/error", ...identity, code: error instanceof Error ? error.message : "analysis_failed" });
  }
};
export {};
