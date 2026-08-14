/**
 * Scoring detected chords against annotated ground truth.
 *
 * This exists so that "the chords got better" is a number rather than an
 * impression. Every published figure the project has leaned on — CREMA's,
 * BTC's, Chordino's — is a weighted chord symbol recall against a reference
 * annotation, and until now the app had no way to compute one for itself.
 *
 * The metrics follow mir_eval's definitions closely enough to be read next to
 * published numbers, and deliberately are not bit-identical to it: the
 * vocabulary restriction and the duration weighting are reproduced, the
 * exhaustive Harte grammar is not. Anything the parser cannot read is counted
 * and reported rather than scored as wrong, so a gap in the parser can never
 * quietly look like a gap in the detector.
 */

export interface Interval { startUs: number; endUs: number; chord: string }

/** A chord as its root and the intervals above it, which is all any metric needs. */
export interface Chord { root: number; intervals: number[] }
/** Explicitly "no chord is sounding", which is a label to get right, not a gap. */
export const NO_CHORD = "none" as const;
/** Nothing the parser recognises. Excluded from scoring and counted separately. */
export type ParsedChord = Chord | typeof NO_CHORD | null;

const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Harte shorthand, plus the symbols this app's own detector prints.
 *
 * The two notations overlap but disagree on the common cases — Harte writes a
 * minor triad `A:min` and the detector writes `Am` — so one table serves both
 * and the parser tries the separator before falling back to the suffix.
 */
const QUALITIES: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], "7": [0, 4, 7, 10],
  dim7: [0, 3, 6, 9], hdim7: [0, 3, 6, 10], minmaj7: [0, 3, 7, 11],
  maj6: [0, 4, 7, 9], min6: [0, 3, 7, 9],
  "9": [0, 4, 7, 10, 2], maj9: [0, 4, 7, 11, 2], min9: [0, 3, 7, 10, 2],
  "11": [0, 4, 7, 10, 2, 5], min11: [0, 3, 7, 10, 2, 5], "13": [0, 4, 7, 10, 2, 9],
  sus2: [0, 2, 7], sus4: [0, 5, 7],
};
// What the detector prints where Harte writes something else.
const ALIASES: Record<string, string> = { "": "maj", m: "min", m7: "min7", M: "maj", "6": "maj6", m6: "min6", "+": "aug", "°": "dim", sus: "sus4" };

/**
 * One chord symbol in either notation.
 *
 * Harte's inversions (`C:maj/5`) and alterations (`C:maj(*3)`) are read as far
 * as the underlying chord and no further: every metric below compares roots and
 * interval sets, and none of them is defined over the bass note.
 */
export function parseChord(symbol: string): ParsedChord {
  const text = symbol.trim();
  if (!text || text === "N" || text === "X") return text === "N" ? NO_CHORD : null;
  const match = text.match(/^([A-G])([#b]*)(?::([^/(]*))?([^/]*)?(?:\/.*)?$/);
  if (!match) return null;
  const accidentals = [...(match[2] ?? "")].reduce((sum, sign) => sum + (sign === "#" ? 1 : -1), 0);
  const root = ((NATURAL[match[1]!]! + accidentals) % 12 + 12) % 12;
  // `C:maj` puts the quality after the colon, `Cm` puts it straight after the
  // root, and a bare `C` has none at all.
  const written = (match[3] ?? match[4] ?? "").trim();
  const quality = QUALITIES[written] ?? QUALITIES[ALIASES[written] ?? ""];
  return quality ? { root, intervals: quality } : null;
}

/** Tab- or space-separated `start end label`, which is what a .lab file is. */
export function parseLab(text: string): Interval[] {
  const intervals: Interval[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/[\s,]+/);
    if (fields.length < 3) continue;
    const start = Number(fields[0]), end = Number(fields[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    intervals.push({ startUs: Math.round(start * 1e6), endUs: Math.round(end * 1e6), chord: fields.slice(2).join(" ") });
  }
  return intervals;
}

/**
 * The two annotations on one shared set of boundaries.
 *
 * Only the reference's span is scored: an estimate that runs past the end of the
 * annotation is not evidence of anything, and time the annotation covers but the
 * estimate does not is a wrong answer rather than an absent one, so it is filled
 * with "no chord" instead of being dropped.
 */
export function align(reference: readonly Interval[], estimate: readonly Interval[]) {
  if (!reference.length) return [];
  const from = reference[0]!.startUs, to = reference.at(-1)!.endUs;
  const edges = [...new Set([
    ...reference.flatMap((interval) => [interval.startUs, interval.endUs]),
    ...estimate.flatMap((interval) => [interval.startUs, interval.endUs]),
  ])].filter((edge) => edge >= from && edge <= to).sort((left, right) => left - right);

  const at = (intervals: readonly Interval[], time: number) => intervals.find((interval) => interval.startUs <= time && time < interval.endUs)?.chord ?? "N";
  return edges.slice(0, -1).map((start, index) => ({
    start, end: edges[index + 1]!,
    reference: at(reference, start),
    estimate: at(estimate, start),
  })).filter((span) => span.end > span.start);
}

/**
 * The metrics, each as the reduction it applies before comparing.
 *
 * `null` from a reduction means "outside this metric's vocabulary": mir_eval
 * scores each metric only over the reference chords it can express, so a
 * seventh chord is not counted against a major/minor score in either direction.
 * Without that, every metric would collapse into the same number.
 */
const third = (chord: Chord) => chord.intervals.find((interval) => interval === 3 || interval === 4);
const seventh = (chord: Chord) => chord.intervals.find((interval) => interval === 10 || interval === 11);
type Reduction = (chord: Chord) => string | null;
export const METRICS: Record<string, Reduction> = {
  root: (chord) => `${chord.root}`,
  majmin: (chord) => {
    const quality = third(chord);
    // Only triads and their sevenths reduce to major or minor; a suspension or
    // an augmented chord is neither, and mir_eval leaves it out.
    if (!quality || chord.intervals.includes(6) || chord.intervals.includes(8)) return null;
    return `${chord.root}:${quality === 3 ? "min" : "maj"}`;
  },
  thirds: (chord) => (third(chord) === undefined ? null : `${chord.root}:${third(chord)}`),
  sevenths: (chord) => {
    const quality = third(chord);
    if (!quality || chord.intervals.includes(6) || chord.intervals.includes(8)) return null;
    return `${chord.root}:${quality}:${seventh(chord) ?? "none"}`;
  },
};

export interface Score { correctUs: number; comparedUs: number; recall: number }
export interface Report { scores: Record<string, Score>; annotatedUs: number; unparsedUs: number; unparsed: string[] }

/**
 * Weighted chord symbol recall: the share of annotated time labelled correctly.
 *
 * Weighted by duration rather than by segment because a song is mostly a few
 * long chords, and counting segments would let a detector win by getting the
 * passing ones right.
 */
export function score(reference: readonly Interval[], estimate: readonly Interval[]): Report {
  const spans = align(reference, estimate);
  const scores = Object.fromEntries(Object.keys(METRICS).map((name) => [name, { correctUs: 0, comparedUs: 0, recall: 0 }])) as Record<string, Score>;
  const unparsed = new Set<string>();
  let annotatedUs = 0, unparsedUs = 0;

  for (const span of spans) {
    const duration = span.end - span.start;
    annotatedUs += duration;
    const referenceChord = parseChord(span.reference);
    if (referenceChord === null) { unparsedUs += duration; unparsed.add(span.reference); continue; }
    const estimateChord = parseChord(span.estimate);
    // An estimate the parser cannot read is the detector's problem, not the
    // harness's, so it is scored as wrong rather than skipped.
    for (const [name, reduce] of Object.entries(METRICS)) {
      const wanted = referenceChord === NO_CHORD ? NO_CHORD : reduce(referenceChord);
      if (wanted === null) continue;
      const got = estimateChord === NO_CHORD ? NO_CHORD : estimateChord === null ? null : reduce(estimateChord);
      scores[name]!.comparedUs += duration;
      if (got === wanted) scores[name]!.correctUs += duration;
    }
  }
  for (const value of Object.values(scores)) value.recall = value.comparedUs ? value.correctUs / value.comparedUs : 0;
  return { scores, annotatedUs, unparsedUs, unparsed: [...unparsed] };
}

/** Every track's spans pooled, which is what a corpus-level WCSR is. */
export function pool(reports: readonly Report[]): Report {
  const scores = Object.fromEntries(Object.keys(METRICS).map((name) => [name, { correctUs: 0, comparedUs: 0, recall: 0 }])) as Record<string, Score>;
  const unparsed = new Set<string>();
  let annotatedUs = 0, unparsedUs = 0;
  for (const report of reports) {
    annotatedUs += report.annotatedUs;
    unparsedUs += report.unparsedUs;
    for (const symbol of report.unparsed) unparsed.add(symbol);
    for (const [name, value] of Object.entries(report.scores)) {
      scores[name]!.correctUs += value.correctUs;
      scores[name]!.comparedUs += value.comparedUs;
    }
  }
  for (const value of Object.values(scores)) value.recall = value.comparedUs ? value.correctUs / value.comparedUs : 0;
  return { scores, annotatedUs, unparsedUs, unparsed: [...unparsed] };
}

export const asPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
