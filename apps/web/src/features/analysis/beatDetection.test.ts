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

describe("tempo drift and metrical ambiguity",()=>{
  const hop=1024,rate=44_100;
  // A player speeding up: the gap between beats shrinks from 22 frames to about
  // 18 over the take. One autocorrelation lag describes the average of that and
  // is wrong at both ends.
  const pulses:number[]=[];
  for(let position=5,interval=22;position<2_400;position+=interval,interval-=.04)pulses.push(Math.round(position));
  const drifting=Array.from({length:2_400},(_,index)=>pulses.includes(index)?10:0);

  test("follows a take that speeds up instead of averaging it away",()=>{
    const grid=detectBeatGrid(drifting,rate,hop,2_400*hop);
    const frames=grid.beatsFrames.map(frame=>frame/hop);
    const onPulse=frames.filter(frame=>pulses.some(pulse=>Math.abs(pulse-frame)<=1));
    expect(grid.reliable).toBe(true);
    expect(frames.length).toBeGreaterThan(pulses.length*.9);
    expect(onPulse.length).toBeGreaterThan(frames.length*.9);
    // The grid itself has to get shorter, which a single global lag cannot do.
    const first=frames[1]!-frames[0]!,last=frames.at(-1)!-frames.at(-2)!;
    expect(first-last).toBeGreaterThanOrEqual(3);
  });

  // An even train correlates just as well at every multiple of its spacing, so
  // nothing in the signal chooses between 323 BPM and 81. The prior does, and
  // it has to land somewhere a person could count.
  test("reads a very fast pulse train at a tempo somebody could play",()=>{
    const flux=Array.from({length:1_200},(_,index)=>index%8===4?10:0);
    const grid=detectBeatGrid(flux,rate,hop,1_200*hop);
    expect(grid.bpm).toBeGreaterThan(60);
    expect(grid.bpm).toBeLessThan(200);
    // Whatever level it picks, the beats still land on the audio.
    expect(grid.beatsFrames.every(frame=>frame/hop%8===4)).toBe(true);
  });

  // A backbeat is genuinely two readings of the same bar — quarters at 161 or
  // eighths at 81 — and the loud pulses are the ones a player counts.
  test("counts the loud pulses when every second one is softer",()=>{
    const flux=Array.from({length:1_200},(_,index)=>index%16===4?(index%32===4?10:6):0);
    const grid=detectBeatGrid(flux,rate,hop,1_200*hop);
    expect(grid.bpm).toBeCloseTo(80.7,0);
    expect(grid.beatsFrames.every(frame=>frame/hop%32===4)).toBe(true);
  });

  // The tracker lays beats on the strongest peak in every window, so "the beats
  // land on onsets" is true even for noise. Reliability has to answer a
  // different question — is there a pulse at all — or it means nothing.
  test("does not call unpulsed audio a beat grid",()=>{
    let seed=7;const random=()=>(seed=seed*1103515245%2147483647)/2147483647;
    for(const flux of [Array.from({length:2_400},()=>random()),Array.from({length:2_400},()=>random()**4*8)]){
      const grid=detectBeatGrid(flux,rate,hop,2_400*hop);
      expect(grid.reliable).toBe(false);
      expect(grid.reliability).toBeLessThan(.25);
    }
  });
});
