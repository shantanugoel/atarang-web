import{describe,expect,test}from"bun:test";
import{classifyChroma,mergeChordWindows}from"./chordDetection";

describe("chroma chord analysis",()=>{
  test("distinguishes major and minor triads",()=>{const major=new Float64Array(12),minor=new Float64Array(12);for(const note of[0,4,7])major[note]=1;for(const note of[9,0,4])minor[note]=1;expect(classifyChroma(major).chord).toBe("C");expect(classifyChroma(minor).chord).toBe("Am")});
  test("merges adjacent identical source-time windows",()=>expect(mergeChordWindows([{startFrame:0,endFrame:44100,chord:"C",confidence:.8},{startFrame:44100,endFrame:88200,chord:"C",confidence:.9}],44100)).toEqual([{startTimeUs:0,endTimeUs:2_000_000,chord:"C",confidence:.9}]))
});
