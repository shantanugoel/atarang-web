import { parseChord } from "./chords";

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
]);

/** Normalises a written quality to the catalogue's key, or null if unsupported. */
const qualityKey = (quality: string) => QUALITY_ALIASES.get(quality.trim().replaceAll("♯", "#").replaceAll("♭", "b")) ?? null;

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

/** The shape to show, or undefined when the catalogue has nothing honest. */
export const bestChordShape = (symbol: string) => chordShapes(symbol)[0];
