import FFT from "fft.js";

export const DEMUCS_SAMPLE_RATE = 44_100;
export const DEMUCS_SEGMENT_FRAMES = 343_980;
export const DEMUCS_OVERLAP_FRAMES = 85_995;
export const DEMUCS_STRIDE_FRAMES = DEMUCS_SEGMENT_FRAMES - DEMUCS_OVERLAP_FRAMES;
export const DEMUCS_FFT_SIZE = 4_096;
export const DEMUCS_HOP_SIZE = 1_024;
export const DEMUCS_SPEC_BINS = 2_048;
export const DEMUCS_SPEC_FRAMES = 336;
export const DEMUCS_MODEL_STEMS = ["drums", "bass", "other", "vocals"] as const;

const fft = new FFT(DEMUCS_FFT_SIZE);
const window = Float32Array.from(
  { length: DEMUCS_FFT_SIZE },
  (_, index) => 0.5 * (1 - Math.cos((2 * Math.PI * index) / DEMUCS_FFT_SIZE)),
);
const stftInput = new Array<number>(DEMUCS_FFT_SIZE);
const stftSpectrum = fft.createComplexArray();
const istftSpectrum = fft.createComplexArray();
const istftTransformed = fft.createComplexArray();

// Every buffer below is a fixed size decided by the model's segment shape, so a
// segment reuses the previous segment's rather than allocating its own. Fresh
// ones per segment are what killed the tab on iOS: a Float32Array's backing
// store is malloc'd outside JSC's heap, so ~110 MB of churn per segment reads
// as almost no GC pressure while the process footprint climbs until the content
// process is jetsam'd mid-song.
// ponytail: module-level scratch makes these non-reentrant, which holds because
// inferenceLease admits one chain at a time. Per-call arenas if that changes.
const pool = new Map<string, Float32Array>();
function scratch(key: string, length: number) {
  let buffer = pool.get(key);
  if (!buffer || buffer.length < length) pool.set(key, (buffer = new Float32Array(length)));
  return buffer.length === length ? buffer : buffer.subarray(0, length);
}

function reflectPad(signal: Float32Array, left: number, right: number, key: string) {
  const output = scratch(key, left + signal.length + right);
  for (let index = 0; index < left; index++) output[index] = signal[Math.min(left - index, signal.length - 1)] ?? 0;
  output.set(signal, left);
  for (let index = 0; index < right; index++) output[left + signal.length + index] = signal[Math.max(0, signal.length - 2 - index)] ?? 0;
  return output;
}

// Keyed because a caller may hold two spectra at once; sharing one key would
// have the second overwrite the first.
function stft(signal: Float32Array, key: string) {
  const frames = Math.floor((signal.length - DEMUCS_FFT_SIZE) / DEMUCS_HOP_SIZE) + 1;
  const bins = DEMUCS_FFT_SIZE / 2 + 1;
  const real = scratch(`${key}.real`, frames * bins);
  const imaginary = scratch(`${key}.imaginary`, frames * bins);
  const scale = 1 / Math.sqrt(DEMUCS_FFT_SIZE);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * DEMUCS_HOP_SIZE;
    for (let index = 0; index < DEMUCS_FFT_SIZE; index++) stftInput[index] = signal[offset + index]! * window[index]!;
    fft.realTransform(stftSpectrum, stftInput);
    for (let bin = 0; bin < bins; bin++) {
      real[frame * bins + bin] = stftSpectrum[bin * 2]! * scale;
      imaginary[frame * bins + bin] = stftSpectrum[bin * 2 + 1]! * scale;
    }
  }
  return { real, imaginary, frames, bins };
}

function istft(real: Float32Array, imaginary: Float32Array, frames: number, bins: number) {
  const length = (frames - 1) * DEMUCS_HOP_SIZE + DEMUCS_FFT_SIZE;
  // Both accumulate across frames, so a reused buffer has to start at zero.
  const output = scratch("istft.output", length).fill(0);
  const weight = scratch("istft.weight", length).fill(0);
  const spectrum = istftSpectrum;
  const transformed = istftTransformed;
  const scale = Math.sqrt(DEMUCS_FFT_SIZE);
  for (let frame = 0; frame < frames; frame++) {
    spectrum.fill(0);
    for (let bin = 0; bin < bins; bin++) {
      spectrum[bin * 2] = real[frame * bins + bin]!;
      spectrum[bin * 2 + 1] = imaginary[frame * bins + bin]!;
    }
    fft.completeSpectrum(spectrum);
    fft.inverseTransform(transformed, spectrum);
    const start = frame * DEMUCS_HOP_SIZE;
    for (let index = 0; index < DEMUCS_FFT_SIZE; index++) {
      const value = window[index]!;
      output[start + index] = output[start + index]! + transformed[index * 2]! * value * scale;
      weight[start + index] = weight[start + index]! + value * value;
    }
  }
  for (let index = 0; index < output.length; index++) if (weight[index]! > 1e-8) output[index] = output[index]! / weight[index]!;
  return output;
}

export function prepareDemucsInput(left: Float32Array, right: Float32Array) {
  // A segment shorter than the window leaves a tail these two never write, and
  // a reused buffer still holds the previous segment's audio there.
  const paddedLeft = scratch("padded.left", DEMUCS_SEGMENT_FRAMES).fill(0);
  const paddedRight = scratch("padded.right", DEMUCS_SEGMENT_FRAMES).fill(0);
  paddedLeft.set(left.subarray(0, DEMUCS_SEGMENT_FRAMES));
  paddedRight.set(right.subarray(0, DEMUCS_SEGMENT_FRAMES));
  const frames = Math.ceil(DEMUCS_SEGMENT_FRAMES / DEMUCS_HOP_SIZE);
  const side = Math.floor(DEMUCS_HOP_SIZE / 2) * 3;
  const rightPad = side + frames * DEMUCS_HOP_SIZE - DEMUCS_SEGMENT_FRAMES;
  const center = DEMUCS_FFT_SIZE / 2;
  // The padding buffers are safe to share between the channels: each stft reads
  // them out into its own spectrum before the next line refills them.
  const leftSpectrum = stft(reflectPad(reflectPad(paddedLeft, side, rightPad, "pad.inner"), center, center, "pad.outer"), "spec.left");
  const rightSpectrum = stft(reflectPad(reflectPad(paddedRight, side, rightPad, "pad.inner"), center, center, "pad.outer"), "spec.right");
  const mag = scratch("mag", 4 * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES);
  for (let frame = 0; frame < DEMUCS_SPEC_FRAMES; frame++) {
    for (let bin = 0; bin < DEMUCS_SPEC_BINS; bin++) {
      const source = (frame + 2) * leftSpectrum.bins + bin;
      const target = bin * DEMUCS_SPEC_FRAMES + frame;
      mag[target] = leftSpectrum.real[source]!;
      mag[DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES + target] = leftSpectrum.imaginary[source]!;
      mag[2 * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES + target] = rightSpectrum.real[source]!;
      mag[3 * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES + target] = rightSpectrum.imaginary[source]!;
    }
  }
  const mix = scratch("mix", 2 * DEMUCS_SEGMENT_FRAMES);
  mix.set(paddedLeft);
  mix.set(paddedRight, DEMUCS_SEGMENT_FRAMES);
  return { mix, mag };
}

export function demucsFrequencyToTime(freq: Float32Array) {
  const stems = Array.from({ length: 4 }, (_, stem) => ({
    left: scratch(`stem${stem}.left`, DEMUCS_SEGMENT_FRAMES),
    right: scratch(`stem${stem}.right`, DEMUCS_SEGMENT_FRAMES),
  }));
  const paddedFrames = DEMUCS_SPEC_FRAMES + 4;
  const paddedBins = DEMUCS_SPEC_BINS + 1;
  const centerOffset = DEMUCS_FFT_SIZE / 2 + Math.floor(DEMUCS_HOP_SIZE / 2) * 3;
  for (let stem = 0; stem < 4; stem++) {
    for (let channel = 0; channel < 2; channel++) {
      // The loop below fills the interior bins only; the padding either side of
      // it has to be zero, and on a reused buffer it is last iteration's audio.
      const real = scratch("branch.real", paddedFrames * paddedBins).fill(0);
      const imaginary = scratch("branch.imaginary", paddedFrames * paddedBins).fill(0);
      for (let frame = 0; frame < DEMUCS_SPEC_FRAMES; frame++) {
        for (let bin = 0; bin < DEMUCS_SPEC_BINS; bin++) {
          const sourceBase = stem * 4 * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES;
          const target = (frame + 2) * paddedBins + bin;
          real[target] = freq[sourceBase + channel * 2 * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES + bin * DEMUCS_SPEC_FRAMES + frame]!;
          imaginary[target] = freq[sourceBase + (channel * 2 + 1) * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES + bin * DEMUCS_SPEC_FRAMES + frame]!;
        }
      }
      const restored = istft(real, imaginary, paddedFrames, paddedBins);
      (channel ? stems[stem]!.right : stems[stem]!.left).set(restored.subarray(centerOffset, centerOffset + DEMUCS_SEGMENT_FRAMES));
    }
  }
  return stems;
}

export interface StereoStem { left: Float32Array; right: Float32Array }

export type DemucsBackend = "webgpu" | "wasm";

export interface DemucsQualificationMetrics {
  finite: boolean;
  emittedFrames: number;
  expectedFrames: number;
  energyRatio: number;
  mixtureCorrelation: number;
  rtf: number;
  backend?: DemucsBackend;
}

// A CPU run is slow by construction, not broken. Judging it against the GPU
// ceiling would report "unavailable" on every browser without WebGPU, which is
// the difference between "this takes a while" and "you cannot do this here".
const RTF_CEILING: Record<DemucsBackend, number> = { webgpu: 4, wasm: 12 };

export function classifyDemucsQualification(metrics: DemucsQualificationMetrics) {
  const correctnessPassed = metrics.finite
    && metrics.emittedFrames === metrics.expectedFrames
    && metrics.energyRatio >= 0.25
    && metrics.energyRatio <= 4
    && metrics.mixtureCorrelation >= 0.8;
  const status = !correctnessPassed || metrics.rtf > RTF_CEILING[metrics.backend ?? "webgpu"]
    ? "unavailable" as const
    : metrics.rtf <= 1.5
      ? "qualified" as const
      : "slow" as const;
  const reason = !correctnessPassed
    ? "correctness_failed" as const
    : status === "qualified"
      ? "qualified" as const
      : status === "slow"
        ? "qualified_slow" as const
        : "rtf_too_slow" as const;
  return { correctnessPassed, status, reason };
}

/** The stems are scratch, valid until the next segment prepares its own. Every
 *  caller hands them straight to RollingStemOverlapAdd, which accumulates into
 *  buffers of its own before returning. */
export function combineDemucsBranches(freq: Float32Array, time: Float32Array): StereoStem[] {
  const stems = demucsFrequencyToTime(freq);
  stems.forEach((stem, stemIndex) => {
    const base = stemIndex * 2 * DEMUCS_SEGMENT_FRAMES;
    for (let frame = 0; frame < DEMUCS_SEGMENT_FRAMES; frame++) {
      stem.left[frame] = stem.left[frame]! + time[base + frame]!;
      stem.right[frame] = stem.right[frame]! + time[base + DEMUCS_SEGMENT_FRAMES + frame]!;
    }
  });
  return stems;
}

export class RollingStemOverlapAdd {
  readonly allocatedSampleSlots = DEMUCS_SEGMENT_FRAMES * 9;
  #base = 0;
  #stems = Array.from({ length: 4 }, () => ({ left: new Float32Array(DEMUCS_SEGMENT_FRAMES), right: new Float32Array(DEMUCS_SEGMENT_FRAMES) }));
  #weights = new Float32Array(DEMUCS_SEGMENT_FRAMES);

  add(start: number, stems: StereoStem[], segmentLength: number, totalFrames: number) {
    const flushed = start > this.#base ? this.#flush(start - this.#base) : null;
    const fade = Math.max(1, DEMUCS_OVERLAP_FRAMES);
    for (let frame = 0; frame < segmentLength; frame++) {
      const fadeIn = start === 0 ? 1 : Math.min(1, (frame + 1) / fade);
      const fadeOut = start + segmentLength >= totalFrames ? 1 : Math.min(1, (segmentLength - frame) / fade);
      const weight = Math.min(fadeIn, fadeOut);
      this.#weights[frame] = this.#weights[frame]! + weight;
      for (let stem = 0; stem < 4; stem++) {
        this.#stems[stem]!.left[frame] = this.#stems[stem]!.left[frame]! + stems[stem]!.left[frame]! * weight;
        this.#stems[stem]!.right[frame] = this.#stems[stem]!.right[frame]! + stems[stem]!.right[frame]! * weight;
      }
    }
    return flushed;
  }

  finish(totalFrames: number) {
    return this.#flush(totalFrames - this.#base);
  }

  #flush(frames: number) {
    if (frames < 0 || frames > DEMUCS_SEGMENT_FRAMES) throw new Error("overlap_window_invalid");
    const chunks = this.#stems.map((stem) => {
      const interleaved = new Float32Array(frames * 2);
      for (let frame = 0; frame < frames; frame++) {
        const weight = this.#weights[frame]!;
        interleaved[frame * 2] = weight > 0 ? stem.left[frame]! / weight : 0;
        interleaved[frame * 2 + 1] = weight > 0 ? stem.right[frame]! / weight : 0;
      }
      stem.left.copyWithin(0, frames);
      stem.right.copyWithin(0, frames);
      stem.left.fill(0, DEMUCS_SEGMENT_FRAMES - frames);
      stem.right.fill(0, DEMUCS_SEGMENT_FRAMES - frames);
      return interleaved;
    });
    this.#weights.copyWithin(0, frames);
    this.#weights.fill(0, DEMUCS_SEGMENT_FRAMES - frames);
    this.#base += frames;
    return chunks;
  }
}
