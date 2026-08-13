import {describe,expect,test} from "bun:test";
import type {WaveformRecord} from "../../storage/database";
import {displayPeaks,formatTime,stepZoom,timeTicks} from "./waveformView";

const level=(framesPerBucket:number,count:number,shape:(index:number)=>number)=>({framesPerBucket,min:Float32Array.from({length:count},(_,index)=>-shape(index)),max:Float32Array.from({length:count},(_,index)=>shape(index)),rms:new Float32Array(count)});
// A four-level pyramid over a song that is silent apart from one spike a tenth
// of the way in — the spike is only resolvable on the finest level.
const spikeAt=(count:number)=>(index:number)=>index===Math.floor(count*.1)?1:.01;
const waveform={levels:[level(256,4096,spikeAt(4096)),level(1024,1024,spikeAt(1024)),level(4096,256,spikeAt(256)),level(16384,64,spikeAt(64))]} as unknown as WaveformRecord;

describe("waveform pyramid",()=>{
  test("reads a finer level as the target resolution rises",()=>{
    expect(displayPeaks(waveform,128).length).toBe(128);
    expect(displayPeaks(waveform,4096).length).toBe(4096);
  });
  test("zoomed in, the spike stops being smeared across neighbours",()=>{
    const zoomed=displayPeaks(waveform,4096),spike=zoomed.indexOf(Math.max(...zoomed));
    expect(zoomed[spike]).toBeCloseTo(49,0);
    expect(zoomed[spike+1]).toBeLessThan(5);
    expect(spike/zoomed.length).toBeCloseTo(.1,2);
  });
  test("never asks for more peaks than the finest level holds",()=>{
    expect(displayPeaks(waveform,99_999).length).toBe(4096);
  });
  test("falls back to a placeholder of the requested length",()=>{
    expect(displayPeaks(null,64).length).toBe(64);
    expect(displayPeaks(undefined,256).length).toBe(256);
  });
});

describe("ruler",()=>{
  test("keeps roughly five marks on screen at every zoom",()=>{
    for(const zoom of [1,2,4,8,16,32,64]){
      const {step,ticks}=timeTicks(240_000_000,zoom);
      expect(ticks.length/zoom).toBeGreaterThan(2);
      expect(ticks.length/zoom).toBeLessThan(11);
      expect(ticks.at(-1)).toBeLessThanOrEqual(240);
      expect(step).toBeGreaterThan(0);
    }
  });
  test("marks land on round times",()=>{
    expect(timeTicks(240_000_000,1).ticks).toEqual([0,60,120,180,240]);
  });
});

describe("clock",()=>{
  test("carries a rounded-up second into the minute",()=>{
    expect(formatTime(59_700_000)).toBe("01:00");
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(-5)).toBe("00:00");
    expect(formatTime(125_000_000)).toBe("02:05");
  });
  test("shows tenths when asked, without losing the pad",()=>{
    expect(formatTime(9_250_000,1)).toBe("00:09.3");
    expect(formatTime(72_040_000,1)).toBe("01:12.0");
  });
});

describe("zoom steps",()=>{
  test("clamps at both ends",()=>{
    expect(stepZoom(1,-1)).toBe(1);
    expect(stepZoom(64,1)).toBe(64);
    expect(stepZoom(8,1)).toBe(16);
    expect(stepZoom(8,-1)).toBe(4);
  });
});
