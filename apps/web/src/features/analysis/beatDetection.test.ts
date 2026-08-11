import {describe,expect,test} from "bun:test";
import {detectBeatGrid} from "./beatDetection";
describe("spectral-flux beat grid",()=>{test("recovers a stable pulse train",()=>{const flux=Array.from({length:220},(_,index)=>index%22===3?10:0),grid=detectBeatGrid(flux,44_100,1024,44_100*6);expect(grid.bpm).toBeCloseTo(117.45,1);expect(grid.reliable).toBe(true);expect(grid.beatsFrames[0]).toBe(3*1024)});test("does not mark flat audio reliable",()=>{const grid=detectBeatGrid(Array(100).fill(0),48_000,1024,48_000);expect(grid.reliable).toBe(false);expect(grid.reliability).toBe(0)})});
