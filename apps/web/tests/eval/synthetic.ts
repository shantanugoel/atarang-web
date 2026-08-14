/**
 * A chord progression with ground truth nobody had to annotate.
 *
 * Synthetic triads have none of what makes a recording hard, so a score against
 * this is a floor and a plumbing check, never evidence. It exists so the eval
 * harness and the stem decode can both be exercised without private data.
 */
const RATE = 44_100;
const SECONDS_PER_CHORD = 4;
// Roots as semitones from C4, with the intervals the label promises.
const PROGRESSION = [
  { label: "C:maj", root: 0, intervals: [0, 4, 7] },
  { label: "A:min", root: 9, intervals: [0, 3, 7] },
  { label: "F:maj", root: 5, intervals: [0, 4, 7] },
  { label: "G:7", root: 7, intervals: [0, 4, 7, 10] },
];

/**
 * One note as a fundamental and five harmonics with a natural rolloff.
 *
 * Pure sines would be the easier fixture and the wrong one: the chroma stage
 * only counts spectral peaks that clear a local floor, and the model was trained
 * on instruments, so a signal with no overtones is not a simpler version of the
 * problem but a different one.
 */
function note(buffer: Float64Array, semitones: number, from: number, to: number, gain: number) {
  const frequency = 261.625_565 * 2 ** (semitones / 12);
  for (let harmonic = 1; harmonic <= 6; harmonic++) {
    if (frequency * harmonic > RATE / 2) break;
    const amplitude = gain / harmonic ** 1.4;
    for (let sample = from; sample < to; sample++) {
      // Struck rather than switched on: an instantaneous edge is broadband, and
      // the beat tracker would read the clicks instead of the notes.
      const envelope = Math.min(1, (sample - from) / (RATE * 0.02)) * Math.exp(-(sample - from) / (RATE * 1.6));
      buffer[sample] += amplitude * envelope * Math.sin(2 * Math.PI * frequency * harmonic * sample / RATE);
    }
  }
}

function wav(samples: Float64Array) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + samples.length * 2, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples.length * 2, 40);
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0 ? 0.89 / peak : 0;
  for (let index = 0; index < samples.length; index++) bytes.writeInt16LE(Math.round(samples[index]! * scale * 32_767), 44 + index * 2);
  return bytes;
}

/**
 * The progression twice through, as a mixture and as the two stems a chord
 * decode reads — the chords in `other`, the root an octave down in `bass`,
 * which is the split the separator would have produced.
 */
export function syntheticProgression(passes = 2) {
  const chords = Array.from({ length: passes }, () => PROGRESSION).flat();
  const length = chords.length * SECONDS_PER_CHORD * RATE;
  const other = new Float64Array(length), bass = new Float64Array(length), mixture = new Float64Array(length);
  const lines: string[] = [];

  chords.forEach((chord, index) => {
    const from = index * SECONDS_PER_CHORD * RATE, to = from + SECONDS_PER_CHORD * RATE;
    // Re-struck every beat at 120 bpm, because a chord held as one long tone has
    // no onsets and the beat grid it is scored against would be a guess.
    for (let beat = 0; beat < SECONDS_PER_CHORD * 2; beat++) {
      const beatFrom = from + beat * RATE / 2;
      for (const interval of chord.intervals) note(other, chord.root + interval, beatFrom, to, 0.3);
      note(bass, chord.root - 12, beatFrom, to, 0.35);
    }
    lines.push(`${(index * SECONDS_PER_CHORD).toFixed(6)} ${((index + 1) * SECONDS_PER_CHORD).toFixed(6)} ${chord.label}`);
  });
  for (let index = 0; index < length; index++) mixture[index] = other[index]! + bass[index]!;

  return { mixture: wav(mixture), other: wav(other), bass: wav(bass), lab: `${lines.join("\n")}\n`, durationFrames: length, sampleRate: RATE };
}
