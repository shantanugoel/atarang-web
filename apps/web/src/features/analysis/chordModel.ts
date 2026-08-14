import * as ort from "onnxruntime-web/webgpu";
import { chordModelUrl, chordVocabulary } from "../../generated/chord-model";
import { ortMjsUrl, ortWasmUrl } from "../../generated/ort-assets";
import { CQT_BINS, CQT_HARMONICS, amplitudeToDb } from "./cqt";

/**
 * Chords read by a model instead of matched against templates.
 *
 * Template matching assumes the spectral peaks are tonal partials, which on a
 * distorted guitar they are not — the audit measured a tuning histogram whose
 * strongest bin held 1.5% of peak energy, so there was nothing to match and the
 * decoded roots wandered. This model was trained on annotated recordings to
 * name pitch classes and chords directly.
 *
 * Three heads come out of it. `chord_pitch` is twelve pitch-class activations,
 * which the key estimate reads and which say whether this is harmony at all.
 * `chord_bass` is twelve plus "no bass", which is the only witness to whether a
 * chord or its relative minor is playing. `chord_tag` is a softmax over the
 * model's own 170-chord vocabulary — the thing the paper is about, and what the
 * decoder now names chords from instead of seven hand-built templates.
 *
 * Provenance, license, the vocabulary's class order and the conversion are all
 * in `models/chords/README.md`.
 */

/** One frame per 4096 samples at 44.1 kHz, which is the hop the model was trained at. */
export const LEARNED_HOP_DIVISOR = 2;

let session: Promise<ort.InferenceSession> | null = null;

function open() {
  // Small enough that threads cost more than they save, and the CPU path is the
  // one every browser has.
  ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.origin).href, mjs: new URL(ortMjsUrl, self.location.origin).href };
  ort.env.wasm.numThreads = 1;
  session ??= ort.InferenceSession.create(new URL(chordModelUrl, self.location.origin).href, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return session;
}

export interface LearnedFrame { harmonic: Float64Array; bass: Float64Array; tag: Float64Array; energy: number }

/**
 * How much this looks like harmony at all, from the model's own activations.
 *
 * A chord is a few pitch classes standing out and the rest staying down, so the
 * gap between the third and fifth strongest is high for a triad and for a
 * seventh alike, and low for anything that is not a chord. Measured: the demo
 * track 0.76, a synthesised seventh 0.78, white noise 0.14, silence 0.13, a
 * sine sweep 0.02.
 *
 * This is what keeps the app honest now that the tuning histogram no longer
 * speaks for the front end. Without it the decoder printed "A major, 99%" over
 * twelve seconds of noise, which is the failure the tuning work set out to end.
 */
const NOT_HARMONY = 0.25, CLEARLY_HARMONY = 0.6;
export function harmonicTrust(frames: readonly LearnedFrame[]) {
  let total = 0;
  for (const frame of frames) {
    const ranked = [...frame.harmonic].sort((left, right) => right - left);
    total += (ranked[2] ?? 0) - (ranked[4] ?? 0);
  }
  const spread = frames.length ? total / frames.length : 0;
  return Math.max(0, Math.min(1, (spread - NOT_HARMONY) / (CLEARLY_HARMONY - NOT_HARMONY)));
}

/**
 * Runs the model over a whole song's constant-Q frames.
 *
 * Returns `null` when the model cannot run at all, which is the signal to keep
 * the template chroma: a browser that cannot load it should still get chords.
 *
 * ponytail: the analysis result waits for this — measured at +0.3 s for a
 * 46-second track, so about two seconds on a long one. If that becomes the
 * complaint, post the waveform and the beats first and upgrade the chords
 * afterwards, the way the stem re-decode already announces itself.
 */
export async function learnedChroma(cqt: Float32Array[], energies: readonly number[]): Promise<{ frames: LearnedFrame[]; trust: number } | null> {
  if (cqt.length < 2) return null;
  try {
    const runtime = await open();
    amplitudeToDb(cqt);
    const input = new Float32Array(cqt.length * CQT_BINS * CQT_HARMONICS.length);
    for (let frame = 0; frame < cqt.length; frame++) input.set(cqt[frame]!, frame * CQT_BINS * CQT_HARMONICS.length);
    const outputs = await runtime.run({ [runtime.inputNames[0]!]: new ort.Tensor("float32", input, [1, cqt.length, CQT_BINS, CQT_HARMONICS.length]) });
    const pitch = outputs["chord_pitch"]?.data as Float32Array | undefined;
    const bass = outputs["chord_bass"]?.data as Float32Array | undefined;
    const tag = outputs["chord_tag"]?.data as Float32Array | undefined;
    if (!pitch || !bass || !tag) return null;
    const tags = chordVocabulary.length;
    const frames = Array.from({ length: cqt.length }, (_, frame) => ({
      harmonic: Float64Array.from({ length: 12 }, (_, pitchClass) => pitch[frame * 12 + pitchClass] ?? 0),
      // The thirteenth bass class is "no bass in this frame", which the decoder
      // expresses as an empty bass profile rather than a class of its own.
      bass: Float64Array.from({ length: 12 }, (_, pitchClass) => bass[frame * 13 + pitchClass] ?? 0),
      // A softmax over the whole vocabulary, in the order the checkpoint's own
      // encoder put them — see `chordVocabulary`.
      tag: Float64Array.from({ length: tags }, (_, state) => tag[frame * tags + state] ?? 0),
      energy: energies[frame] ?? 0,
    }));
    return { frames, trust: harmonicTrust(frames) };
  } catch {
    return null;
  }
}
