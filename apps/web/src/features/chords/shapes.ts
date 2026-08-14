import { parseChord, simplifyChord, transposeChord } from "./chords";
import type{ChordComplexityV1,UserChordV1}from"@atarang/contracts";

// Guitar shapes, ported from the iOS ChordShapes catalogue.
//
// Frets run low E to high E. `null` is a muted string, 0 is open. A shape either
// exists in this catalogue or the answer is "nothing" — a made-up box is worse
// than no box.

export interface ChordShape {
  /** Six entries, low E first. `null` mutes the string. */
  frets: (number | null)[];
  /** Fret the barre sits at, when the shape is a moved open form. */
  barreFret?: number;
  /** Where the root sits, for the caption. */
  rootString?: string;
  userDefined?:boolean;
}

const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Whole-string aliases, not prefixes. A prefix match reads "dim7" as "dim" and
// draws a diminished triad for a diminished seventh, which is a different chord
// and a worse answer than no diagram at all.
const QUALITY_ALIASES = new Map<string, string>([
  ["", ""], ["maj", ""], ["major", ""], ["M", ""],
  ["m", "m"], ["min", "m"], ["minor", "m"], ["-", "m"],
  ["7", "7"], ["dom7", "7"],
  ["m7", "m7"], ["min7", "m7"], ["-7", "m7"],
  ["maj7", "maj7"], ["major7", "maj7"], ["M7", "maj7"], ["Δ", "maj7"],
  ["sus4", "sus4"], ["sus", "sus4"],
  ["dim", "dim"], ["o", "dim"], ["°", "dim"],
  ["5", "5"], ["no3", "5"],
  // The qualities the trained head can name that the templates never could.
  // Without these the detector prints a chord the catalogue draws nothing for,
  // which reads as the diagram being broken rather than the chord being rare.
  ["aug", "aug"], ["+", "aug"], ["#5", "aug"],
  ["6", "6"], ["maj6", "6"], ["M6", "6"],
  ["m6", "m6"], ["min6", "m6"],
  ["dim7", "dim7"], ["o7", "dim7"], ["°7", "dim7"],
  ["m7b5", "m7b5"], ["hdim7", "m7b5"], ["min7b5", "m7b5"], ["m7-5", "m7b5"], ["ø", "m7b5"], ["ø7", "m7b5"],
  // `parseChord` rewrites a leading "min", so "minmaj7" arrives here as "mmaj7".
  ["mMaj7", "mMaj7"], ["mmaj7", "mMaj7"], ["mM7", "mMaj7"], ["m(maj7)", "mMaj7"],
  ["sus2", "sus2"], ["2", "sus2"],
]);

/** Normalises a written quality to the catalogue's key, or null if unsupported. */
const qualityKey = (quality: string) => QUALITY_ALIASES.get(quality.trim().replaceAll("♯", "#").replaceAll("♭", "b")) ?? null;

/** One grip identity: enharmonic spellings and slash basses share a voicing. */
export function chordShapeKey(symbol:string){const parsed=parseChord(symbol);if(!parsed)return null;const letter=NATURAL[parsed.root[0]??""];if(letter===undefined)return null;const accidental=parsed.root[1]==="#"?1:parsed.root[1]==="b"?-1:0,quality=qualityKey(parsed.quality)??parsed.quality.trim().replaceAll("♯","#").replaceAll("♭","b").toLowerCase();return`${(letter+accidental+12)%12}:${quality}`}

const key = (root: number, quality: string) => `${root}:${quality}`;

// The open-position vocabulary. This list is also the definition of "playable
// without a barre": if it is not here, the movable forms below answer instead.
const OPEN = new Map<string, (number | null)[]>([
  [key(0, ""), [null, 3, 2, 0, 1, 0]],
  [key(2, ""), [null, null, 0, 2, 3, 2]],
  [key(4, ""), [0, 2, 2, 1, 0, 0]],
  [key(5, ""), [1, 3, 3, 2, 1, 1]],
  [key(7, ""), [3, 2, 0, 0, 0, 3]],
  [key(9, ""), [null, 0, 2, 2, 2, 0]],

  [key(2, "m"), [null, null, 0, 2, 3, 1]],
  [key(4, "m"), [0, 2, 2, 0, 0, 0]],
  [key(9, "m"), [null, 0, 2, 2, 1, 0]],

  [key(0, "7"), [null, 3, 2, 3, 1, 0]],
  [key(2, "7"), [null, null, 0, 2, 1, 2]],
  [key(4, "7"), [0, 2, 0, 1, 0, 0]],
  [key(7, "7"), [3, 2, 0, 0, 0, 1]],
  [key(9, "7"), [null, 0, 2, 0, 2, 0]],
  [key(11, "7"), [null, 2, 1, 2, 0, 2]],

  [key(2, "m7"), [null, null, 0, 2, 1, 1]],
  [key(4, "m7"), [0, 2, 2, 0, 3, 0]],
  [key(9, "m7"), [null, 0, 2, 0, 1, 0]],

  [key(0, "maj7"), [null, 3, 2, 0, 0, 0]],
  [key(2, "maj7"), [null, null, 0, 2, 2, 2]],
  [key(5, "maj7"), [null, null, 3, 2, 1, 0]],
  [key(9, "maj7"), [null, 0, 2, 1, 2, 0]],

  [key(2, "sus4"), [null, null, 0, 2, 3, 3]],
  [key(4, "sus4"), [0, 2, 2, 2, 0, 0]],
  [key(9, "sus4"), [null, 0, 2, 2, 3, 0]],

  [key(4, "5"), [0, 2, 2, null, null, null]],
  [key(9, "5"), [null, 0, 2, 2, null, null]],
  [key(2, "5"), [null, null, 0, 2, 3, null]],

  [key(2, "sus2"), [null, null, 0, 2, 3, 0]],
  [key(9, "sus2"), [null, 0, 2, 2, 0, 0]],

  // The movable forms below are offsets from a shape rooted on E or on A, so
  // the chord at the offset of zero — the E-rooted and A-rooted one — has to be
  // here or it has no shape at all. That was already true of dim, which drew
  // nothing for A dim until these were added.
  [key(4, "dim"), [0, 1, 2, 0, null, null]],
  [key(9, "dim"), [null, 0, 1, 2, 1, null]],
  [key(4, "aug"), [0, 3, 2, 1, 1, 0]],
  [key(9, "aug"), [null, 0, 3, 2, 2, 1]],
  [key(4, "6"), [0, 2, 2, 1, 2, 0]],
  [key(9, "6"), [null, 0, 2, 2, 2, 2]],
  [key(4, "m6"), [0, 2, 2, 0, 2, 0]],
  [key(9, "m6"), [null, 0, 2, 2, 1, 2]],
  [key(4, "dim7"), [0, 1, 2, 0, 2, null]],
  [key(9, "dim7"), [null, 0, 1, 2, 1, 2]],
  [key(4, "m7b5"), [0, 1, 2, 0, 3, null]],
  [key(9, "m7b5"), [null, 0, 1, 0, 1, null]],
  [key(4, "mMaj7"), [0, 2, 1, 0, 0, 0]],
  [key(9, "mMaj7"), [null, 0, 2, 1, 1, 0]],
]);

interface MovableForm { openRoot: number; frets: (number | null)[]; rootString: string }

// The E-shape and A-shape barre forms, as offsets from an open shape whose root
// sits on the sixth or fifth string.
const SIXTH_STRING: Record<string, MovableForm> = {
  "": { openRoot: 4, frets: [0, 2, 2, 1, 0, 0], rootString: "6th string" },
  m: { openRoot: 4, frets: [0, 2, 2, 0, 0, 0], rootString: "6th string" },
  "7": { openRoot: 4, frets: [0, 2, 0, 1, 0, 0], rootString: "6th string" },
  m7: { openRoot: 4, frets: [0, 2, 0, 0, 0, 0], rootString: "6th string" },
  maj7: { openRoot: 4, frets: [0, 2, 1, 1, 0, 0], rootString: "6th string" },
  sus4: { openRoot: 4, frets: [0, 2, 2, 2, 0, 0], rootString: "6th string" },
  "5": { openRoot: 4, frets: [0, 2, 2, null, null, null], rootString: "6th string" },
  dim: { openRoot: 4, frets: [0, 1, 2, 0, null, null], rootString: "6th string" },
  aug: { openRoot: 4, frets: [0, 3, 2, 1, 1, 0], rootString: "6th string" },
  "6": { openRoot: 4, frets: [0, 2, 2, 1, 2, 0], rootString: "6th string" },
  m6: { openRoot: 4, frets: [0, 2, 2, 0, 2, 0], rootString: "6th string" },
  dim7: { openRoot: 4, frets: [0, 1, 2, 0, 2, null], rootString: "6th string" },
  m7b5: { openRoot: 4, frets: [0, 1, 2, 0, 3, null], rootString: "6th string" },
  mMaj7: { openRoot: 4, frets: [0, 2, 1, 0, 0, 0], rootString: "6th string" },
  // Four frets across, so it is a stretch rather than a barre — but it is the
  // shape a guitarist actually makes for a sus2 with the root on the sixth.
  sus2: { openRoot: 4, frets: [0, 2, 4, 4, null, null], rootString: "6th string" },
};

const FIFTH_STRING: Record<string, MovableForm> = {
  "": { openRoot: 9, frets: [null, 0, 2, 2, 2, 0], rootString: "5th string" },
  m: { openRoot: 9, frets: [null, 0, 2, 2, 1, 0], rootString: "5th string" },
  "7": { openRoot: 9, frets: [null, 0, 2, 0, 2, 0], rootString: "5th string" },
  m7: { openRoot: 9, frets: [null, 0, 2, 0, 1, 0], rootString: "5th string" },
  maj7: { openRoot: 9, frets: [null, 0, 2, 1, 2, 0], rootString: "5th string" },
  sus4: { openRoot: 9, frets: [null, 0, 2, 2, 3, 0], rootString: "5th string" },
  dim: { openRoot: 9, frets: [null, 0, 1, 2, 1, null], rootString: "5th string" },
  "5": { openRoot: 9, frets: [null, 0, 2, 2, null, null], rootString: "5th string" },
  aug: { openRoot: 9, frets: [null, 0, 3, 2, 2, 1], rootString: "5th string" },
  "6": { openRoot: 9, frets: [null, 0, 2, 2, 2, 2], rootString: "5th string" },
  m6: { openRoot: 9, frets: [null, 0, 2, 2, 1, 2], rootString: "5th string" },
  dim7: { openRoot: 9, frets: [null, 0, 1, 2, 1, 2], rootString: "5th string" },
  m7b5: { openRoot: 9, frets: [null, 0, 1, 0, 1, null], rootString: "5th string" },
  mMaj7: { openRoot: 9, frets: [null, 0, 2, 1, 1, 0], rootString: "5th string" },
  sus2: { openRoot: 9, frets: [null, 0, 2, 2, 0, 0], rootString: "5th string" },
};

/** Lower is easier: open strings are free, barres and high frets are not. */
function difficulty(shape: ChordShape) {
  const fretted = shape.frets.filter((fret): fret is number => fret !== null && fret > 0);
  const highest = fretted.length ? Math.max(...fretted) : 0;
  return (shape.barreFret ? 4 : 0) + fretted.length + highest * 0.5;
}

/** Every shape this catalogue knows for a chord, easiest first. */
export function chordShapes(symbol: string): ChordShape[] {
  const parsed = parseChord(symbol);
  if (!parsed) return [];
  const letter = NATURAL[parsed.root[0] ?? ""];
  if (letter === undefined) return [];
  const accidental = parsed.root[1] === "#" ? 1 : parsed.root[1] === "b" ? -1 : 0;
  const root = (letter + accidental + 12) % 12;
  const quality = qualityKey(parsed.quality);
  if (quality === null) return [];

  const result: ChordShape[] = [];
  // The bass note is not part of the shape: a slash chord is the same grip with
  // a different note under it, and a separate box per inversion would bury the
  // shape the hand actually makes.
  const open = OPEN.get(key(root, quality));
  if (open) result.push({ frets: open });

  for (const forms of [SIXTH_STRING, FIFTH_STRING]) {
    const form = forms[quality];
    if (!form) continue;
    const offset = (root - form.openRoot + 12) % 12;
    // Zero is the open shape, already above. A barre at the twelfth fret is
    // nobody's answer, and the other form will be lower.
    if (offset <= 0 || offset > 11) continue;
    result.push({ frets: form.frets.map((fret) => (fret === null ? null : fret + offset)), barreFret: offset, rootString: form.rootString });
  }
  return result.sort((left, right) => difficulty(left) - difficulty(right));
}

/**
 * Whether the chord has a grip in open position.
 *
 * "In the catalogue" is not enough on its own: the catalogue's F is the
 * first-fret full barre, which is the exact chord a beginner cannot play. An
 * open string is what actually makes a shape open, so that is the test.
 */
export const isOpenShape = (symbol: string) => chordShapes(symbol).some((shape) => !shape.barreFret && shape.frets.includes(0));

/**
 * The chord as the chosen level would have it played.
 *
 * Transpose and capo are applied to the symbol *before* this runs, because
 * `beginner` asks whether a grip is open and the only grip that matters is the
 * one the hand actually makes.
 */
export function reduceChord(symbol: string, complexity: ChordComplexityV1): string {
  if (complexity === "full") return symbol;
  const parsed = parseChord(symbol);
  if (!parsed) return symbol;
  if (complexity === "power") return `${parsed.root}5`;
  const triad = simplifyChord(symbol);
  if (complexity === "simple") return triad;
  // The substitutions a teacher makes, in the order a teacher makes them: keep
  // the chord if it is already open, otherwise the triad under it, otherwise
  // the plain major or minor — a diminished chord becomes the minor inside it,
  // a sus the major it resolves to. When none of them is open the triad stands:
  // telling someone their song needs an F beats printing an E and letting them
  // wonder why it sounds wrong.
  //
  // No power-chord step, because it could never fire. The only open fifths are
  // E5, A5 and D5, and all three of those roots already have an open major and
  // an open minor, so the step before this one has always answered by then.
  const bass = parsed.bass ? `/${parsed.bass}` : "",
    quality = simplifyChord(`${parsed.root}${parsed.quality}`).slice(parsed.root.length),
    nearest = `${parsed.root}${quality === "m" || quality === "dim" ? "m" : ""}${bass}`;
  return [symbol, triad, nearest].find(isOpenShape) ?? triad;
}

/** Everything the chord toolbar applies on top of a stored symbol. */
export interface ChordDisplay { transposeSemitones: number; complexity: ChordComplexityV1; capo: number }

/**
 * A stored chord symbol as the toolbar's settings would print it.
 *
 * A capo shortens every string, so the grip that sounds a chord is the one
 * named a capo's worth of semitones *below* it: at capo 2 the hand plays G and
 * the room hears A. Charts print the grip, because the grip is the instruction.
 *
 * One function because the order is not free: transposing after reducing would
 * have `beginner` hunting for open shapes in a key the player is not in — and
 * finding open shapes is most of the reason to fit a capo in the first place.
 */
export const displayChord = (symbol: string, { transposeSemitones, complexity, capo }: ChordDisplay) => reduceChord(transposeChord(symbol, transposeSemitones - capo), complexity);

/** The shape to show, or undefined when the catalogue has nothing honest. */
export function bestChordShape(symbol:string,userChords:readonly UserChordV1[]=[]){const identity=chordShapeKey(symbol),saved=identity?userChords.find(chord=>chordShapeKey(chord.symbol)===identity):undefined;return saved?{frets:[...saved.frets],...(saved.barreFret===undefined?{}:{barreFret:saved.barreFret}),userDefined:true}:chordShapes(symbol)[0]}
