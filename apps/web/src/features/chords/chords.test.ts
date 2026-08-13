import {describe,expect,test} from "bun:test";
import {chordProIssues,exportChordPro,parseChord,parseChordLine,parseChordPro,simplifyChord,transposeChord} from "./chords";
const id="019fec0d-0000-7000-8000-000000000001";
test("inline lyric chords sit above the words that follow them",()=>expect(parseChordLine("Walk the [Bm]boulevard [G]tonight")).toEqual([{text:"Walk the "},{text:"boulevard ",chord:"Bm"},{text:"tonight",chord:"G"}]));
describe("chord grammar",()=>{test("parses rich qualities and slash bass",()=>expect(parseChord("B♭maj7/D")).toEqual({root:"Bb",quality:"maj7",bass:"D",raw:"Bbmaj7/D"}));test("transposes roots and slash bass consistently",()=>expect(transposeChord("Bbmaj7/D",2)).toBe("Cmaj7/E"));test("simplifies while preserving minor and bass",()=>expect(simplifyChord("F#m9/C#")).toBe("F#m/C#"))});
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
