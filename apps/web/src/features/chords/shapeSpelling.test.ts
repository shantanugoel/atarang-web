import { describe, expect, test } from "bun:test";
import { chordShapes } from "./shapes";

/**
 * Every shape in the catalogue, checked against the notes it claims to play.
 *
 * The catalogue is hand-written fingerings, and a wrong one is invisible: it
 * draws a perfectly plausible box that is a different chord. The comment in
 * `shapes.ts` says no diagram beats a wrong diagram — this is what makes that
 * true for the qualities the trained head can now name, none of which existed
 * when the catalogue was six shapes of major and minor.
 */

/** Open-string pitch classes, low to high: E A D G B E. */
const STRINGS = [4, 9, 2, 7, 11, 4];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const QUALITIES: Record<string, number[]> = {
  "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6],
  aug: [0, 4, 8], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], mMaj7: [0, 3, 7, 11], "5": [0, 7],
};

const sounded = (frets: (number | null)[]) =>
  new Set(frets.map((fret, string) => (fret === null ? null : (STRINGS[string]! + fret) % 12)).filter((pitch): pitch is number => pitch !== null));

describe("what the catalogue actually plays", () => {
  for (const [quality, intervals] of Object.entries(QUALITIES)) {
    test(`${quality || "major"} spells itself at every root`, () => {
      for (let root = 0; root < 12; root++) {
        const symbol = `${NAMES[root]}${quality}`;
        const shapes = chordShapes(symbol);
        expect(shapes.length, `${symbol} has no shape`).toBeGreaterThan(0);
        const wanted = new Set(intervals.map((interval) => (root + interval) % 12));
        // The perfect fifth is the one note a guitarist drops without changing
        // the chord's name. Everything else is what makes it that chord: the
        // third, the seventh, the sixth, and the altered fifth of a diminished
        // or augmented chord, which is the whole point of it.
        const required = quality === "5" ? intervals : intervals.filter((interval) => interval !== 7);
        for (const shape of shapes) {
          const notes = sounded(shape.frets);
          for (const pitch of notes) {
            expect(wanted.has(pitch), `${symbol} at barre ${shape.barreFret ?? 0} plays ${NAMES[pitch]}, which is not in the chord`).toBe(true);
          }
          for (const interval of required) {
            expect(notes.has((root + interval) % 12), `${symbol} at barre ${shape.barreFret ?? 0} is missing its ${interval === 0 ? "root" : `interval ${interval}`}`).toBe(true);
          }
        }
      }
    });
  }

  test("a shape is six strings, fretted within reach", () => {
    for (const quality of Object.keys(QUALITIES)) {
      for (let root = 0; root < 12; root++) {
        for (const shape of chordShapes(`${NAMES[root]}${quality}`)) {
          expect(shape.frets).toHaveLength(6);
          const fretted = shape.frets.filter((fret): fret is number => fret !== null);
          expect(Math.min(...fretted)).toBeGreaterThanOrEqual(0);
          expect(Math.max(...fretted)).toBeLessThanOrEqual(15);
          // A hand spans about four frets above the barre; more than that is a
          // shape nobody can hold, however right its notes are.
          const above = fretted.filter((fret) => fret > 0);
          if (above.length) expect(Math.max(...above) - Math.min(...above)).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});
