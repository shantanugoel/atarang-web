import {describe,expect,test} from "bun:test";
import type {BeatGridV1} from "@atarang/contracts";
import {snapToBeat,tapTempoBpm} from "./tempo";

describe("loop snapping",()=>{
  // 120 BPM: a beat every half second.
  const grid=(reliable:boolean)=>({reliable,beats:Array.from({length:64},(_,index)=>({timeUs:index*500_000,beatInBar:(index%4+1) as 1|2|3|4,downbeat:index%4===0}))}) as BeatGridV1;
  test("pulls a boundary onto the nearest beat",()=>{
    expect(snapToBeat(2_140_000,grid(true))).toBe(2_000_000);
    expect(snapToBeat(2_400_000,grid(true))).toBe(2_500_000);
    expect(snapToBeat(0,grid(true))).toBe(0);
  });
  test("leaves the boundary alone past the last beat",()=>{
    expect(snapToBeat(60_000_000,grid(true))).toBe(31_500_000);
  });
  test("does not snap to a grid the detector does not trust",()=>{
    expect(snapToBeat(2_140_000,grid(false))).toBe(2_140_000);
    expect(snapToBeat(2_140_000,null)).toBe(2_140_000);
    expect(snapToBeat(2_140_000,undefined)).toBe(2_140_000);
  });
  test("Alt places a boundary between beats",()=>{
    expect(snapToBeat(2_140_000,grid(true),true)).toBe(2_140_000);
  });
});


const at=(...gaps:number[])=>gaps.reduce<number[]>((times,gap)=>[...times,times.at(-1)!+gap],[1000]);

describe("tap tempo",()=>{
  test("says nothing until three taps have landed",()=>{
    expect(tapTempoBpm([])).toBeNull();
    expect(tapTempoBpm([1000])).toBeNull();
    expect(tapTempoBpm(at(500))).toBeNull();
    expect(tapTempoBpm(at(500,500))).toBe(120);
  });
  test("reads an even tap series as its tempo",()=>{
    expect(tapTempoBpm(at(500,500,500,500))).toBe(120);
    expect(tapTempoBpm(at(400,400,400,400))).toBe(150);
    expect(tapTempoBpm(at(1000,1000,1000))).toBe(60);
  });
  // The mean would follow the late tap; the median keeps the tempo the player
  // actually tapped, which is the whole reason this exists.
  test("one late tap does not drag the tempo",()=>{
    expect(tapTempoBpm(at(500,500,800,500,500))).toBe(120);
  });
  test("a pause between gaps is dropped rather than read as a slow tempo",()=>{
    expect(tapTempoBpm(at(500,9000,500,500))).toBe(120);
  });
  test("does not mutate the caller's taps",()=>{
    const taps=at(600,400,500);
    tapTempoBpm(taps);
    expect(taps).toEqual(at(600,400,500));
  });
});
