/**
 * Writes the synthetic progression out as a corpus the eval harness can read.
 *
 *   bun tests/eval/makeSyntheticCorpus.ts /tmp/corpus
 *   ATARANG_EVAL_CORPUS=/tmp/corpus bun run test:e2e:chords
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syntheticProgression } from "./synthetic";

const directory = process.argv[2];
if (!directory) { console.error("usage: bun tests/eval/makeSyntheticCorpus.ts <directory>"); process.exit(1); }
mkdirSync(directory, { recursive: true });

const { mixture, lab, durationFrames, sampleRate } = syntheticProgression();
writeFileSync(join(directory, "synthetic-progression.wav"), mixture);
writeFileSync(join(directory, "synthetic-progression.lab"), lab);
console.log(`wrote a ${Math.round(durationFrames / sampleRate)}s corpus to ${directory}`);
