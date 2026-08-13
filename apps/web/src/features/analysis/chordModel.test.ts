import {describe,expect,test} from "bun:test";
import {harmonicTrust,type LearnedFrame} from "./chordModel";

const frame=(activations:number[]):LearnedFrame=>({harmonic:Float64Array.from(activations),bass:new Float64Array(12),energy:1});
const held=(activations:number[])=>Array.from({length:40},()=>frame(activations));

describe("is this harmony at all",()=>{
  // Without this the decoder printed "A major, 99% confidence" over twelve
  // seconds of white noise, because the model's output is a probability per
  // pitch class and something always wins.
  test("a triad is trusted and a flat activation is not",()=>{
    const triad=[.95,.03,.02,.02,.9,.04,.02,.92,.03,.02,.02,.03];
    expect(harmonicTrust(held(triad))).toBe(1);
    // What noise looks like: everything middling, nothing standing out.
    expect(harmonicTrust(held([.42,.39,.44,.4,.41,.38,.43,.4,.39,.42,.4,.41]))).toBe(0);
    expect(harmonicTrust(held(Array(12).fill(0)))).toBe(0);
  });

  test("a seventh is still a chord",()=>{
    // Four pitch classes that all belong: the third strongest is still high.
    expect(harmonicTrust(held([.9,.02,.03,.88,.02,.03,.02,.86,.02,.84,.03,.02]))).toBe(1);
  });

  test("trust falls between the two rather than snapping",()=>{
    // Third strongest .7 against fifth strongest .3 — half convinced.
    const middling=harmonicTrust(held([.8,.3,.28,.75,.29,.3,.28,.7,.29,.5,.28,.3]));
    expect(middling).toBeGreaterThan(0);
    expect(middling).toBeLessThan(1);
  });
});
