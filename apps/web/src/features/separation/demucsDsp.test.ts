import { describe, expect, test } from "bun:test";
import {
  DEMUCS_MODEL_STEMS,
  DEMUCS_SEGMENT_FRAMES,
  DEMUCS_SPEC_BINS,
  DEMUCS_SPEC_FRAMES,
  DEMUCS_STRIDE_FRAMES,
  RollingStemOverlapAdd,
  classifyDemucsQualification,
  combineDemucsBranches,
  prepareDemucsInput,
} from "./demucsDsp";

describe("bounded browser Demucs DSP", () => {
  test("prepares the model's exact waveform and complex-STFT shapes", () => {
    const left = new Float32Array(DEMUCS_SEGMENT_FRAMES);
    const right = new Float32Array(DEMUCS_SEGMENT_FRAMES);
    left[100] = 1;
    right[200] = -1;
    const prepared = prepareDemucsInput(left, right);
    expect(prepared.mix.length).toBe(2 * DEMUCS_SEGMENT_FRAMES);
    expect(prepared.mag.length).toBe(4 * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES);
    expect(prepared.mag.every(Number.isFinite)).toBe(true);
  });

  // The DSP buffers are reused across segments so a song does not allocate its
  // way past the iOS process limit. Reuse is only safe while a segment cannot
  // read anything the previous one left behind, which is what these two check:
  // the same input has to give the same answer with another segment in between.
  test("a repeated segment prepares identically after another one ran", () => {
    const segment = (seed: number) => {
      const left = new Float32Array(DEMUCS_SEGMENT_FRAMES);
      const right = new Float32Array(DEMUCS_SEGMENT_FRAMES);
      for (let frame = 0; frame < DEMUCS_SEGMENT_FRAMES; frame += 97) {
        left[frame] = Math.sin(frame * seed);
        right[frame] = Math.cos(frame * seed);
      }
      return { left, right };
    };
    const first = segment(0.001);
    const second = segment(0.031);
    const baseline = prepareDemucsInput(first.left, first.right);
    const mag = baseline.mag.slice();
    const mix = baseline.mix.slice();
    prepareDemucsInput(second.left, second.right);
    const repeat = prepareDemucsInput(first.left, first.right);
    expect(repeat.mag).toEqual(mag);
    expect(repeat.mix).toEqual(mix);
  });

  test("a repeated segment combines identically after another one ran", () => {
    const freqLength = 4 * 4 * DEMUCS_SPEC_BINS * DEMUCS_SPEC_FRAMES;
    const timeLength = 4 * 2 * DEMUCS_SEGMENT_FRAMES;
    const branches = (seed: number) => {
      const freq = new Float32Array(freqLength);
      const time = new Float32Array(timeLength);
      for (let index = 0; index < freqLength; index += 101) freq[index] = Math.sin(index * seed);
      for (let index = 0; index < timeLength; index += 89) time[index] = Math.cos(index * seed);
      return { freq, time };
    };
    const first = branches(0.002);
    const second = branches(0.017);
    const baseline = combineDemucsBranches(first.freq, first.time).map((stem) => ({ left: stem.left.slice(), right: stem.right.slice() }));
    combineDemucsBranches(second.freq, second.time);
    const repeat = combineDemucsBranches(first.freq, first.time);
    for (let stem = 0; stem < 4; stem++) {
      expect(repeat[stem]!.left).toEqual(baseline[stem]!.left);
      expect(repeat[stem]!.right).toEqual(baseline[stem]!.right);
      expect(baseline[stem]!.left.some((value) => value !== 0)).toBe(true);
    }
  });

  test("overlap-add is exact and memory stays independent of song length", () => {
    const totalFrames = DEMUCS_STRIDE_FRAMES * 3 + 10_000;
    const overlap = new RollingStemOverlapAdd();
    const emitted: Float32Array[][] = [];
    for (let start = 0; start < totalFrames; start += DEMUCS_STRIDE_FRAMES) {
      const length = Math.min(DEMUCS_SEGMENT_FRAMES, totalFrames - start);
      const stems = DEMUCS_MODEL_STEMS.map((_, stem) => ({
        left: new Float32Array(DEMUCS_SEGMENT_FRAMES).fill(stem + 1),
        right: new Float32Array(DEMUCS_SEGMENT_FRAMES).fill(-(stem + 1)),
      }));
      const chunk = overlap.add(start, stems, length, totalFrames);
      if (chunk) emitted.push(chunk);
    }
    emitted.push(overlap.finish(totalFrames));
    expect(overlap.allocatedSampleSlots).toBe(DEMUCS_SEGMENT_FRAMES * 9);
    for (let stem = 0; stem < 4; stem++) {
      let samples = 0;
      let maximumError = 0;
      for (const group of emitted) {
        const chunk = group[stem]!;
        samples += chunk.length;
        for (let index = 0; index < chunk.length; index++) {
          const expected = index % 2 ? -(stem + 1) : stem + 1;
          maximumError = Math.max(maximumError, Math.abs(chunk[index]! - expected));
        }
      }
      expect(samples).toBe(totalFrames * 2);
      expect(maximumError).toBeLessThan(1e-5);
    }
  });

  test("qualification routing enforces correctness and exact RTF boundaries", () => {
    const valid = { finite: true, emittedFrames: 1_323_000, expectedFrames: 1_323_000, energyRatio: 1, mixtureCorrelation: 0.9 };
    expect(classifyDemucsQualification({ ...valid, rtf: 1.5 })).toEqual({ correctnessPassed: true, status: "qualified", reason: "qualified" });
    expect(classifyDemucsQualification({ ...valid, rtf: 1.500_001 })).toEqual({ correctnessPassed: true, status: "slow", reason: "qualified_slow" });
    expect(classifyDemucsQualification({ ...valid, rtf: 4.000_001 })).toEqual({ correctnessPassed: true, status: "unavailable", reason: "rtf_too_slow" });
    expect(classifyDemucsQualification({ ...valid, mixtureCorrelation: 0.799_999, rtf: 1 })).toEqual({ correctnessPassed: false, status: "unavailable", reason: "correctness_failed" });
    expect(classifyDemucsQualification({ ...valid, energyRatio: 4.000_001, rtf: 1 })).toEqual({ correctnessPassed: false, status: "unavailable", reason: "correctness_failed" });
    expect(classifyDemucsQualification({ ...valid, emittedFrames: valid.expectedFrames - 1, rtf: 1 })).toEqual({ correctnessPassed: false, status: "unavailable", reason: "correctness_failed" });
  });

  test("a CPU run is judged slow, not unavailable, up to its own ceiling", () => {
    const valid = { finite: true, emittedFrames: 1_323_000, expectedFrames: 1_323_000, energyRatio: 1, mixtureCorrelation: 0.9 };
    // 2.44 is what this machine measured on the WASM execution provider.
    expect(classifyDemucsQualification({ ...valid, rtf: 2.44, backend: "wasm" }).status).toBe("slow");
    expect(classifyDemucsQualification({ ...valid, rtf: 2.44, backend: "webgpu" }).status).toBe("slow");
    expect(classifyDemucsQualification({ ...valid, rtf: 8, backend: "wasm" }).status).toBe("slow");
    expect(classifyDemucsQualification({ ...valid, rtf: 8, backend: "webgpu" }).status).toBe("unavailable");
    expect(classifyDemucsQualification({ ...valid, rtf: 12.000_001, backend: "wasm" }).status).toBe("unavailable");
    // Correctness still binds on either backend.
    expect(classifyDemucsQualification({ ...valid, mixtureCorrelation: 0.5, rtf: 3, backend: "wasm" }).correctnessPassed).toBe(false);
  });
});
