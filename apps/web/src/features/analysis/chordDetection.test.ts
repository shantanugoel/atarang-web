import { describe, expect, test } from "bun:test";
import FFT from "fft.js";
import {
  bassChromaFrame,
  chordConfidence,
  chordScores,
  CHORD_STATES,
  chordSymbol,
  chromaGeometry,
  decodeChords,
  detectChords,
  estimateKey,
  harmonicChromaFrame,
  keyName,
} from "./chordDetection";

const indexOf = (symbol: string) => CHORD_STATES.findIndex((state) => chordSymbol(state) === symbol);
const SAMPLE_RATE = 44_100;

/**
 * Renders a chord as a plucked stack of partials over a bass root, with cymbal
 * hiss on top.
 *
 * The hiss is the point of the fixture, not decoration: it sits between 12 and
 * 20 kHz, where a real mix keeps its cymbals and sibilance. Analysis that
 * decimates to 22.05 kHz without an anti-alias filter folds all of it into the
 * harmonic band and decodes noise.
 */
function renderChord(pitchClasses: readonly number[], bassPitchClass: number, seconds: number) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const midiFor = (pitchClass: number, octave: number) => 12 * (octave + 1) + pitchClass;
  const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  let noise = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const time = frame / SAMPLE_RATE;
    let value = 0;
    for (const pitchClass of pitchClasses) {
      const fundamental = frequency(midiFor(pitchClass, 4));
      // A few partials, so overtone suppression has something to suppress.
      for (let harmonic = 1; harmonic <= 5; harmonic++) value += (0.5 / harmonic) * Math.sin(2 * Math.PI * fundamental * harmonic * time);
    }
    const bass = frequency(midiFor(bassPitchClass, 2));
    value += 1.4 * Math.sin(2 * Math.PI * bass * time) + 0.4 * Math.sin(4 * Math.PI * bass * time);
    // Deterministic high-frequency hash, band-limited to 12-20 kHz by summing
    // fixed inharmonic tones a real cymbal would land on.
    noise = (noise * 1_103_515_245 + 12_345) % 2_147_483_648;
    for (const partial of [12_500, 14_300, 16_100, 17_900, 19_700]) value += 0.5 * Math.sin(2 * Math.PI * partial * time + noise / 2_147_483_648);
    samples[frame] = value * 0.1;
  }
  return samples;
}

/** The same framing the analysis worker uses: centred Hann windows at the hop. */
function analyse(samples: Float32Array) {
  const { size, hop } = chromaGeometry(SAMPLE_RATE);
  const fft = new FFT(size);
  const output = fft.createComplexArray();
  const input = new Array<number>(size).fill(0);
  const magnitudes = new Float64Array(size / 2 + 1);
  const window = Array.from({ length: size }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1)));
  const frames: { harmonic: Float64Array; bass: Float64Array; energy: number }[] = [];
  const half = size / 2;
  for (let start = -half; start + size <= samples.length + half; start += hop) {
    for (let offset = 0; offset < size; offset++) {
      const position = start + offset;
      input[offset] = (position >= 0 && position < samples.length ? samples[position]! : 0) * window[offset]!;
    }
    fft.realTransform(output, input);
    for (let bin = 0; bin <= size / 2; bin++) magnitudes[bin] = Math.hypot(output[bin * 2]!, output[bin * 2 + 1]!);
    const harmonic = harmonicChromaFrame(magnitudes, SAMPLE_RATE, size);
    const bass = bassChromaFrame(magnitudes, SAMPLE_RATE, size);
    frames.push({ harmonic: harmonic.chroma, bass: bass.chroma, energy: harmonic.energy });
  }
  return frames;
}

describe("chord templates and scoring", () => {
  test("a clean triad beats every rival and a flat chroma beats none", () => {
    const flat = new Float64Array(12).fill(1);
    const bass = new Float64Array(12);
    const cMajor = new Float64Array(12);
    for (const pitch of [0, 4, 7]) cMajor[pitch] = 1;

    const clean = chordScores(cMajor, bass, 1);
    expect(clean[indexOf("C")]).toBeGreaterThan(0.9);
    // Nothing fits noise better than the no-chord constant does.
    const noise = chordScores(flat, bass, 1);
    expect(noise[CHORD_STATES.length - 1]).toBeGreaterThanOrEqual(Math.max(...noise));
    // Silence is not harmony nobody could name.
    expect(chordScores(cMajor, bass, 0)[CHORD_STATES.length - 1]).toBe(1);
  });

  test("the bass breaks the tie between a chord and its relative minor", () => {
    // C E G A fits both C6 and Am7; only the bass says which.
    const shared = new Float64Array(12);
    for (const pitch of [0, 4, 7, 9]) shared[pitch] = 1;
    const overC = new Float64Array(12);
    overC[0] = 1;
    const overA = new Float64Array(12);
    overA[9] = 1;
    expect(chordScores(shared, overC, 1)[indexOf("C")]!).toBeGreaterThan(chordScores(shared, overC, 1)[indexOf("Am")]!);
    expect(chordScores(shared, overA, 1)[indexOf("Am")]!).toBeGreaterThan(chordScores(shared, overA, 1)[indexOf("C")]!);
  });

  test("the decoder does not print a new chord for one noisy beat", () => {
    const steady = CHORD_STATES.map((state) => (chordSymbol(state) === "C" ? 0.9 : 0.5));
    // One beat where G edges ahead by less than the change penalty.
    const blip = CHORD_STATES.map((state) => (chordSymbol(state) === "G" ? 0.95 : chordSymbol(state) === "C" ? 0.9 : 0.5));
    const path = decodeChords([steady, steady, blip, steady, steady], null);
    expect(path.map((state) => chordSymbol(CHORD_STATES[state]!))).toEqual(["C", "C", "C", "C", "C"]);
  });

  test("the decoder does follow a real change", () => {
    const c = CHORD_STATES.map((state) => (chordSymbol(state) === "C" ? 0.95 : 0.4));
    const g = CHORD_STATES.map((state) => (chordSymbol(state) === "G" ? 0.95 : 0.4));
    const path = decodeChords([c, c, c, g, g, g], null);
    expect(path.map((state) => chordSymbol(CHORD_STATES[state]!))).toEqual(["C", "C", "C", "G", "G", "G"]);
  });

  test("confidence separates a decisive win from a coin toss", () => {
    expect(chordConfidence(0, [0.9, 0.4, 0.4])).toBe(1);
    expect(chordConfidence(0, [0.5, 0.5, 0.4])).toBe(0.5);
  });
});

describe("key estimation", () => {
  test("recognises a C major scale and names flat keys with flats", () => {
    const cMajor = new Float64Array(12);
    for (const pitch of [0, 2, 4, 5, 7, 9, 11]) cMajor[pitch] = 1;
    cMajor[0] = 3; cMajor[7] = 2; cMajor[4] = 2;
    expect(keyName(estimateKey(cMajor))).toBe("C");

    const eFlatMajor = new Float64Array(12);
    for (const pitch of [3, 5, 7, 8, 10, 0, 2]) eFlatMajor[pitch] = 1;
    eFlatMajor[3] = 3; eFlatMajor[10] = 2; eFlatMajor[7] = 2;
    expect(keyName(estimateKey(eFlatMajor))).toBe("Eb");
  });
});

describe("end to end on rendered audio", () => {
  test("decodes a I-V-vi-IV progression from synthesised audio", () => {
    const progression = [
      { symbol: "C", pitches: [0, 4, 7], bass: 0 },
      { symbol: "G", pitches: [7, 11, 2], bass: 7 },
      { symbol: "Am", pitches: [9, 0, 4], bass: 9 },
      { symbol: "F", pitches: [5, 9, 0], bass: 5 },
    ];
    const barSeconds = 2;
    const samples = new Float32Array(progression.length * barSeconds * SAMPLE_RATE);
    progression.forEach((chord, index) => samples.set(renderChord(chord.pitches, chord.bass, barSeconds), index * barSeconds * SAMPLE_RATE));

    const frames = analyse(samples);
    const hopSeconds = chromaGeometry(SAMPLE_RATE).hop / SAMPLE_RATE;
    // One window per half bar, so a wrong boundary would show up as a split.
    const boundaries = Array.from({ length: progression.length * 2 + 1 }, (_, index) => Math.round(index * barSeconds / 2 * 1_000_000));

    const { segments, key } = detectChords(frames, hopSeconds, boundaries);
    expect(segments.map((segment) => segment.chord)).toEqual(["C", "G", "Am", "F"]);
    expect(keyName(key)).toBe("C");
    for (const segment of segments) expect(segment.confidence).toBeGreaterThan(0.5);
    // Boundaries land on the bar lines, within one window.
    expect(segments[1]!.startTimeUs).toBe(2_000_000);
    expect(segments[3]!.endTimeUs).toBe(8_000_000);
  });
});
