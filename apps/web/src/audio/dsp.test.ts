import {describe,expect,test} from "bun:test";
import {pitchCorrectionSemitones} from "./dsp";

describe("independent time and pitch mapping",()=>{
  test("compensates the pitch introduced by variable-rate source reads",()=>{expect(pitchCorrectionSemitones(.5,0)).toBeCloseTo(12,8);expect(pitchCorrectionSemitones(.8,2)).toBeCloseTo(5.863137,5)});
});
