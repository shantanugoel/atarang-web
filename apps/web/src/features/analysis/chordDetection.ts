// Chord detection, ported from the iOS app's ChordDetector.
//
// The pipeline is the standard one, and standard on purpose — every stage has a
// published reference and a known failure mode, which matters for output the
// user is invited to correct:
//
// 1. a harmonic pitch-class profile with overtone suppression, plus a separate
//    chroma of the bass register;
// 2. chroma averaged within each beat of the detected grid;
// 3. cosine similarity against chord templates, with a bass term;
// 4. a Viterbi decode over an HMM whose transitions favour staying put and
//    favour the key;
// 5. Krumhansl-Schmuckler for the key.
//
// Everything here is pure and works on plain arrays, so a synthetic progression
// can be decoded in a test without an audio engine.

/**
 * Window geometry for one sample rate.
 *
 * Chroma wants a long window: a chord is a steady state, and the bin spacing at
 * the bottom of the range is the binding constraint, not time resolution. 8192
 * at 44.1 kHz is 5.4 Hz of spacing over 186 ms.
 *
 * Analysis runs at the source rate deliberately. Decimating to 22.05 kHz first
 * is cheaper, but without a steep anti-alias filter it folds everything above
 * 11 kHz — cymbals, sibilance, string noise — straight into the harmonic band,
 * and peak-picking then treats that garbage as partials.
 */
export function chromaGeometry(sampleRate: number) {
  const size = sampleRate >= 32_000 ? 8_192 : 4_096;
  return { size, hop: size / 4 };
}

// Harmony lives below 5 kHz; above it there is nothing but cymbals and the
// tenth harmonic of something already counted. Below A1 the bins are too coarse
// to separate semitones.
const HARMONIC_BAND = [55, 5_000] as const;
// Where a bass note lives. The point of the bass chroma is that it is *not* the
// rest of the arrangement.
const BASS_BAND = [40, 250] as const;
const HARMONIC_COUNT = 4;
const HARMONIC_DECAY = 0.6;
// How far above the surrounding spectrum a local maximum has to stand before it
// counts as a partial.
const PEAK_FLOOR_RATIO = 2.5;
// The neighbourhood the floor is measured over, as a fraction of the bin's own
// frequency. A fixed width in bins is a very wide musical interval down at the
// fundamentals and a very narrow one up in the partials, which gates out the
// register that carries the chord and waves through the register that does not.
const FLOOR_BANDWIDTH = 0.35;
const FLOOR_MINIMUM_BINS = 6;

/** Mean magnitude around each bin, as the noise floor a partial must clear. */
function localFloor(magnitudes: ArrayLike<number>, lowest: number, highest: number) {
  const width = highest - lowest + 1;
  const prefix = new Float64Array(width + 1);
  for (let index = 0; index < width; index++) prefix[index + 1] = prefix[index]! + magnitudes[lowest + index]!;
  const floor = new Float64Array(width);
  for (let index = 0; index < width; index++) {
    const radius = Math.max(FLOOR_MINIMUM_BINS, Math.round((lowest + index) * FLOOR_BANDWIDTH));
    const from = Math.max(0, index - radius);
    const to = Math.min(width - 1, index + radius);
    floor[index] = (prefix[to + 1]! - prefix[from]!) / (to - from + 1);
  }
  return floor;
}

// How much the bass agrees, as a share of the total score. Enough to break a tie
// between a chord and its relative minor — which share two of three notes and
// are told apart almost entirely by what the bass plays — and not enough to let
// a passing bass note rewrite the chord above it.
const BASS_WEIGHT = 0.35;
// What a chord must beat to be printed at all. Cosine similarity against a
// normalised template, so this is "fits about as well as noise would": a chroma
// with every pitch class equally loud scores exactly 0.5 against any triad, and
// a clean triad scores above 0.9.
const NO_CHORD_SCORE = 0.62;
const SILENCE_ENERGY = 1e-4;
// The cost of changing chord, in the same units as the similarity scores. This
// is the self-transition prior: harmony is piecewise constant, and without a
// cost the decoder prints a different chord on every beat.
const CHANGE_PENALTY = 0.22;
const OUT_OF_KEY_PENALTY = 0.08;
// Neighbouring chords share notes, so the raw margins are a few hundredths and
// mean nothing on their own. This is what turns one into a number a person can
// read.
const CONFIDENCE_MARGIN = 0.12;

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
// F, Bb, Eb, Ab and Db majors, plus the minors that share their signature.
const FLAT_TONICS = new Set([5, 10, 3, 8, 1]);

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

interface Quality { symbol: string; intervals: readonly number[]; prior: number }

// Deliberately small: representable does not imply safely detectable.
// A four-note template covers more of the circle than a triad, so on a dense
// chroma it wins on coverage rather than on evidence. The priors are what make a
// seventh have to be *heard* rather than merely not contradicted; measured on a
// distorted rock mix, the original iOS values printed a seventh on nearly every
// chord. Diminished is rarest of all and pays most.
const QUALITIES: readonly Quality[] = [
  { symbol: "", intervals: [0, 4, 7], prior: 0 },
  { symbol: "m", intervals: [0, 3, 7], prior: 0 },
  { symbol: "7", intervals: [0, 4, 7, 10], prior: -0.12 },
  { symbol: "m7", intervals: [0, 3, 7, 10], prior: -0.12 },
  { symbol: "maj7", intervals: [0, 4, 7, 11], prior: -0.12 },
  { symbol: "sus4", intervals: [0, 5, 7], prior: -0.08 },
  { symbol: "dim", intervals: [0, 3, 6], prior: -0.18 },
];

export interface ChordState { root: number; quality: Quality; pitchClasses: readonly number[] }

/** Every decodable state, in a fixed order. The final entry is "no chord". */
export const CHORD_STATES: readonly (ChordState | null)[] = [
  ...Array.from({ length: 12 }, (_, root) => QUALITIES.map((quality) => ({
    root,
    quality,
    pitchClasses: quality.intervals.map((interval) => (root + interval) % 12),
  }))).flat(),
  null,
];

const TEMPLATES: readonly Float64Array[] = CHORD_STATES.map((state) => {
  const template = new Float64Array(12);
  if (!state) return template;
  for (const pitch of state.pitchClasses) template[pitch] = 1;
  const norm = Math.sqrt(state.pitchClasses.length);
  for (let pitch = 0; pitch < 12; pitch++) template[pitch] = template[pitch]! / norm;
  return template;
});

export interface MusicalKey { tonic: number; mode: "major" | "minor"; strength: number }

export function chordSymbol(state: ChordState | null, key?: MusicalKey | null) {
  if (!state) return "N";
  const majorTonic = key ? (key.mode === "major" ? key.tonic : (key.tonic + 3) % 12) : -1;
  const names = FLAT_TONICS.has(majorTonic) ? FLAT_NAMES : SHARP_NAMES;
  return `${names[state.root]}${state.quality.symbol}`;
}

/** One bin per cent, wrapping at the semitone, because that is what tuning is. */
export const TUNING_BINS = 100;
export const CONCERT_PITCH = 440;

/**
 * Sub-bin peak position, by fitting a parabola through the peak and its
 * neighbours in the log domain.
 *
 * At 5.4 Hz of bin spacing a bin index is worth about 20 cents around A2, which
 * is wider than the deviation being measured. Without interpolation the
 * histogram below would be reading its own bin grid rather than the recording.
 */
export function parabolicPeak(magnitudes: ArrayLike<number>, bin: number) {
  const left = Math.log(magnitudes[bin - 1]! + Number.MIN_VALUE);
  const centre = Math.log(magnitudes[bin]! + Number.MIN_VALUE);
  const right = Math.log(magnitudes[bin + 1]! + Number.MIN_VALUE);
  const curvature = left - 2 * centre + right;
  if (!(curvature < 0)) return bin;
  return bin + Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / curvature));
}

/**
 * Adds one frame's tonal peaks to a cent-deviation histogram.
 *
 * Each peak is scored against the equal-tempered grid and its distance from the
 * nearest semitone recorded, weighted by how loud it is. A recording at concert
 * pitch piles up near zero; one tuned down piles up somewhere else; one whose
 * peaks are not tonal partials at all spreads out evenly, which is the signal
 * that no amount of correction will make its chords trustworthy.
 */
export function accumulateTuning(histogram: Float64Array, magnitudes: ArrayLike<number>, sampleRate: number, size: number) {
  const lowest = Math.max(1, Math.floor(HARMONIC_BAND[0] * size / sampleRate));
  const highest = Math.min(size / 2 - 2, Math.ceil(HARMONIC_BAND[1] * size / sampleRate));
  if (lowest >= highest) return;
  const floor = localFloor(magnitudes, lowest, highest);
  for (let bin = lowest; bin <= highest; bin++) {
    const magnitude = magnitudes[bin]!;
    if (!(magnitude > magnitudes[bin - 1]! && magnitude >= magnitudes[bin + 1]!)) continue;
    if (magnitude < PEAK_FLOOR_RATIO * floor[bin - lowest]!) continue;
    const frequency = parabolicPeak(magnitudes, bin) * sampleRate / size;
    if (!(frequency > 0)) continue;
    const semitones = 12 * Math.log2(frequency / CONCERT_PITCH);
    const cents = Math.round((semitones - Math.round(semitones)) * 100);
    const slot = (cents % TUNING_BINS + TUNING_BINS) % TUNING_BINS;
    histogram[slot] = histogram[slot]! + magnitude;
  }
}

/**
 * The histogram's circular mean: where the deviations sit, and how tightly.
 *
 * Circular because the deviation wraps — 49 cents sharp and 49 flat are two
 * cents apart, and a linear mean of those two is a semitone away from both.
 * `tonality` is the resultant length, which is 1 when every peak agrees and 0
 * when the deviations are spread evenly around the semitone.
 */
export function estimateTuning(histogram: Float64Array) {
  let x = 0, y = 0, total = 0;
  for (let cent = 0; cent < TUNING_BINS; cent++) {
    const weight = histogram[cent]!;
    const angle = 2 * Math.PI * cent / TUNING_BINS;
    x += weight * Math.cos(angle);
    y += weight * Math.sin(angle);
    total += weight;
  }
  if (total <= 0) return { cents: 0, tonality: 0 };
  return { cents: Math.atan2(y, x) / (2 * Math.PI) * TUNING_BINS, tonality: Math.hypot(x, y) / total };
}

// How concentrated a recording that is genuinely tonal comes out. Measured end
// to end through the analysis worker: the bundled CC0 mix reads 0.64, a
// synthesised progression 1.0, a distorted guitar 0.55, and white noise 0.041.
// The threshold sits in the gap, far from both ends.
//
// Real distorted stems sit lower than the synthetic ones do — the audit measured
// a strongest bin holding 1.5% of peak energy — so this is the knob to move if
// tonal material starts being refused.
const TONAL_REFERENCE = 0.25;

/**
 * What a document's confidence has to clear before its chords are worth reading.
 *
 * Lives next to TONAL_REFERENCE because the two set each other: trust is
 * tonality over that reference, and confidence is trust times how cleanly the
 * templates matched. Moving one without the other silently re-labels ordinary
 * songs as unreadable.
 */
export const UNRELIABLE_CONFIDENCE = 0.35;

/** The A the recording is actually tuned to, and 440 when it will not say. */
export function tuningReference(histogram: Float64Array) {
  const { cents, tonality } = estimateTuning(histogram);
  return {
    reference: tonality >= TONAL_REFERENCE ? CONCERT_PITCH * 2 ** (cents / 1200) : CONCERT_PITCH,
    /** 0 to 1. Scales the confidence of everything decoded from this spectrum. */
    trust: Math.min(1, tonality / TONAL_REFERENCE),
  };
}

/**
 * One frame of pitch-class energy, with overtone suppression.
 *
 * Only spectral *peaks* contribute, and each peak contributes to the pitch class
 * of every fundamental it could be a harmonic of, with a decaying say. A plain
 * bin-to-pitch-class histogram would credit a lone C to C, G, E and Bb in turn
 * as its harmonics climbed, which is how a monophonic bass line ends up looking
 * like a dominant seventh.
 */
function chromaFrame(magnitudes: ArrayLike<number>, sampleRate: number, size: number, band: readonly [number, number], harmonics: number, reference: number) {
  const chroma = new Float64Array(12);
  const lowest = Math.max(1, Math.floor(band[0] * size / sampleRate));
  const highest = Math.min(size / 2 - 2, Math.ceil(band[1] * size / sampleRate));
  if (lowest >= highest) return { chroma, energy: 0 };
  let energy = 0;
  for (let bin = lowest; bin <= highest; bin++) energy += magnitudes[bin]!;

  // Being a local maximum is not enough to be a partial. A distorted guitar or a
  // cymbal wash puts a local maximum every two or three bins, and each one votes
  // for four pitch classes, which is what flattens a chroma into twelve nearly
  // equal numbers. Measured on a rock mix, gating on the local floor moved the
  // chroma minimum from 43% of the peak down to single digits, which is the
  // difference between six chord qualities within 0.03 and a clear winner.
  const floor = localFloor(magnitudes, lowest, highest);

  for (let bin = lowest; bin <= highest; bin++) {
    const magnitude = magnitudes[bin]!;
    if (!(magnitude > magnitudes[bin - 1]! && magnitude >= magnitudes[bin + 1]!)) continue;
    if (magnitude < PEAK_FLOOR_RATIO * floor[bin - lowest]!) continue;
    const frequency = bin * sampleRate / size;
    let weight = 1;
    for (let harmonic = 1; harmonic <= Math.max(1, harmonics); harmonic++) {
      const fundamental = frequency / harmonic;
      if (fundamental < band[0]) break;
      const pitch = Math.round(12 * Math.log2(fundamental / reference) + 69);
      if (!Number.isFinite(pitch)) break;
      const pitchClass = (pitch % 12 + 12) % 12;
      chroma[pitchClass] = chroma[pitchClass]! + magnitude * weight;
      weight *= HARMONIC_DECAY;
    }
  }
  // Normalising per frame is what lets one threshold work across a quiet verse
  // and a loud chorus: harmony is about which notes sound relative to each
  // other, not how loud the band was playing them.
  let peak = 0;
  for (const value of chroma) peak = Math.max(peak, value);
  if (peak > 0) for (let pitch = 0; pitch < 12; pitch++) chroma[pitch] = chroma[pitch]! / peak;
  return { chroma, energy: energy / (highest - lowest + 1) };
}

export function harmonicChromaFrame(magnitudes: ArrayLike<number>, sampleRate: number, size: number, reference = CONCERT_PITCH) {
  return chromaFrame(magnitudes, sampleRate, size, HARMONIC_BAND, HARMONIC_COUNT, reference);
}

// A bass note's own harmonics land above the band, so folding them back would
// only add the notes it is not playing.
export function bassChromaFrame(magnitudes: ArrayLike<number>, sampleRate: number, size: number, reference = CONCERT_PITCH) {
  return chromaFrame(magnitudes, sampleRate, size, BASS_BAND, 1, reference);
}

/**
 * How well each chord state fits one beat.
 *
 * Cosine similarity against the templates, plus a bass term that rewards the
 * root being in the bass and, more weakly, any chord tone being there — which is
 * what an inversion is. The bass term is *relative*, so it is neutral when the
 * bass says nothing rather than scaling every chord down against the no-chord
 * constant and printing silence over a song with no bass.
 */
export function chordScores(chroma: ArrayLike<number>, bass: ArrayLike<number>, energy: number) {
  let squares = 0;
  for (let pitch = 0; pitch < 12; pitch++) squares += chroma[pitch]! * chroma[pitch]!;
  const norm = Math.sqrt(squares);
  if (norm <= 0 || energy <= SILENCE_ENERGY) return CHORD_STATES.map((state) => (state ? 0 : 1));

  let bassPeak = 0;
  for (let pitch = 0; pitch < 12; pitch++) bassPeak = Math.max(bassPeak, bass[pitch]!);
  const agreements = CHORD_STATES.map((state) => {
    if (!state || bassPeak <= 0) return 0;
    const root = bass[state.root]! / bassPeak;
    let inversion = 0;
    for (let index = 1; index < state.pitchClasses.length; index++) inversion = Math.max(inversion, bass[state.pitchClasses[index]!]! / bassPeak);
    return root + 0.5 * inversion;
  });
  const chordCount = CHORD_STATES.length - 1;
  const meanAgreement = agreements.reduce((sum, value) => sum + value, 0) / chordCount;

  return CHORD_STATES.map((state, index) => {
    if (!state) return NO_CHORD_SCORE;
    let similarity = 0;
    const template = TEMPLATES[index]!;
    for (let pitch = 0; pitch < 12; pitch++) similarity += chroma[pitch]! * template[pitch]!;
    return similarity / norm + BASS_WEIGHT * (agreements[index]! - meanAgreement) + state.quality.prior;
  });
}

function keyContains(key: MusicalKey, state: ChordState) {
  const scale = key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  return state.pitchClasses.every((pitch) => scale.includes(((pitch - key.tonic) % 12 + 12) % 12 as never));
}

/**
 * Viterbi over the beats.
 *
 * Staying on a chord is free, changing costs `CHANGE_PENALTY`, and changing to
 * something outside the key costs a little more. Because the only alternative to
 * staying is "the best other state", each step is linear in the number of states
 * rather than quadratic.
 *
 * The penalties live in the same units as the similarity scores rather than in
 * log-probabilities. Cosine similarities are not calibrated likelihoods, so
 * multiplying them by real transition probabilities would be arithmetic with no
 * meaning behind it; a cost in score units is honest about being a tuned
 * trade-off.
 */
export function decodeChords(beatScores: readonly number[][], key: MusicalKey | null) {
  const first = beatScores[0];
  if (!first?.length) return [];
  const stateCount = first.length;
  const outOfKey = CHORD_STATES.map((state) => (key && state && !keyContains(key, state) ? OUT_OF_KEY_PENALTY : 0));

  let previous = [...first];
  const backlinks: number[][] = [];
  for (let time = 1; time < beatScores.length; time++) {
    let best = -Infinity;
    let bestState = 0;
    let secondBest = -Infinity;
    for (let state = 0; state < stateCount; state++) {
      const value = previous[state]!;
      if (value > best) { secondBest = best; best = value; bestState = state; }
      else if (value > secondBest) secondBest = value;
    }
    const current = new Array<number>(stateCount);
    const links = new Array<number>(stateCount);
    for (let state = 0; state < stateCount; state++) {
      // The best way in from somewhere else cannot come from this state itself,
      // which is what the runner-up is for.
      const elsewhere = state === bestState ? secondBest : best;
      const elsewhereSource = state === bestState ? -1 : bestState;
      const stay = previous[state]!;
      const change = elsewhere - CHANGE_PENALTY - outOfKey[state]!;
      if (stay >= change || elsewhereSource < 0) { current[state] = stay + beatScores[time]![state]!; links[state] = state; }
      else { current[state] = change + beatScores[time]![state]!; links[state] = elsewhereSource; }
    }
    backlinks.push(links);
    previous = current;
  }

  const path = new Array<number>(beatScores.length).fill(0);
  let cursor = previous.reduce((bestIndex, value, index) => (value > previous[bestIndex]! ? index : bestIndex), 0);
  path[path.length - 1] = cursor;
  for (let time = backlinks.length - 1; time >= 0; time--) {
    cursor = backlinks[time]![cursor]!;
    path[time] = cursor;
  }
  return path;
}

/** The margin between the decoded state and the best state it is not, 0 to 1. */
export function chordConfidence(state: number, scores: readonly number[]) {
  const chosen = scores[state];
  if (chosen === undefined) return 0;
  let rival = -Infinity;
  for (let index = 0; index < scores.length; index++) if (index !== state) rival = Math.max(rival, scores[index]!);
  return Math.min(1, Math.max(0, (chosen - rival) / CONFIDENCE_MARGIN * 0.5 + 0.5));
}

// Krumhansl and Schmuckler's key profiles, correlated against the song's average
// chroma over all 24 rotations.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function estimateKey(chroma: ArrayLike<number>): MusicalKey | null {
  let total = 0;
  for (let pitch = 0; pitch < 12; pitch++) total += chroma[pitch]!;
  if (total <= 0) return null;
  const mean = total / 12;
  let deviation = 0;
  for (let pitch = 0; pitch < 12; pitch++) deviation += (chroma[pitch]! - mean) ** 2;
  if (deviation <= 0) return null;

  let best: MusicalKey | null = null;
  for (const [mode, profile] of [["major", MAJOR_PROFILE], ["minor", MINOR_PROFILE]] as const) {
    const profileMean = profile.reduce((sum, value) => sum + value, 0) / 12;
    let profileDeviation = 0;
    for (const value of profile) profileDeviation += (value - profileMean) ** 2;
    for (let tonic = 0; tonic < 12; tonic++) {
      let covariance = 0;
      for (let pitch = 0; pitch < 12; pitch++) covariance += (chroma[(tonic + pitch) % 12]! - mean) * (profile[pitch]! - profileMean);
      const strength = covariance / Math.sqrt(deviation * profileDeviation);
      if (!best || strength > best.strength) best = { tonic, mode, strength };
    }
  }
  return best;
}

export interface ChordSegment { startTimeUs: number; endTimeUs: number; chord: string; confidence: number }

/**
 * Decodes one chord per beat window and merges the runs into segments.
 *
 * `boundaries` are window edges in microseconds; there is one window between
 * each adjacent pair, which is what makes this beat-synchronous when the caller
 * passes beat times.
 */
export function detectChords(
  frames: { harmonic: Float64Array; bass: Float64Array; energy: number }[],
  hopSeconds: number,
  boundaries: readonly number[],
  // How tonal the spectrum the frames came from was, 0 to 1. Scales every
  // confidence reported, so a track whose peaks are not tonal partials cannot
  // print confident chord symbols over material no detector could read.
  trust = 1,
): { segments: ChordSegment[]; key: MusicalKey | null } {
  if (frames.length === 0 || boundaries.length < 2) return { segments: [], key: null };

  const average = new Float64Array(12);
  for (const frame of frames) for (let pitch = 0; pitch < 12; pitch++) average[pitch] = average[pitch]! + frame.harmonic[pitch]!;
  const key = estimateKey(average);

  const windows = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1]!;
    const firstFrame = Math.max(0, Math.floor(start / 1_000_000 / hopSeconds));
    const lastFrame = Math.min(frames.length - 1, Math.floor(end / 1_000_000 / hopSeconds));
    const harmonic = new Float64Array(12);
    const bass = new Float64Array(12);
    let energy = 0;
    let count = 0;
    for (let index2 = firstFrame; index2 <= lastFrame; index2++) {
      const frame = frames[index2]!;
      for (let pitch = 0; pitch < 12; pitch++) {
        harmonic[pitch] = harmonic[pitch]! + frame.harmonic[pitch]!;
        bass[pitch] = bass[pitch]! + frame.bass[pitch]!;
      }
      energy += frame.energy;
      count++;
    }
    if (count > 0) for (let pitch = 0; pitch < 12; pitch++) { harmonic[pitch] = harmonic[pitch]! / count; bass[pitch] = bass[pitch]! / count; }
    return { start, end, harmonic, bass, energy: count > 0 ? energy / count : 0 };
  });

  const scores = windows.map((window) => chordScores(window.harmonic, window.bass, window.energy));
  const path = decodeChords(scores, key);

  const segments: ChordSegment[] = [];
  for (let index = 0; index < path.length; index++) {
    const chord = chordSymbol(CHORD_STATES[path[index]!] ?? null, key);
    const confidence = chordConfidence(path[index]!, scores[index]!) * trust;
    const previous = segments.at(-1);
    if (previous?.chord === chord && previous.endTimeUs === windows[index]!.start) {
      previous.endTimeUs = windows[index]!.end;
      previous.confidence = Math.max(previous.confidence, confidence);
    } else {
      segments.push({ startTimeUs: windows[index]!.start, endTimeUs: windows[index]!.end, chord, confidence });
    }
  }
  return { segments, key };
}

// A window with no beat grid still needs boundaries; half a second is short
// enough to catch a change and long enough to average a strum over.
const FALLBACK_WINDOW_US = 500_000;

/**
 * Beat times when the grid is trustworthy, fixed windows when it is not.
 *
 * Every window must have width: the chord contract rejects a segment that ends
 * where it starts, and duplicate boundaries are how that happens.
 */
export function chordBoundaries(beatTimesUs: readonly number[], reliable: boolean, durationUs: number) {
  const rising = (times: number[]) => times.filter((time, index) => index === 0 || time > times[index - 1]!);
  if (reliable && beatTimesUs.length > 1) {
    const times = rising([...beatTimesUs].filter((time) => time < durationUs).sort((left, right) => left - right));
    if (times.length > 1) return rising([...(times[0]! > 0 ? [0] : []), ...times, durationUs]);
  }
  const count = Math.max(1, Math.ceil(durationUs / FALLBACK_WINDOW_US));
  return rising(Array.from({ length: count + 1 }, (_, index) => Math.min(durationUs, index * FALLBACK_WINDOW_US)));
}

export function keyName(key: MusicalKey | null) {
  if (!key) return null;
  const majorTonic = key.mode === "major" ? key.tonic : (key.tonic + 3) % 12;
  const names = FLAT_TONICS.has(majorTonic) ? FLAT_NAMES : SHARP_NAMES;
  return `${names[key.tonic]}${key.mode === "minor" ? "m" : ""}`;
}
