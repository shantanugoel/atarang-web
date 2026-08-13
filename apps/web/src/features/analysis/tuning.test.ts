import {describe,expect,test} from "bun:test";
import {CHORD_ALGORITHMS,CURRENT_CHORD_ALGORITHMS} from "@atarang/contracts";
import {CONCERT_PITCH,TUNING_BINS,accumulateTuning,estimateTuning,parabolicPeak,tuningReference} from "./chordDetection";

const SIZE=8192,RATE=44_100;

/** A spectrum of Hann-shaped peaks at the given frequencies. */
function spectrum(frequencies:number[],noise=0){
  const magnitudes=new Float64Array(SIZE/2+1);
  for(let bin=0;bin<magnitudes.length;bin++)magnitudes[bin]=noise;
  for(const frequency of frequencies){
    const centre=frequency*SIZE/RATE;
    for(let bin=Math.max(1,Math.floor(centre)-3);bin<=Math.min(magnitudes.length-2,Math.ceil(centre)+3);bin++){
      const distance=Math.abs(bin-centre);
      magnitudes[bin]=magnitudes[bin]!+Math.max(0,1-distance/2.5)**2;
    }
  }
  return magnitudes;
}

/** Equal-tempered pitches, at a reference the caller chooses. */
const notes=(reference:number,midi:number[])=>midi.map(note=>reference*2**((note-69)/12));

describe("parabolic peak",()=>{
  test("finds a peak that sits between two bins",()=>{
    const magnitudes=spectrum([440.0*SIZE/SIZE]);
    const centre=440*SIZE/RATE;
    const nearest=Math.round(centre);
    expect(parabolicPeak(magnitudes,nearest)).toBeCloseTo(centre,1);
  });
  test("refuses to interpolate a flat neighbourhood",()=>{
    const flat=new Float64Array(16).fill(1);
    expect(parabolicPeak(flat,8)).toBe(8);
  });
});

describe("tuning histogram",()=>{
  const measure=(frequencies:number[],noise=0)=>{
    const histogram=new Float64Array(TUNING_BINS);
    accumulateTuning(histogram,spectrum(frequencies,noise),RATE,SIZE);
    return histogram;
  };

  test("a recording at concert pitch reports no offset",()=>{
    const {cents,tonality}=estimateTuning(measure(notes(CONCERT_PITCH,[57,60,64,67,72,76])));
    expect(Math.abs(cents)).toBeLessThan(5);
    expect(tonality).toBeGreaterThan(0.9);
  });

  test("a band tuned down a quarter tone is measured, not ignored",()=>{
    const flat=CONCERT_PITCH*2**(-40/1200);
    const {cents,tonality}=estimateTuning(measure(notes(flat,[57,60,64,67,72,76])));
    expect(cents).toBeCloseTo(-40,0);
    expect(tonality).toBeGreaterThan(0.9);
    // And the reference it hands the chroma is the A the band actually played.
    expect(tuningReference(measure(notes(flat,[57,60,64,67,72,76]))).reference).toBeCloseTo(flat,0);
  });

  test("the deviation wraps rather than averaging to the far side",()=>{
    // Half the peaks 48 cents sharp, half 48 flat: two cents apart around the
    // semitone, and a linear mean would put them at zero.
    const sharp=notes(CONCERT_PITCH*2**(48/1200),[60,64,67]);
    const flat=notes(CONCERT_PITCH*2**(-48/1200),[72,76,79]);
    const {cents}=estimateTuning(measure([...sharp,...flat]));
    expect(Math.abs(cents)).toBeGreaterThan(45);
  });

  test("peaks that are not tonal partials read as untrustworthy",()=>{
    // Evenly spaced in frequency, so their cent deviations are spread around
    // the semitone rather than piled up — the shape of a distorted stem.
    const inharmonic=Array.from({length:60},(_,index)=>120+index*37.13);
    const {tonality}=estimateTuning(measure(inharmonic));
    expect(tonality).toBeLessThan(0.25);
    expect(tuningReference(measure(inharmonic)).trust).toBeLessThan(1);
    // And it does not invent a tuning from evidence it does not have.
    expect(tuningReference(measure(inharmonic)).reference).toBe(CONCERT_PITCH);
  });

  test("silence is untrusted rather than confidently zero",()=>{
    const empty=new Float64Array(TUNING_BINS);
    expect(estimateTuning(empty)).toEqual({cents:0,tonality:0});
    expect(tuningReference(empty).trust).toBe(0);
  });
});

describe("reaching a library that already exists",()=>{
  test("a document from before tuning correction is not treated as current",()=>{
    // ensureWaveform re-runs the whole pass unless the stored chord algorithm is
    // current, which is the only thing that makes this feature reach songs
    // imported before it shipped.
    expect(CURRENT_CHORD_ALGORITHMS).not.toContain("atarang-chroma/2");
    expect(CURRENT_CHORD_ALGORITHMS).not.toContain("atarang-chroma/2-stems");
  });
  test("older documents stay readable rather than being discarded",()=>{
    for(const algorithm of ["atarang-chroma/2","atarang-chroma/2-stems",...CURRENT_CHORD_ALGORITHMS])
      expect(CHORD_ALGORITHMS).toContain(algorithm as never);
  });
});
