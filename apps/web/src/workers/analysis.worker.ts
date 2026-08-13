import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import FFT from "fft.js";
import { detectBeatGrid } from "../features/analysis/beatDetection";
import { TUNING_BINS, accumulateTuning, bassChromaFrame, chordBoundaries, chromaGeometry, detectChords, harmonicChromaFrame, keyName, tuningReference } from "../features/analysis/chordDetection";

interface WaveformRequest { type: "waveform/analyze"; requestId: string; songId: string; generation: number; opfsPath: string }
/**
 * Chords from the separated stems.
 *
 * Vocals and drums never reach here: a sung melody note is not the harmony and
 * frequently disagrees with it, and drums put broadband noise into every pitch
 * class equally. Bass arrives below full weight because its fundamental would
 * otherwise dominate a normalised profile and turn every chord into its own
 * root — but it is also the only honest witness to which inversion is playing,
 * so it is scored separately as well.
 */
interface StemChordRequest { type: "chords/analyze"; requestId: string; songId: string; generation: number; otherOpfsPath: string; bassOpfsPath: string; boundaries: number[] }
const BASS_HARMONIC_WEIGHT = 0.8;

const BASE_BUCKET = 256;
const LEVEL_BUCKETS = [256, 1024, 4096, 16384] as const;
const FFT_SIZE = 2048, HOP_FRAMES = 1024;

async function fileForPath(path: string) {
  const parts = path.split("/").filter(Boolean); const name = parts.pop();
  if (!name) throw new Error("invalid_source");
  let directory = await navigator.storage.getDirectory();
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return (await directory.getFileHandle(name)).getFile();
}

/** Opens one OPFS audio file as a stream of mono chunks, rate known up front. */
async function openMono(opfsPath: string) {
  const input = new Input({ source: new BlobSource(await fileForPath(opfsPath), { maxCacheSize: 8 * 1024 * 1024 }), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) { input.dispose(); throw new Error("unsupported_format"); }
  return {
    sampleRate: await track.getSampleRate(),
    channels: await track.getNumberOfChannels(),
    dispose: () => input.dispose(),
    async *chunks() {
      for await (const sample of new AudioSampleSink(track).samples()) {
        const mono = new Float32Array(sample.numberOfFrames);
        for (let channel = 0; channel < sample.numberOfChannels; channel++) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { format: "f32-planar", planeIndex: channel });
          for (let frame = 0; frame < plane.length; frame++) mono[frame] = mono[frame]! + plane[frame]! / sample.numberOfChannels;
        }
        sample.close();
        yield mono;
      }
    },
  };
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

/**
 * Chroma runs on its own framing: long windows at the source rate. The flux used
 * for beats wants the opposite — short windows, fine time resolution — so the
 * two cannot share an FFT.
 *
 * Frames are *centred* on their own timestamp. An uncentred frame describes the
 * 186 ms that follow it, so every frame in the last beat of a bar already
 * contains a third of the chord that comes next, which moves every chord change
 * a beat early.
 */
class ChromaStream {
  readonly frames: { harmonic: Float64Array; bass: Float64Array; energy: number }[] = [];
  readonly hopSeconds: number;
  readonly #sampleRate: number;
  readonly #size: number;
  readonly #hop: number;
  readonly #fft: FFT;
  readonly #spectrum: number[];
  readonly #input: number[];
  readonly #magnitudes: Float64Array;
  readonly #window: number[];
  readonly #harmonic: Float32Array;
  readonly #bass: Float32Array;
  readonly #tuning = new Float64Array(TUNING_BINS);
  #fill: number;

  constructor(sampleRate: number) {
    const geometry = chromaGeometry(sampleRate);
    this.#sampleRate = sampleRate;
    this.#size = geometry.size;
    this.#hop = geometry.hop;
    this.hopSeconds = geometry.hop / sampleRate;
    this.#fft = new FFT(geometry.size);
    this.#spectrum = this.#fft.createComplexArray();
    this.#input = new Array<number>(geometry.size).fill(0);
    this.#magnitudes = new Float64Array(geometry.size / 2 + 1);
    this.#window = Array.from({ length: geometry.size }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (geometry.size - 1)));
    this.#harmonic = new Float32Array(geometry.size);
    this.#bass = new Float32Array(geometry.size);
    // Half a window of leading silence is what centres the first frame.
    this.#fill = geometry.size / 2;
  }

  /** What the recording is tuned to and how tonal it is, so far. */
  get tuning() { return tuningReference(this.#tuning); }

  push(harmonic: number, bass: number) {
    this.#harmonic[this.#fill] = harmonic;
    this.#bass[this.#fill] = bass;
    if (++this.#fill < this.#size) return;
    // The estimate is taken from the histogram as it stands and fed straight
    // back into this frame. It converges within the first seconds and is only
    // ever 440 before then, which is what the whole song used to use.
    // ponytail: the opening frames are read at the wrong reference; a
    // higher-resolution chroma folded to twelve at the end would remove that.
    const reference = this.tuning.reference;
    const profile = this.#profile(this.#harmonic, harmonicChromaFrame, reference, true);
    this.frames.push({ harmonic: profile.chroma, bass: this.#profile(this.#bass, bassChromaFrame, reference).chroma, energy: profile.energy });
    this.#harmonic.copyWithin(0, this.#hop);
    this.#bass.copyWithin(0, this.#hop);
    this.#fill -= this.#hop;
  }

  /** Pads the tail so the final frames cover the end of the song. */
  finish() { for (let index = 0; index < this.#size / 2; index++) this.push(0, 0); }

  /** `tune` only on the harmonic pass: the bass band would count the same low partials twice. */
  #profile(buffer: Float32Array, extract: (magnitudes: ArrayLike<number>, sampleRate: number, size: number, reference: number) => { chroma: Float64Array; energy: number }, reference: number, tune = false) {
    for (let index = 0; index < this.#size; index++) this.#input[index] = buffer[index]! * this.#window[index]!;
    this.#fft.realTransform(this.#spectrum, this.#input);
    for (let bin = 0; bin <= this.#size / 2; bin++) this.#magnitudes[bin] = Math.hypot(this.#spectrum[bin * 2]!, this.#spectrum[bin * 2 + 1]!);
    if (tune) accumulateTuning(this.#tuning, this.#magnitudes, this.#sampleRate, this.#size);
    return extract(this.#magnitudes, this.#sampleRate, this.#size, reference);
  }
}

async function analyseWaveform(data: WaveformRequest, identity: object) {
  const fft = new FFT(FFT_SIZE), fftInput = new Array<number>(FFT_SIZE).fill(0), fftOutput = fft.createComplexArray();
  const previousMagnitude = new Float64Array(FFT_SIZE / 2 + 1), analysisBuffer = new Float32Array(FFT_SIZE), flux: number[] = [];
  let analysisFill = 0;
  const analyzeFrame = () => {
    for (let index = 0; index < FFT_SIZE; index++) fftInput[index] = analysisBuffer[index]! * (.5 - .5 * Math.cos(2 * Math.PI * index / (FFT_SIZE - 1)));
    fft.realTransform(fftOutput, fftInput);
    let novelty = 0;
    for (let bin = 1; bin <= FFT_SIZE / 2; bin++) {
      const magnitude = Math.log1p(Math.hypot(fftOutput[bin * 2]!, fftOutput[bin * 2 + 1]!)), difference = magnitude - previousMagnitude[bin]!;
      if (difference > 0) novelty += difference;
      previousMagnitude[bin] = magnitude;
    }
    flux.push(novelty);
    analysisBuffer.copyWithin(0, HOP_FRAMES);
    analysisFill -= HOP_FRAMES;
  };

  const baseMin: number[] = [], baseMax: number[] = [], baseMeanSquare: number[] = [], baseCounts: number[] = [];
  let bucketMin = 1, bucketMax = -1, bucketSumSquares = 0, bucketCount = 0, durationFrames = 0, lastProgress = 0;
  const flush = () => { if (!bucketCount) return; baseMin.push(bucketMin); baseMax.push(bucketMax); baseMeanSquare.push(bucketSumSquares / bucketCount); baseCounts.push(bucketCount); bucketMin = 1; bucketMax = -1; bucketSumSquares = 0; bucketCount = 0; };

  const source = await openMono(data.opfsPath);
  // Without stems the mixture is the only harmonic evidence there is, so the
  // same pass also feeds chroma. Separation replaces this with the real
  // harmonic mix later.
  const chroma = new ChromaStream(source.sampleRate);
  try {
    for await (const mono of source.chunks()) {
      for (const value of mono) {
        bucketMin = Math.min(bucketMin, value); bucketMax = Math.max(bucketMax, value); bucketSumSquares += value * value; bucketCount++; durationFrames++;
        if (bucketCount === BASE_BUCKET) flush();
        analysisBuffer[analysisFill++] = value; if (analysisFill === FFT_SIZE) analyzeFrame();
        chroma.push(value, value);
      }
      if (durationFrames - lastProgress >= source.sampleRate) { lastProgress = durationFrames; self.postMessage({ type: "waveform/progress", ...identity, durationFrames }); }
    }
  } finally { source.dispose(); }
  flush();
  chroma.finish();

  const levels = LEVEL_BUCKETS.map((framesPerBucket) => ({ framesPerBucket, ...aggregateLevel(baseMin, baseMax, baseMeanSquare, baseCounts, framesPerBucket / BASE_BUCKET) }));
  const beatAnalysis = detectBeatGrid(flux, source.sampleRate, HOP_FRAMES, durationFrames);
  const durationUs = Math.round(durationFrames / source.sampleRate * 1_000_000);
  const beatTimesUs = beatAnalysis.beatsFrames.map((frame) => Math.round(frame / source.sampleRate * 1_000_000));
  const decoded = detectChords(chroma.frames, chroma.hopSeconds, chordBoundaries(beatTimesUs, beatAnalysis.reliable, durationUs), chroma.tuning.trust);
  const transfer = levels.flatMap((level) => [level.min.buffer, level.max.buffer, level.rms.buffer]);
  self.postMessage({ type: "waveform/complete", ...identity, sampleRate: source.sampleRate, channels: source.channels, durationFrames, levels, beatAnalysis, chordAnalysis: { segments: decoded.segments, key: keyName(decoded.key) } }, { transfer });
}

async function analyseStemChords(data: StemChordRequest, identity: object) {
  const other = await openMono(data.otherOpfsPath);
  const bass = await openMono(data.bassOpfsPath);
  const chroma = new ChromaStream(other.sampleRate);
  let frames = 0;
  try {
    // The two stems are decoded in lockstep rather than buffered whole: a
    // twenty-minute pair would be several hundred megabytes of Float32.
    const readers = [other, bass].map((source) => ({ iterator: source.chunks()[Symbol.asyncIterator](), chunk: new Float32Array(0), offset: 0 }));
    let lastProgress = 0;
    for (;;) {
      let exhausted = false;
      for (const reader of readers) {
        while (reader.offset >= reader.chunk.length) {
          const next = await reader.iterator.next();
          if (next.done) { exhausted = true; break; }
          reader.chunk = next.value; reader.offset = 0;
        }
        if (exhausted) break;
      }
      if (exhausted) break;
      const [otherReader, bassReader] = readers as [typeof readers[0], typeof readers[0]];
      const take = Math.min(otherReader.chunk.length - otherReader.offset, bassReader.chunk.length - bassReader.offset);
      for (let index = 0; index < take; index++) {
        const bassValue = bassReader.chunk[bassReader.offset + index]!;
        chroma.push(otherReader.chunk[otherReader.offset + index]! + bassValue * BASS_HARMONIC_WEIGHT, bassValue);
      }
      otherReader.offset += take;
      bassReader.offset += take;
      frames += take;
      // One message per second of audio, as the waveform pass does. The caller
      // knows the stem length and turns this into a fraction.
      if (frames - lastProgress >= other.sampleRate) { lastProgress = frames; self.postMessage({ type: "chords/progress", ...identity, frames }); }
    }
  } finally { other.dispose(); bass.dispose(); }
  chroma.finish();

  // The last partial second, so the caller's bar reaches the end rather than
  // stopping short while the Viterbi decode below runs.
  self.postMessage({ type: "chords/progress", ...identity, frames });
  const decoded = detectChords(chroma.frames, chroma.hopSeconds, data.boundaries, chroma.tuning.trust);
  self.postMessage({ type: "chords/complete", ...identity, segments: decoded.segments, key: keyName(decoded.key) });
}

self.onmessage = async ({ data }: MessageEvent<WaveformRequest | StemChordRequest>) => {
  const identity = { requestId: data.requestId, songId: data.songId, generation: data.generation };
  try {
    if (data.type === "waveform/analyze") await analyseWaveform(data, identity);
    else if (data.type === "chords/analyze") await analyseStemChords(data, identity);
  } catch (error) {
    self.postMessage({ type: data.type === "chords/analyze" ? "chords/error" : "waveform/error", ...identity, code: error instanceof Error ? error.message : "analysis_failed" });
  }
};
