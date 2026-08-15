import {describe,expect,test} from "bun:test";
import type {LyricLineV1} from "@atarang/contracts";
import {alignChords,chordProIssues,exportChordPro,nextChordChange,parseChord,parseChordLine,parseChordPro,simplifyChord,transposeChord} from "./chords";
const id="019fec0d-0000-7000-8000-000000000001";
test("inline lyric chords sit above the words that follow them",()=>expect(parseChordLine("Walk the [Bm]boulevard [G]tonight")).toEqual([{text:"Walk the "},{text:"boulevard ",chord:"Bm"},{text:"tonight",chord:"G"}]));
describe("chord grammar",()=>{test("parses rich qualities and slash bass",()=>expect(parseChord("B♭maj7/D")).toEqual({root:"Bb",quality:"maj7",bass:"D",raw:"Bbmaj7/D"}));test("transposes roots and slash bass consistently",()=>expect(transposeChord("Bbmaj7/D",2)).toBe("Cmaj7/E"));test("simplifies while preserving minor and bass",()=>expect(simplifyChord("F#m9/C#")).toBe("F#m/C#"))});
describe("next chord change",()=>{
  const held=[{chord:"G"},{chord:"G"},{chord:"G"},{chord:"D"},{chord:"D"},{chord:"G"}];
  test("skips a chord held across several segments",()=>expect(nextChordChange(held,0)).toEqual({chord:"D"}));
  test("has nothing after the last chord",()=>expect(nextChordChange(held,5)).toBeUndefined());
  test("has nothing when there is no chord at that position",()=>expect(nextChordChange(held,-1)).toBeUndefined());
});
describe("ChordPro",()=>{test("round trips directives, sections, chords, and lyrics",()=>{const input="{title: Night}\n{artist: The Band}\n{start_of_chorus}\n[Am]We own the [F]dark";const chart=parseChordPro(input,id,id);expect(chart.lines[0]!.section).toBe("Chorus");expect(chart.lines[0]!.segments[1]!.chord).toBe("F");const restored=parseChordPro(exportChordPro(chart),id,id);expect(restored.title).toBe("Night");expect(restored.lines[0]!.segments).toEqual(chart.lines[0]!.segments)})});
describe("ChordPro validation",()=>{
  // The reported case: this used to become a chart whose only lyric was "{title:".
  test("rejects a directive that never closes, naming the line",()=>{const issues=chordProIssues("{title:");expect(issues.length).toBeGreaterThan(0);expect(issues[0]).toContain("Line 1")});
  test("rejects a chord bracket that never closes",()=>expect(chordProIssues("[Am]Real line\n[F lost").join(" ")).toContain("Line 2"));
  test("rejects directives with no chart under them",()=>expect(chordProIssues("{title: Night}\n{artist: The Band}").join(" ")).toContain("no lyric or chord lines"));
  test("accepts what the parser already round trips, including unknown directives and odd chords",()=>expect(chordProIssues("{title: Night}\n{x_custom_thing}\n{start_of_chorus}\n[Am]We own the [N.C.]dark")).toEqual([]));
  // A rejection has no override, so anything closed is legal even where the
  // parser will read it as lyrics rather than as the directive it resembles.
  test("accepts a closed brace that is not a directive",()=>expect(chordProIssues("{title: Night}\n{whispered} come back to me")).toEqual([]));
  test("accepts its own export of a title containing braces",()=>expect(chordProIssues(exportChordPro(parseChordPro("{title: Night {live}}\n[Am]dark",id,id)))).toEqual([]));
  test("caps the list so a wrong-format paste does not bury the editor",()=>expect(chordProIssues(Array.from({length:20},()=>"{oops").join("\n")).length).toBe(5));
});

describe("detected chords over a lyric line",()=>{
  // Real detection and real LRC for "Have You Ever Seen The Rain": the reported
  // case, where every line printed the one chord ringing at its first word.
  const detected=[{startTimeUs:0,endTimeUs:11_520_000,chord:"N",confidence:1},{startTimeUs:11_520_000,endTimeUs:16_170_667,chord:"C",confidence:1},{startTimeUs:16_170_667,endTimeUs:18_773_333,chord:"Am",confidence:1},{startTimeUs:18_773_333,endTimeUs:20_821_333,chord:"F",confidence:1},{startTimeUs:20_821_333,endTimeUs:22_912_000,chord:"C",confidence:1},{startTimeUs:22_912_000,endTimeUs:24_981_333,chord:"G",confidence:1},{startTimeUs:24_981_333,endTimeUs:37_397_333,chord:"C",confidence:1}];
  const line=(text:string,startTimeUs:number,endTimeUs:number):LyricLineV1=>({id:`${id}:lrc:0`,text,startTimeUs,endTimeUs,source:"lrc",confidence:1,words:[]});
  const laid=(text:string,start:number,end:number)=>alignChords(line(text,start,end),detected).map(part=>`${part.chord?`[${part.chord}]`:""}${part.text}`).join("");

  test("prints the chords that change mid-line, over the words they land on",()=>
    expect(laid("Someone told me long ago",13_480_000,17_430_000)).toBe("[C]Someone told me [Am]long ago"));
  test("prints every change in a line, not just the first",()=>
    expect(laid("I know, it's been comin' for some time",20_820_000,29_940_000)).toBe("[C]I know, [G]it's [C]been comin' for some time"));
  test("holds the chord already ringing over the words before the change",()=>
    expect(laid("There's a calm before the storm",17_430_000,20_820_000)).toBe("[Am]There's a [F]calm before the storm"));
  // The line begins on the beat F ends on: LRC and detection put that boundary
  // a millisecond apart, and printing F there sends the hand to a chord that is
  // over before the word is sung.
  test("drops a chord that only grazes the start of the line",()=>
    expect(alignChords(line("I know, it's been comin' for some time",20_820_000,29_940_000),detected)[0]!.chord).toBe("C"));
  test("leaves a wordless line to the changes that start inside it",()=>{
    expect(alignChords(line("",44_170_000,46_970_000),detected)).toEqual([]);
    expect(alignChords(line("",10_000_000,17_000_000),detected)).toEqual([{text:"",chord:"C"},{text:"",chord:"Am"}]);
  });
  test("keeps inline chart chords over the words the writer put them on",()=>
    expect(alignChords(line("Walk the [Bm]boulevard",13_480_000,17_430_000),detected)).toEqual([{text:"Walk the "},{text:"boulevard",chord:"Bm"}]));
  test("uses enhanced word timings when the line carries them",()=>
    expect(alignChords({...line("Someone told me long ago",13_480_000,17_430_000),words:[{text:"Someone ",startTimeUs:13_480_000,endTimeUs:16_100_000},{text:"told ",startTimeUs:16_100_000,endTimeUs:16_400_000},{text:"me ",startTimeUs:16_400_000,endTimeUs:16_700_000},{text:"long ",startTimeUs:16_700_000,endTimeUs:17_000_000},{text:"ago",startTimeUs:17_000_000,endTimeUs:17_430_000}]},detected).map(part=>part.chord??"")).toEqual(["C","Am","","",""]));
  // A shifted document has to land on the same words as the unshifted one.
  test("reads the lyrics offset before matching against the audio",()=>
    expect(alignChords(line("Someone told me long ago",11_480_000,15_430_000),detected,2_000_000).map(part=>part.chord??"")).toEqual(alignChords(line("Someone told me long ago",13_480_000,17_430_000),detected).map(part=>part.chord??"")));
});
