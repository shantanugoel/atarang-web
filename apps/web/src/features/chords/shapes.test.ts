import { describe, expect, test } from "bun:test";
import { bestChordShape, chordShapes, displayChord, isOpenShape, reduceChord } from "./shapes";
import type{ChordComplexityV1,UserChordV1}from"@atarang/contracts";

describe("guitar shape catalogue", () => {
  test("prefers the open shape when there is one", () => {
    expect(bestChordShape("C")?.frets).toEqual([null, 3, 2, 0, 1, 0]);
    expect(bestChordShape("Am")?.frets).toEqual([null, 0, 2, 2, 1, 0]);
    expect(bestChordShape("C")?.barreFret).toBeUndefined();
  });

  test("answers roots with no open shape by moving a barre form", () => {
    // Bb major is the A shape moved up one fret.
    const bFlat = bestChordShape("Bb");
    expect(bFlat?.barreFret).toBe(1);
    expect(bFlat?.frets).toEqual([null, 1, 3, 3, 3, 1]);
    // The old catalogue had six shapes and drew nothing for any of these.
    for (const chord of ["Bb", "F#m", "Ebmaj7", "C#m7", "G7", "Dsus4", "Bdim"]) {
      expect(chordShapes(chord).length).toBeGreaterThan(0);
    }
  });

  test("reads the same chord however it is written", () => {
    expect(bestChordShape("A#")?.frets).toEqual(bestChordShape("Bb")?.frets);
    expect(bestChordShape("Cmin7")?.frets).toEqual(bestChordShape("Cm7")?.frets);
    // A slash chord is the same grip with a different note underneath.
    expect(bestChordShape("C/G")?.frets).toEqual(bestChordShape("C")?.frets);
  });

  test("says nothing rather than inventing a box", () => {
    expect(chordShapes("C9")).toEqual([]);
    expect(chordShapes("not a chord")).toEqual([]);
  });

  test("a saved voicing outranks the catalogue and resolves aliases",()=>{const saved:UserChordV1={schema:"atarang.user-chord/1",chordId:"019fef4f-9c77-7a3f-94ca-ef4214a806a1",revision:0,symbol:"A#",frets:[6,8,8,7,6,6],barreFret:6,updatedAt:"2026-08-11T00:00:00.000Z"};expect(bestChordShape("Bb/F",[saved])).toMatchObject({frets:saved.frets,barreFret:6,userDefined:true})});

  test("a saved voicing can cover a quality outside the built-in catalogue",()=>{const saved:UserChordV1={schema:"atarang.user-chord/1",chordId:"019fef4f-9c77-7a3f-94ca-ef4214a806a2",revision:0,symbol:"C9",frets:[null,3,2,3,3,3],updatedAt:"2026-08-11T00:00:00.000Z"};expect(bestChordShape("C9",[saved])?.userDefined).toBe(true)});

  test("an open shape needs an open string, not just a catalogue entry", () => {
    expect(isOpenShape("Am")).toBe(true);
    expect(isOpenShape("Cmaj7")).toBe(true);
    // The catalogue's F is the first-fret full barre — the exact chord this
    // level exists to get a beginner out of.
    expect(isOpenShape("F")).toBe(false);
    expect(isOpenShape("Bb")).toBe(false);
  });

  describe("complexity levels", () => {
    test("full leaves the symbol alone", () => expect(reduceChord("Bbmaj7/D", "full")).toBe("Bbmaj7/D"));
    test("triads drop the extension and keep the bass", () => expect(reduceChord("Bbmaj7/D", "simple")).toBe("Bb/D"));
    test("power chords are root and fifth, with no note underneath", () => expect(reduceChord("Bbmaj7/D", "power")).toBe("Bb5"));

    test("open shapes stop at the first substitution that is playable", () => {
      // Already open, so nothing is taken away.
      expect(reduceChord("Am7", "beginner")).toBe("Am7");
      // Cmaj9 has no shape at all; its triad C does.
      expect(reduceChord("Cmaj9", "beginner")).toBe("C");
      // Edim has an open grip of its own now that the catalogue covers the
      // qualities the detector can name, so there is nothing to substitute.
      expect(reduceChord("Edim", "beginner")).toBe("Edim");
      // No open Csus4, but the major it resolves to is open.
      expect(reduceChord("Csus4", "beginner")).toBe("C");
      // xx3210 is easier than the first-fret barre it would reduce to, so the
      // seventh is left alone. Reducing on principle would make this harder.
      expect(reduceChord("Fmaj7", "beginner")).toBe("Fmaj7");
    });

    test("open shapes admit the chord it cannot rescue rather than printing another", () => {
      // Nothing about F or Bm is open at any level, so the triad stands and the
      // player is told the truth: this song needs an F.
      expect(reduceChord("F", "beginner")).toBe("F");
      expect(reduceChord("Bm9", "beginner")).toBe("Bm");
    });

    test("a symbol with no chord in it survives every level", () => {
      for (const level of ["full", "simple", "beginner", "power"] as const) expect(reduceChord("N", level)).toBe("N");
    });

    // The order is the whole point. Reducing first would keep Am7 whole (it is
    // open) and then transpose it to Bm7, which is a barre — beginner would
    // have judged a key the hand is not playing in.
    test("transposes before reducing, so beginner judges the key on screen", () => {
      expect(displayChord("Am7", { transposeSemitones: 0, complexity: "beginner", capo: 0 })).toBe("Am7");
      expect(displayChord("Am7", { transposeSemitones: 2, complexity: "beginner", capo: 0 })).toBe("Bm");
    });
  });

  describe("capo", () => {
    const grip = (symbol: string, capo: number, complexity: ChordComplexityV1 = "full") => displayChord(symbol, { transposeSemitones: 0, complexity, capo });
    // The reported bug: the control moved and nothing on screen did.
    test("moves every chord down by its fret", () => {
      expect(grip("A", 0)).toBe("A");
      expect(grip("A", 2)).toBe("G");
      // Quality and slash bass ride along; a flat-spelled chord stays flat.
      expect(grip("Bbmaj7/D", 1)).toBe("Amaj7/Db");
    });
    test("stacks with transposition rather than replacing it", () => {
      // Up a tone and capo 2 is the same hand shape as neither applied.
      expect(displayChord("A", { transposeSemitones: 2, complexity: "full", capo: 2 })).toBe("A");
      expect(displayChord("A", { transposeSemitones: 2, complexity: "full", capo: 0 })).toBe("B");
    });
    // Fitting a capo is how a guitarist turns a barre song into an open one, so
    // the level has to judge the grip after the capo has moved it.
    test("lets the open-shapes level see the chord the hand actually makes", () => {
      expect(grip("Bb", 0, "beginner")).toBe("Bb");
      expect(grip("Bb", 1, "beginner")).toBe("A");
      expect(grip("Bb", 3, "beginner")).toBe("G");
    });
  });

  test("every shape is physically reachable", () => {
    for (const root of ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]) {
      for (const quality of ["", "m", "7", "m7", "maj7", "sus4"]) {
        const shape = bestChordShape(root + quality);
        expect(shape).toBeDefined();
        const fretted = shape!.frets.filter((f): f is number => f !== null && f > 0);
        const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
        expect(span).toBeLessThanOrEqual(4);
        expect(Math.max(0, ...fretted)).toBeLessThanOrEqual(12);
      }
    }
  });
});
