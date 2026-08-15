import { describe, expect, test } from "bun:test";
import { detectPitch, medianHz, nearestNote } from "./pitch";

const RATE = 44_100, FRAME = 2048;

// Seeded, because a detector tested against Math.random() passes or fails by the
// run — and an occasionally red test is worth less than no test at all.
function noiseSource(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 2_147_483_648 - 1;
  };
}

/** A plucked string: a fundamental with partials, the second often the loudest. */
function tone(hz: number, partials = [1, 1.4, 0.7, 0.4], noise = 0, seed = 1) {
  const samples = new Float32Array(FRAME), hiss = noiseSource(seed);
  for (let index = 0; index < FRAME; index++) {
    let value = 0;
    for (const [partial, gain] of partials.entries()) value += gain * Math.sin(2 * Math.PI * hz * (partial + 1) * index / RATE);
    samples[index] = value * 0.2 + (noise ? hiss() * noise : 0);
  }
  return samples;
}

const cents = (measured: number, expected: number) => 1200 * Math.log2(measured / expected);

describe("pitch detection", () => {
  // The bar for shipping this at all: a tuner is read as truth, and 5 cents is
  // about where a guitarist starts to hear it.
  test("reads open strings to within two cents", () => {
    for (const hz of [82.41, 110, 146.83, 196, 246.94, 329.63]) {
      const found = detectPitch(tone(hz), RATE);
      expect(found).not.toBeNull();
      expect(Math.abs(cents(found!.hz, hz))).toBeLessThan(2);
      expect(found!.clarity).toBeGreaterThan(0.8);
    }
  });

  test("does not drop an octave when a partial is louder than the fundamental", () => {
    // The classic autocorrelation failure: second partial at twice the level.
    const found = detectPitch(tone(196, [0.4, 1, 0.6]), RATE);
    expect(Math.abs(cents(found!.hz, 196))).toBeLessThan(5);
  });

  // What a noisy room actually costs, and what the sheet does about it: one frame
  // under heavy hiss lands within about five cents, and the median of five — which
  // is exactly what the readout shows — pulls it back inside two.
  test("a noisy room costs a few cents on one frame", () => {
    const found = detectPitch(tone(146.83, undefined, 0.08), RATE);
    expect(Math.abs(cents(found!.hz, 146.83))).toBeLessThan(10);
  });

  test("and the median of several frames wins them back", () => {
    const readings = [1, 2, 3, 4, 5].map((seed) => detectPitch(tone(146.83, undefined, 0.08, seed), RATE)!.hz);
    expect(Math.abs(cents(medianHz(readings)!, 146.83))).toBeLessThan(2);
  });

  test("says nothing rather than inventing a note", () => {
    expect(detectPitch(new Float32Array(FRAME), RATE)).toBeNull();
    // Several seeds, because one lucky buffer of noise can look periodic and the
    // claim is about noise in general, not about one array of it.
    for (const seed of [1, 7, 99, 2_026]) {
      const noise = new Float32Array(FRAME), hiss = noiseSource(seed);
      for (let index = 0; index < FRAME; index++) noise[index] = hiss();
      const found = detectPitch(noise, RATE);
      expect(found === null || found.clarity < 0.6).toBe(true);
    }
  });

  test("a frame too short for the lowest note is refused, not guessed", () => {
    expect(detectPitch(new Float32Array(32), RATE)).toBeNull();
  });
});

describe("naming the note", () => {
  test("names concert A and the strings around it", () => {
    expect(nearestNote(440)).toEqual({ name: "A", octave: 4, cents: 0 });
    expect(nearestNote(82.41)).toEqual({ name: "E", octave: 2, cents: 0 });
    expect(nearestNote(329.63)).toEqual({ name: "E", octave: 4, cents: 0 });
  });
  test("reports which side of the note it is on", () => {
    expect(nearestNote(440 * 2 ** (10 / 1200)).cents).toBe(10);
    expect(nearestNote(440 * 2 ** (-10 / 1200)).cents).toBe(-10);
  });
  test("follows a reference the band is actually playing at", () => {
    expect(nearestNote(432, 432)).toEqual({ name: "A", octave: 4, cents: 0 });
  });
});

describe("steadying the readout", () => {
  test("one wild frame does not move the needle", () => {
    expect(medianHz([110.1, 109.9, 220.4, 110.2, 110])).toBeCloseTo(110.1, 1);
  });
  test("nothing to report before anything has been heard", () => {
    expect(medianHz([])).toBeNull();
  });
});
