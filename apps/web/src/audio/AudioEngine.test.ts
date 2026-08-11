import { describe, expect, test } from "bun:test";
import { AudioEngine } from "./AudioEngine";

describe("AudioEngine", () => {
  test("keeps authoritative source time as integer microseconds", () => {
    const engine = new AudioEngine();
    engine.seek(1_234_567.8);
    expect(engine.getSnapshot()).toEqual({ playing: false, sourceTimeUs: 1_234_568, generation: 1 });
  });
  test("notifies low-rate subscribers", () => {
    const engine = new AudioEngine(); let calls = 0;
    const unsubscribe = engine.subscribe(() => calls++);
    engine.play(); unsubscribe(); engine.pause();
    expect(calls).toBe(1);
  });
});
