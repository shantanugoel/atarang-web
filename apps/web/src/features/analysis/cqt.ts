/**
 * The constant-Q input the chord model was trained on, built from the FFT the
 * analysis pass already computes.
 *
 * A true constant-Q transform is multirate: at C1 the filter is a second and a
 * half long, so it is computed octave by octave on a repeatedly downsampled
 * signal. None of that is here. Each log-spaced bin is a triangular average of
 * the 8192-point magnitudes instead, which costs one dot product per bin and
 * reuses a spectrum that has already been paid for.
 *
 * That is an approximation, and the bottom octave is the part it gets wrong:
 * 5.4 Hz of FFT resolution against bins 0.6 Hz apart. It is kept because it was
 * measured rather than assumed — against a librosa reference on the bundled
 * demo, the model's pitch-class activations move by a mean of 0.02 and every
 * active/inactive decision is unchanged. The frequency-collapsing convolution
 * and the batch norm in front of it are what absorb the difference.
 */

/** 36 bins per octave over six octaves from C1, which is what the model expects. */
export const CQT_BINS = 216;
export const CQT_BINS_PER_OCTAVE = 36;
export const CQT_FMIN = 32.703195662575408;
/** Fundamental and octave, the two harmonics stacked as channels. */
export const CQT_HARMONICS = [1, 2] as const;
/** librosa's amplitude_to_db floor, and the value silent frames land on. */
export const DB_FLOOR = -80;

export interface CqtBand { start: number; weights: Float64Array }

/**
 * Triangular weights per bin, spanning one bin either side — the constant-Q
 * band at this resolution. A bin narrower than the FFT can resolve takes the
 * single nearest bin instead of nothing at all.
 */
export function cqtBands(sampleRate: number, fftSize: number, harmonic: number): CqtBand[] {
  const binHz = sampleRate / fftSize, top = fftSize / 2;
  return Array.from({ length: CQT_BINS }, (_, index) => {
    const centre = CQT_FMIN * harmonic * 2 ** (index / CQT_BINS_PER_OCTAVE);
    const low = centre * 2 ** (-1 / CQT_BINS_PER_OCTAVE), high = centre * 2 ** (1 / CQT_BINS_PER_OCTAVE);
    const first = Math.max(0, Math.ceil(low / binHz)), last = Math.min(top, Math.floor(high / binHz));
    const nearest = Math.min(top, Math.max(0, Math.round(centre / binHz)));
    if (last < first) return { start: nearest, weights: Float64Array.of(1) };
    const weights = new Float64Array(last - first + 1);
    let total = 0;
    for (let bin = first; bin <= last; bin++) {
      const frequency = bin * binHz;
      const weight = Math.max(0, Math.min((frequency - low) / (centre - low), (high - frequency) / (high - centre)));
      weights[bin - first] = weight;
      total += weight;
    }
    if (total <= 0) return { start: nearest, weights: Float64Array.of(1) };
    for (let index_ = 0; index_ < weights.length; index_++) weights[index_] = weights[index_]! / total;
    return { start: first, weights };
  });
}

/** One frame of magnitudes folded onto the log-spaced bins. */
export function cqtFrame(magnitudes: ArrayLike<number>, bands: readonly CqtBand[], out = new Float32Array(CQT_BINS)) {
  for (let bin = 0; bin < bands.length; bin++) {
    const { start, weights } = bands[bin]!;
    let sum = 0;
    for (let index = 0; index < weights.length; index++) sum += weights[index]! * (magnitudes[start + index] ?? 0);
    out[bin] = sum;
  }
  return out;
}

/**
 * librosa's `amplitude_to_db(ref=np.max)`, in place: decibels relative to the
 * loudest bin anywhere in the song, floored 80 dB below it.
 *
 * The reference is the whole song rather than the frame, so a quiet passage
 * stays quiet — which is information the model was trained to use.
 */
export function amplitudeToDb(frames: Float32Array[]) {
  let peak = 0;
  for (const frame of frames) for (const value of frame) if (value > peak) peak = value;
  const reference = Math.max(peak, 1e-10);
  for (const frame of frames) {
    for (let bin = 0; bin < frame.length; bin++) {
      frame[bin] = Math.max(DB_FLOOR, 20 * Math.log10(Math.max(frame[bin]!, 1e-10) / reference));
    }
  }
  return frames;
}
