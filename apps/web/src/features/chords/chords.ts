import type { ChartLineV1,ChartSegmentV1,ChordSegmentV1,LyricLineV1,UserChartV1 } from "@atarang/contracts";

const SHARPS=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const,FLATS=["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] as const,NATURAL:Record<string,number>={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export interface ParsedChord {root:string;quality:string;bass?:string;raw:string}

export function parseChord(value:string):ParsedChord|null{const raw=value.trim().replaceAll("♯","#").replaceAll("♭","b"),match=raw.match(/^([A-Ga-g])([#b]?)([^/]*?)(?:\/([A-Ga-g])([#b]?))?$/);if(!match)return null;const note=(letter:string,accidental:string)=>letter.toUpperCase()+accidental;let quality=match[3]!.trim().replace(/^min/i,"m").replace(/^major/i,"maj").replace(/^minor/i,"m");const result:ParsedChord={root:note(match[1]!,match[2]!),quality,raw};if(match[4])result.bass=note(match[4],match[5]!);return result}
function noteIndex(note:string){const parsed=note.match(/^([A-G])([#b]?)$/);if(!parsed)return null;return(NATURAL[parsed[1]!]!+(parsed[2]==="#"?1:parsed[2]==="b"?-1:0)+12)%12}
function transposeNote(note:string,semitones:number,preferFlats:boolean){const index=noteIndex(note);return index===null?note:(preferFlats?FLATS:SHARPS)[(index+semitones+120)%12]!}
export function simplifyChord(value:string){const chord=parseChord(value);if(!chord)return value;let quality=chord.quality;if(/^maj/i.test(quality))quality="";else if(/^m(?!aj)/i.test(quality))quality="m";else if(/^dim/i.test(quality))quality="dim";else if(/^aug|^\+/i.test(quality))quality="aug";else if(/^sus2/i.test(quality))quality="sus2";else if(/^sus/i.test(quality))quality="sus4";else quality="";return `${chord.root}${quality}${chord.bass?`/${chord.bass}`:""}`}
export function transposeChord(value:string,semitones:number){const chord=parseChord(value);if(!chord)return value;const preferFlats=chord.root.includes("b")||chord.bass?.includes("b")===true;return`${transposeNote(chord.root,semitones,preferFlats)}${chord.quality}${chord.bass?`/${transposeNote(chord.bass,semitones,preferFlats)}`:""}`}

/**
 * The next chord the hand actually has to move for, or nothing at the last one.
 *
 * Detection splits a held chord across every beat it sounds through, so the
 * segment after `from` is usually the same chord again. Announcing that as
 * "next" tells a player to prepare for a change that never comes, which is why
 * the search runs to the first *different* symbol.
 */
export function nextChordChange<T extends{chord:string}>(segments:readonly T[],from:number):T|undefined{const current=segments[from];return current&&segments.slice(from+1).find(segment=>segment.chord!==current.chord)}

export function parseChordLine(line:string):ChartSegmentV1[]{const segments:ChartSegmentV1[]=[];let cursor=0,chord:string|undefined;for(const match of line.matchAll(/\[([^\]]+)]/g)){const text=line.slice(cursor,match.index);if(text||chord!==undefined){const segment:ChartSegmentV1={text};if(chord!==undefined)segment.chord=chord;segments.push(segment)}chord=match[1]!.trim();cursor=match.index!+match[0].length}const tail=line.slice(cursor);if(tail||chord!==undefined){const segment:ChartSegmentV1={text:tail};if(chord!==undefined)segment.chord=chord;segments.push(segment)}return segments.length?segments:[{text:line}]}
/**
 * Every chord that sounds during one lyric line, over the words it lands on.
 *
 * A line looked up one chord at its own start time before this, so a harmony
 * that moved mid-line was simply not shown — the timeline rail printed the
 * change and the lyric under it kept the chord from the word before.
 *
 * Placement is proportional: a word's onset is estimated from how far into the
 * line's characters it starts, since a plain LRC times lines and not words.
 * Enhanced LRC word timings replace that guess whenever the line carries them.
 *
 * ponytail: characters are a stand-in for syllables, and a line's span runs to
 * the next line rather than to its last sung word, so a chord can land a word
 * early where an instrumental gap follows. Word timings are the honest fix and
 * already win when present.
 */
export function alignChords(line:LyricLineV1,segments:readonly ChordSegmentV1[],offsetUs=0):ChartSegmentV1[]{
  const inline=parseChordLine(line.text);
  // A line that carries its own chords, or no time to look one up with, is
  // already as aligned as it is ever going to get.
  if(inline.some(item=>item.chord)||line.startTimeUs===undefined||line.endTimeUs===undefined)return inline;
  const start=line.startTimeUs+offsetUs,end=line.endTimeUs+offsetUs;
  // "N" is detection saying it heard no chord, which is not a symbol to play.
  // Repeats are the same chord held across several beats: one printed change.
  // The overlap floor is what keeps the chord *ending* on the line's first word
  // out of it — a written lyric timestamp and a detected boundary land a few
  // milliseconds apart on the same beat, and that is not a chord to play.
  const audible=Math.min(200_000,(end-start)/2),
    heard=segments.filter(item=>item.chord!=="N"&&Math.min(item.endTimeUs,end)-Math.max(item.startTimeUs,start)>=audible),
    changes=heard.filter((item,index)=>item.chord!==heard[index-1]?.chord),
    words=line.text.match(/\S+\s*/g)??[];
  // Nothing to hang a symbol on, so only a chord that actually starts in the
  // gap earns a line — a held one is already printed above the words before it.
  if(!words.length)return changes.filter(item=>item.startTimeUs>=start).map(item=>({text:"",chord:item.chord}));
  const timed=line.words.length===words.length?line.words:undefined,total=line.text.length||1;
  let consumed=0;
  const onsets=words.map((word,index)=>{const at=timed?timed[index]!.startTimeUs+offsetUs:start+(end-start)*(consumed/total);consumed+=word.length;return at}),
    placed=new Map<number,string[]>();
  for(const change of changes){
    let index=0;
    while(index+1<onsets.length&&onsets[index+1]!<=change.startTimeUs)index++;
    placed.set(index,[...placed.get(index)??[],change.chord]);
  }
  // Two changes over one word is the harmony moving faster than the words do.
  // The extras follow the word rather than one of them silently winning.
  return words.flatMap((text,index)=>{
    const [first,...rest]=placed.get(index)??[];
    return [{text,...(first?{chord:first}:{})},...rest.map(chord=>({text:"",chord}))];
  });
}

export function parseChordPro(text:string,originalId:string,chartId:string,fallbackTitle="Untitled chart",now=new Date().toISOString()):UserChartV1{let title=fallbackTitle,artist="",declaredKey:string|undefined,section:string|undefined;const lines:ChartLineV1[]=[];for(const raw of text.replaceAll("\r","").split("\n")){const directive=raw.match(/^\{([^:}]+)(?::\s*([^}]*))?}$/);if(directive){const key=directive[1]!.toLowerCase().replaceAll("_"," "),value=directive[2]?.trim()??"";if(key==="title"||key==="t")title=value;if(key==="artist"||key==="subtitle"||key==="st")artist=value;if(key==="key")declaredKey=value;if(key==="start of chorus"||key==="soc")section=value||"Chorus";if(key==="start of verse"||key==="sov")section=value||"Verse";if(key==="comment"||key==="c")section=value;continue}if(!raw.trim())continue;const line:ChartLineV1={id:`${chartId}:line:${lines.length}`,segments:parseChordLine(raw)};if(section){line.section=section;section=undefined}lines.push(line)}const chart:UserChartV1={schema:"atarang.chart/1",chartId,originalId,revision:0,title,artist,transposeSemitones:0,capo:0,complexity:"full",lines,updatedAt:now};if(declaredKey)chart.declaredKey=declaredKey;return chart}
/**
 * Problems worth stopping an import for, in the user's words, with line numbers.
 *
 * Deliberately narrow. `parseChordPro` treats anything it does not recognise as
 * lyrics, which is the right default for a format with dozens of directives no
 * one implements — but it means a typo like `{title:` silently becomes a lyric
 * line reading "{title:", and the user is never told. Only the two shapes that
 * can *only* be mistakes are rejected: a brace or a bracket that never closes.
 * Unknown directives and unparseable chord symbols stay legal, because charts
 * in the wild are full of both and refusing them would be the worse failure.
 *
 * "Never closes" means literally that — no `}` on the line at all. Testing the
 * directive shape instead would reject `{whispered} come back`, a lyric with a
 * brace annotation, and there is no way past a rejection.
 */
export function chordProIssues(text:string):string[]{
  const issues:string[]=[],lines=text.replaceAll("\r","").split("\n");
  const clip=(line:string)=>line.length>32?`${line.slice(0,32)}…`:line;
  lines.forEach((raw,index)=>{
    const line=raw.trim();
    if(!line)return;
    if(line.startsWith("{")&&!line.includes("}"))issues.push(`Line ${index+1}: “${clip(line)}” opens a directive that is never closed. Write it as {title: Song}.`);
    if(/\[[^\]]*$/.test(raw))issues.push(`Line ${index+1}: a chord bracket is never closed. Write it as [Am].`);
  });
  // The parser's own rule for what counts as a directive, so "no content" here
  // means exactly the lines it would drop rather than anything brace-shaped.
  if(!lines.some(raw=>raw.trim()&&!/^\{[^:}]+(?::\s*[^}]*)?}$/.test(raw)))issues.push("There are no lyric or chord lines here, only directives.");
  return issues.slice(0,5);
}

export function exportChordPro(chart:UserChartV1){const output=[`{title: ${chart.title}}`];if(chart.artist)output.push(`{artist: ${chart.artist}}`);if(chart.declaredKey)output.push(`{key: ${chart.declaredKey}}`);for(const line of chart.lines){if(line.section)output.push(`{comment: ${line.section}}`);output.push(line.segments.map(segment=>`${segment.chord?`[${segment.chord}]`:""}${segment.text}`).join(""))}return`${output.join("\n")}\n`}
