# Measuring chord accuracy

`bun run test:e2e:chords` scores the detector against annotated recordings and
prints a weighted chord symbol recall, which is the metric every published
figure this project has compared itself to uses.

```bash
ATARANG_EVAL_CORPUS=~/chords bun run --cwd apps/web test:e2e:chords
```

## The corpus

A directory, searched recursively, of audio files each beside a `.lab` file of
the same name:

```
~/chords/let-it-be.mp3
~/chords/let-it-be.lab
```

A `.lab` file is `start end label` per line, seconds and Harte notation — the
format the Isophonics and Billboard annotation sets are published in:

```
0.000000 2.612267 N
2.612267 5.185306 C:maj
5.185306 7.792880 A:min7
```

None of that ships here. The annotations are licensed for research and the
recordings they describe cannot be redistributed at all, so the corpus is
something you assemble locally and the harness skips itself when
`ATARANG_EVAL_CORPUS` is unset.

To check the harness without one:

```bash
bun tests/eval/makeSyntheticCorpus.ts /tmp/corpus
ATARANG_EVAL_CORPUS=/tmp/corpus bun run test:e2e:chords
```

Synthetic triads have none of what makes a recording hard. That corpus is a
floor and a plumbing check, not evidence.

## What the numbers mean

Four recalls, each over the share of annotated time it can express — a
suspension is neither major nor minor, so it is left out of `majmin` rather than
counted as a miss, the same way `mir_eval` does it:

| | compares |
|---|---|
| `root` | the root, and nothing else |
| `majmin` | root and major-or-minor, over triads and their sevenths |
| `thirds` | root and third |
| `sevenths` | root, third and seventh |

Weighted by duration, not by segment: a song is mostly a few long chords, and
counting segments would let a detector win by getting the passing ones right.

Anything the parser cannot read is reported as unread time rather than scored,
so a gap in the harness can never look like a gap in the detector.

`ATARANG_EVAL_OUT=before.json` writes the per-track scores *and the detected
segments*, which is what you read when a track scores badly. Run it before and
after a change to the detector; the two files are the claim.

## The pipeline it measures

The real one. Each track is imported through the app's own file input, decoded
by mediabunny, analysed in the worker with the model, and the result is read
back out of IndexedDB — so what is scored is what a user would have seen.

This measures the mixture path. Chords decoded from separated stems need the
126 MB separation model staged (`bun models/web/download.ts`) and a separation
run per track, which is a different and much slower exercise.
