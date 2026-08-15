import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { CURRENT_BEAT_ALGORITHM, CURRENT_CHORD_ALGORITHMS } from "@atarang/contracts";
import type { OriginalRecord } from "../../storage/database";

// Every lookup answers on a later tick, which is the whole point: the bug was
// that `ensureWaveform` decided whether a pass was already running only after
// awaiting all three, so a second caller arriving in between passed the same
// check. `getBlob` finding nothing stops `analyze` before it opens a worker.
const stored: { waveform: unknown; beats: unknown; chords: unknown } = { waveform: null, beats: null, chords: null };
const later = async <T,>(value: T) => { await new Promise((resolve) => setTimeout(resolve, 0)); return value; };
mock.module("../../storage/repositories", () => ({
  getWaveform: () => later(stored.waveform),
  getBeatGrid: () => later(stored.beats),
  getChordAnalysis: () => later(stored.chords),
  getBlob: () => later(undefined),
  putWaveform: () => later(undefined),
  putBeatGrid: () => later(undefined),
  putChordAnalysis: () => later(undefined),
}));

const { ensureWaveform } = await import("./waveformAnalysis");

const original = { id: "song", blobId: "blob" } as OriginalRecord;
let leases = 0;

beforeEach(() => {
  leases = 0;
  stored.waveform = null; stored.beats = null; stored.chords = null;
  const held = new Set<string>();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks: { request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) => {
      leases++;
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name, mode: "exclusive" } as Lock); } finally { held.delete(name); }
    } } },
  });
});

afterAll(() => { Reflect.deleteProperty(globalThis, "navigator"); });

describe("ensureWaveform", () => {
  test("two callers mounting together share one pass", async () => {
    // `useWaveform` and `useBeatGrid` mount together and both call this.
    const first = ensureWaveform(original);
    const second = ensureWaveform(original);
    expect(second).toBe(first);
    // Both see the analysis failure, and neither is told the song is busy in
    // another tab for a pass this tab is running.
    await expect(first).rejects.toThrow("result_integrity_failed");
    await expect(second).rejects.toThrow("result_integrity_failed");
    expect(leases).toBe(1);
  });

  test("the slot is released once the pass ends", async () => {
    await expect(ensureWaveform(original)).rejects.toThrow("result_integrity_failed");
    // Retry has to actually retry: nothing was written, so the next call is a
    // fresh pass rather than the remembered rejection.
    await expect(ensureWaveform(original)).rejects.toThrow("result_integrity_failed");
    expect(leases).toBe(2);
  });

  test("a current analysis is returned without taking the lease", async () => {
    stored.waveform = { id: "song", algorithmVersion: "atarang-waveform/1" };
    stored.beats = { document: { algorithmVersion: CURRENT_BEAT_ALGORITHM } };
    stored.chords = { document: { algorithmVersion: CURRENT_CHORD_ALGORITHMS[0] } };
    expect(await ensureWaveform(original)).toBe(stored.waveform as never);
    expect(leases).toBe(0);
  });
});
