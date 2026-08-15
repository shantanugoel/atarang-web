import { CONCERT_PITCH } from "./chordDetection";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
// Wide enough for a dropped bass string at the bottom and a capoed high E at the
// top. A narrower range is cheaper — the search is one lag per candidate period
// — but a tuner that cannot see your lowest string is not a tuner.
const MIN_HZ = 40, MAX_HZ = 1400;

/**
 * YIN pitch detection: the note being played, and how much to believe it.
 *
 * A tuner is trusted absolutely and read off the screen as truth, so the bar is
 * a couple of cents or nothing. Plain autocorrelation is not that — it happily
 * locks onto the octave below on a plucked string, where the second partial is
 * louder than the fundamental. YIN's cumulative mean normalisation is exactly
 * the fix for that, and the parabolic interpolation is what turns a whole-sample
 * lag into cents: at 44.1 kHz one sample of lag is already 4 cents at 330 Hz.
 *
 * `clarity` is 1 − the normalised difference at the chosen lag: roughly "how
 * periodic was this". Room noise and finger squeak read low, and the caller is
 * expected to throw those away rather than display a number for them.
 *
 * ponytail: O(frame × lags) per call, about 1.5M multiply-adds for a 2048-sample
 * frame — fine a few times a second, and the upgrade path if it ever is not is
 * the difference function via the FFT already in the bundle.
 */
export function detectPitch(samples: Float32Array, sampleRate: number, threshold = 0.12): { hz: number; clarity: number } | null {
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), samples.length >> 1);
  const minLag = Math.max(2, Math.ceil(sampleRate / MAX_HZ));
  if (maxLag <= minLag + 1) return null;

  const difference = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let index = 0; index + lag < samples.length; index++) {
      const delta = samples[index]! - samples[index + lag]!;
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  // d'(lag): the difference divided by its own running mean, which is what stops
  // a louder partial from winning over the fundamental.
  const normalised = new Float64Array(maxLag + 1);
  normalised[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += difference[lag]!;
    normalised[lag] = running === 0 ? 1 : difference[lag]! * lag / running;
  }

  // The first dip below the threshold, not the deepest one: the deepest is often
  // a multiple of the true period, which is the octave error being avoided.
  let chosen = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalised[lag]! >= threshold) continue;
    while (lag + 1 <= maxLag && normalised[lag + 1]! < normalised[lag]!) lag++;
    chosen = lag;
    break;
  }
  if (chosen < 0) {
    let best = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) if (normalised[lag]! < normalised[best]!) best = lag;
    // Nothing periodic enough to be a note. Saying so beats a confident number.
    if (normalised[best]! > 0.5) return null;
    chosen = best;
  }

  const previous = normalised[chosen - 1] ?? normalised[chosen]!, next = normalised[chosen + 1] ?? normalised[chosen]!;
  const curvature = 2 * (previous + next - 2 * normalised[chosen]!);
  const refined = curvature === 0 ? chosen : chosen + (previous - next) / curvature;
  const hz = sampleRate / refined;
  if (!Number.isFinite(hz) || hz < MIN_HZ || hz > MAX_HZ) return null;
  return { hz, clarity: Math.max(0, Math.min(1, 1 - normalised[chosen]!)) };
}

/** The note a frequency is closest to, and how far off it is in cents. */
export function nearestNote(hz: number, reference = CONCERT_PITCH) {
  const midi = 69 + 12 * Math.log2(hz / reference);
  const nearest = Math.round(midi);
  return {
    name: NOTE_NAMES[((nearest % 12) + 12) % 12]!,
    octave: Math.floor(nearest / 12) - 1,
    cents: Math.round((midi - nearest) * 100),
  };
}

/**
 * The middle reading of the recent ones.
 *
 * Every frame is an independent estimate, and one bad frame — a string touched,
 * a chair moving — is a needle that jumps. A median throws those out without the
 * lag a running average adds, which matters because the number is being watched
 * while a peg is turned.
 */
export function medianHz(readings: readonly number[]) {
  if (!readings.length) return null;
  const sorted = [...readings].sort((left, right) => left - right);
  return sorted[sorted.length >> 1]!;
}
