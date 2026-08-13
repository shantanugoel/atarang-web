import { describe, expect, test } from "bun:test";
import { bestChordShape, chordShapes } from "./shapes";
import type{UserChordV1}from"@atarang/contracts";

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
    expect(chordShapes("Cdim7")).toEqual([]);
    expect(chordShapes("not a chord")).toEqual([]);
  });

  test("a saved voicing outranks the catalogue and resolves aliases",()=>{const saved:UserChordV1={schema:"atarang.user-chord/1",chordId:"019fef4f-9c77-7a3f-94ca-ef4214a806a1",revision:0,symbol:"A#",frets:[6,8,8,7,6,6],barreFret:6,updatedAt:"2026-08-11T00:00:00.000Z"};expect(bestChordShape("Bb/F",[saved])).toMatchObject({frets:saved.frets,barreFret:6,userDefined:true})});

  test("a saved voicing can cover a quality outside the built-in catalogue",()=>{const saved:UserChordV1={schema:"atarang.user-chord/1",chordId:"019fef4f-9c77-7a3f-94ca-ef4214a806a2",revision:0,symbol:"Cdim7",frets:[null,3,4,2,4,null],updatedAt:"2026-08-11T00:00:00.000Z"};expect(bestChordShape("Cdim7",[saved])?.userDefined).toBe(true)});

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
