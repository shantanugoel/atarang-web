import {describe,expect,test} from "bun:test";
import {detectBeatGrid} from "./beatDetection";
describe("spectral-flux beat grid",()=>{test("recovers a stable pulse train",()=>{const flux=Array.from({length:220},(_,index)=>index%22===3?10:0),grid=detectBeatGrid(flux,44_100,1024,44_100*6);expect(grid.bpm).toBeCloseTo(117.45,1);expect(grid.reliable).toBe(true);expect(grid.beatsFrames[0]).toBe(3*1024)});test("does not mark flat audio reliable",()=>{const grid=detectBeatGrid(Array(100).fill(0),48_000,1024,48_000);expect(grid.reliable).toBe(false);expect(grid.reliability).toBe(0)})});

describe("downbeat phase", () => {
  const hop = 1024, rate = 44_100, spacing = 22;
  // A pulse train at ~117 BPM where every fourth beat is twice as loud. The bar
  // starts on the third beat of the file, which is what phase 2 means.
  const bar = (index: number) => ((index - 3) / spacing) % 4;
  const flux = Array.from({ length: 600 }, (_, index) => (index % spacing === 3 ? (bar(index) === 2 ? 10 : 5) : 0));

  test("finds the loud beat of the bar rather than assuming beat one", () => {
    const grid = detectBeatGrid(flux, rate, hop, 600 * hop);
    expect(grid.beatsFrames.length).toBeGreaterThan(8);
    expect(grid.downbeatPhase).toBe(2);
  });

  test("reports a phase even when nothing stands out", () => {
    const flat = detectBeatGrid(Array.from({ length: 600 }, (_, index) => (index % spacing === 3 ? 5 : 0)), rate, hop, 600 * hop);
    expect([0, 1, 2, 3]).toContain(flat.downbeatPhase);
  });
});
