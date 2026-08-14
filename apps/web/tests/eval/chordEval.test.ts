import { describe, expect, test } from "bun:test";
import { NO_CHORD, align, asPercent, parseChord, parseLab, pool, score, type Interval } from "./chordEval";

const seconds = (start: number, end: number, chord: string): Interval => ({ startUs: start * 1e6, endUs: end * 1e6, chord });

describe("reading chord symbols", () => {
  test("both notations name the same chord", () => {
    // The annotations are Harte and the detector's output is not, and a scorer
    // that quietly failed to read one side would report a perfect zero.
    expect(parseChord("A:min")).toEqual(parseChord("Am"));
    expect(parseChord("C:maj")).toEqual(parseChord("C"));
    expect(parseChord("G:7")).toEqual(parseChord("G7"));
    expect(parseChord("F:maj7")).toEqual(parseChord("Fmaj7"));
  });

  test("accidentals and enharmonics land on one pitch class", () => {
    expect(parseChord("Db:maj")).toEqual(parseChord("C#"));
    expect(parseChord("Bb:min")).toEqual(parseChord("A#m"));
  });

  test("an inversion is the chord it is an inversion of", () => {
    // No metric here is defined over the bass note, so reading past the slash
    // would only invent disagreements.
    expect(parseChord("C:maj/5")).toEqual(parseChord("C:maj"));
    expect(parseChord("C/G")).toEqual(parseChord("C"));
  });

  test("silence is a label and nonsense is not", () => {
    expect(parseChord("N")).toBe(NO_CHORD);
    // X is the annotators' "unknown", which is not the same claim as "silent".
    expect(parseChord("X")).toBeNull();
    expect(parseChord("H:wat")).toBeNull();
    expect(parseChord("")).toBeNull();
  });
});

describe("reading a .lab file", () => {
  test("whitespace-separated seconds become microsecond intervals", () => {
    const parsed = parseLab("0.000000 2.612267 N\n2.612267\t5.2\tC:maj\n\n# a comment line\n");
    expect(parsed).toEqual([
      { startUs: 0, endUs: 2_612_267, chord: "N" },
      { startUs: 2_612_267, endUs: 5_200_000, chord: "C:maj" },
    ]);
  });
});

describe("putting two annotations on one clock", () => {
  test("boundaries from both sides split the timeline", () => {
    const spans = align([seconds(0, 4, "C:maj")], [seconds(0, 1, "C"), seconds(1, 4, "Am")]);
    expect(spans).toEqual([
      { start: 0, end: 1e6, reference: "C:maj", estimate: "C" },
      { start: 1e6, end: 4e6, reference: "C:maj", estimate: "Am" },
    ]);
  });

  test("time the estimate never covers is wrong, not absent", () => {
    // A detector that stops early would otherwise score full marks on the part
    // it bothered to answer.
    const spans = align([seconds(0, 4, "C:maj")], [seconds(0, 2, "C")]);
    expect(spans.at(-1)).toEqual({ start: 2e6, end: 4e6, reference: "C:maj", estimate: "N" });
  });

  test("an estimate running past the annotation is ignored", () => {
    const spans = align([seconds(0, 2, "C:maj")], [seconds(0, 9, "C")]);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.end).toBe(2e6);
  });
});

describe("weighted chord symbol recall", () => {
  test("an exact match scores one everywhere", () => {
    const reference = [seconds(0, 2, "C:maj"), seconds(2, 4, "A:min7")];
    const report = score(reference, [seconds(0, 2, "C"), seconds(2, 4, "Am7")]);
    for (const value of Object.values(report.scores)) expect(value.recall).toBe(1);
    expect(report.unparsedUs).toBe(0);
  });

  test("the right root with the wrong third splits the metrics", () => {
    // This is the failure the current template decoder makes most, so it is the
    // one the harness has to be able to see.
    const report = score([seconds(0, 4, "C:maj")], [seconds(0, 4, "Cm")]);
    expect(report.scores.root!.recall).toBe(1);
    expect(report.scores.thirds!.recall).toBe(0);
    expect(report.scores.majmin!.recall).toBe(0);
  });

  test("a seventh heard as a triad is right on majmin and wrong on sevenths", () => {
    const report = score([seconds(0, 4, "G:7")], [seconds(0, 4, "G")]);
    expect(report.scores.majmin!.recall).toBe(1);
    expect(report.scores.sevenths!.recall).toBe(0);
  });

  test("duration decides, not segment count", () => {
    // Nine seconds right and one wrong is 90%, however many segments that took.
    const reference = [seconds(0, 9, "C:maj"), seconds(9, 10, "F:maj")];
    const report = score(reference, [seconds(0, 9, "C"), seconds(9, 10, "G")]);
    expect(report.scores.majmin!.recall).toBeCloseTo(0.9, 10);
  });

  test("chords a metric cannot express are left out of it", () => {
    // A suspension is neither major nor minor. Counting it as a majmin miss
    // would score the detector against a question the metric never asked.
    const report = score([seconds(0, 1, "C:sus4"), seconds(1, 2, "C:maj")], [seconds(0, 2, "C")]);
    expect(report.scores.majmin!.comparedUs).toBe(1e6);
    expect(report.scores.majmin!.recall).toBe(1);
    expect(report.scores.root!.recall).toBe(1);
  });

  test("silence is scored, and getting it wrong costs", () => {
    const report = score([seconds(0, 2, "N"), seconds(2, 4, "C:maj")], [seconds(0, 4, "C")]);
    expect(report.scores.majmin!.recall).toBe(0.5);
  });

  test("an unreadable reference is reported rather than scored", () => {
    // The harness must never be able to make the detector look bad by failing
    // to read the annotation.
    const report = score([seconds(0, 1, "X"), seconds(1, 2, "C:maj")], [seconds(0, 2, "C")]);
    expect(report.scores.majmin!.recall).toBe(1);
    expect(report.unparsedUs).toBe(1e6);
    expect(report.unparsed).toEqual(["X"]);
    expect(report.annotatedUs).toBe(2e6);
  });

  test("an unreadable estimate is simply wrong", () => {
    const report = score([seconds(0, 2, "C:maj")], [seconds(0, 2, "??")]);
    expect(report.scores.majmin!.recall).toBe(0);
    expect(report.unparsedUs).toBe(0);
  });
});

describe("pooling a corpus", () => {
  test("tracks are weighted by their length, not one vote each", () => {
    // Otherwise a 30-second interlude counts as much as a six-minute song.
    const long = score([seconds(0, 9, "C:maj")], [seconds(0, 9, "C")]);
    const short = score([seconds(0, 1, "C:maj")], [seconds(0, 1, "F")]);
    expect(pool([long, short]).scores.majmin!.recall).toBeCloseTo(0.9, 10);
  });
});

test("percentages read like the published ones", () => {
  expect(asPercent(0.827)).toBe("82.7%");
});
