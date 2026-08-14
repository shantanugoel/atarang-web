import { describe, expect, test } from "bun:test";
import { detectTaggedChords, parseTagLabel } from "./chordDetection";
import { chordVocabulary } from "../../generated/chord-model";

/**
 * The trained head names chords itself, and nothing in the ONNX graph says which
 * output means which chord. The order comes from the checkpoint's own encoder
 * via `models/chords/convert.py`; these tests are what stops a wrong order from
 * shipping as a plausible-looking transposition of every chord in the app.
 */
describe("the model's chord vocabulary", () => {
  test("is the 170 classes the checkpoint was trained on", () => {
    expect(chordVocabulary).toHaveLength(170);
    // Sorted, because pumpp fits a LabelEncoder on the vocabulary and sklearn
    // sorts. `vocabulary()` returns a different order and is the wrong one.
    expect([...chordVocabulary]).toEqual([...chordVocabulary].sort());
    expect(chordVocabulary).toContain("N");
    expect(chordVocabulary).toContain("X");
    // Twelve roots times fourteen qualities, plus N and X.
    expect(chordVocabulary.filter((label) => label.endsWith(":maj"))).toHaveLength(12);
  });

  test("every label reads as a chord, or as deliberately not one", () => {
    const parsed = chordVocabulary.map(parseTagLabel);
    expect(parsed.filter((chord) => chord === null)).toHaveLength(2);
    for (const chord of parsed) if (chord) expect(chord.pitchClasses[0]).toBe(chord.root);
  });
});

describe("reading one label", () => {
  test("roots and qualities become the symbols this app writes", () => {
    expect(parseTagLabel("C:maj")).toMatchObject({ root: 0, symbol: "" });
    expect(parseTagLabel("A:min")).toMatchObject({ root: 9, symbol: "m" });
    expect(parseTagLabel("G:7")).toMatchObject({ root: 7, symbol: "7" });
    expect(parseTagLabel("F:maj7")).toMatchObject({ root: 5, symbol: "maj7" });
    expect(parseTagLabel("A#:hdim7")).toMatchObject({ root: 10, symbol: "m7b5" });
    expect(parseTagLabel("Db:min6")).toMatchObject({ root: 1, symbol: "m6" });
  });

  test("the two that name no chord name no chord", () => {
    // X is "a chord outside this vocabulary" — the model declining to answer,
    // which the app can neither draw nor transpose.
    expect(parseTagLabel("N")).toBeNull();
    expect(parseTagLabel("X")).toBeNull();
  });

  test("pitch classes are the chord's own, wrapped", () => {
    expect(parseTagLabel("A:maj")?.pitchClasses).toEqual([9, 1, 4]);
    expect(parseTagLabel("B:min7")?.pitchClasses).toEqual([11, 2, 6, 9]);
  });
});

// A posterior over the real vocabulary with one class believed.
const believing = (label: string, confidence = 0.9) => {
  const tag = new Float64Array(chordVocabulary.length).fill((1 - confidence) / (chordVocabulary.length - 1));
  tag[(chordVocabulary as readonly string[]).indexOf(label)] = confidence;
  return { harmonic: new Float64Array(12), bass: new Float64Array(12), tag };
};
const held = (label: string, frames: number) => Array.from({ length: frames }, () => believing(label));

describe("decoding the trained head", () => {
  test("a confident run of one chord becomes one segment", () => {
    const decoded = detectTaggedChords(held("C:maj", 20), 0.1, [0, 1_000_000, 2_000_000], chordVocabulary);
    expect(decoded.segments).toHaveLength(1);
    expect(decoded.segments[0]!.chord).toBe("C");
  });

  test("a change of chord is a change of segment", () => {
    const frames = [...held("C:maj", 10), ...held("A:min", 10)];
    const decoded = detectTaggedChords(frames, 0.1, [0, 1_000_000, 2_000_000], chordVocabulary);
    expect(decoded.segments.map((segment) => segment.chord)).toEqual(["C", "Am"]);
  });

  test("a seventh survives, where a prior used to have to be beaten", () => {
    // The templates charged -0.12 for printing any seventh at all, because on a
    // dense chroma a four-note template wins on coverage. A trained head has the
    // real prior in it and needs no such tax.
    const decoded = detectTaggedChords(held("G:7", 20), 0.1, [0, 2_000_000], chordVocabulary);
    expect(decoded.segments[0]!.chord).toBe("G7");
  });

  test("no chord is a label, not a gap", () => {
    const decoded = detectTaggedChords(held("N", 20), 0.1, [0, 2_000_000], chordVocabulary);
    expect(decoded.segments[0]!.chord).toBe("N");
  });

  test("one wavering window does not break a held chord", () => {
    // The change penalty is what makes harmony piecewise constant; without it
    // the decoder prints a different chord on every beat it is unsure about.
    const frames = [...held("C:maj", 8), believing("A:min", 0.4), ...held("C:maj", 8)];
    const boundaries = [0, 400_000, 500_000, 900_000];
    expect(detectTaggedChords(frames, 0.05, boundaries, chordVocabulary).segments).toHaveLength(1);
  });

  test("confidence is scaled by how much the front end is trusted", () => {
    const trusted = detectTaggedChords(held("C:maj", 20), 0.1, [0, 2_000_000], chordVocabulary, 1);
    const doubted = detectTaggedChords(held("C:maj", 20), 0.1, [0, 2_000_000], chordVocabulary, 0.25);
    expect(doubted.segments[0]!.confidence).toBeCloseTo(trusted.segments[0]!.confidence * 0.25, 10);
  });
});
