import type { LyricLineV1,LyricsDocumentV1,LyricWordV1 } from "@atarang/contracts";

const LINE_TIME=/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;
const WORD_TIME=/<(\d{1,3}):(\d{2}(?:\.\d{1,3})?)>/g;
const timeUs=(minutes:string,seconds:string)=>Math.max(0,Math.round((Number(minutes)*60+Number(seconds))*1_000_000));
const timestamp=(value:number)=>{const total=Math.max(0,Math.round(value/10_000));const minutes=Math.floor(total/6000),seconds=Math.floor(total%6000/100),centiseconds=total%100;return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${String(centiseconds).padStart(2,"0")}`};

function parseWords(content:string,lineEndUs:number):{text:string;words:LyricWordV1[]}{
  const matches=[...content.matchAll(WORD_TIME)];if(!matches.length)return{text:content,words:[]};
  const words:LyricWordV1[]=[];
  for(let index=0;index<matches.length;index++){const match=matches[index]!,next=matches[index+1],start=timeUs(match[1]!,match[2]!),text=content.slice(match.index!+match[0].length,next?.index??content.length);words.push({text,startTimeUs:start,endTimeUs:next?timeUs(next[1]!,next[2]!):Math.max(start,lineEndUs)})}
  return{text:words.map(word=>word.text).join(""),words};
}

export function parseLrc(text:string,originalId:string,now=new Date().toISOString()):LyricsDocumentV1{
  const lines:LyricLineV1[]=[],offsetMatch=text.match(/^\[offset:([+-]?\d+)\]$/im),offsetUs=(offsetMatch?Number(offsetMatch[1]):0)*1000;
  for(const raw of text.replaceAll("\r","").split("\n")){
    const timestamps=[...raw.matchAll(LINE_TIME)];if(!timestamps.length)continue;
    const content=raw.slice(Math.max(...timestamps.map(match=>match.index!+match[0].length)));
    const base=timeUs(timestamps[0]![1]!,timestamps[0]![2]!),parsed=parseWords(content,base+5_000_000);
    for(const match of timestamps){const start=timeUs(match[1]!,match[2]!),shift=start-base;lines.push({id:`${originalId}:lrc:${lines.length}`,text:parsed.text,startTimeUs:start,source:"lrc",confidence:1,words:parsed.words.map(word=>({...word,startTimeUs:word.startTimeUs+shift,endTimeUs:word.endTimeUs+shift}))})}
  }
  lines.sort((a,b)=>(a.startTimeUs??0)-(b.startTimeUs??0));
  for(let index=0;index<lines.length;index++){const line=lines[index]!,end=lines[index+1]?.startTimeUs??(line.startTimeUs!+5_000_000);line.endTimeUs=end;line.words=line.words.filter(word=>word.startTimeUs>=line.startTimeUs!&&word.startTimeUs<end).map(word=>({...word,endTimeUs:Math.min(word.endTimeUs,end)}))}
  return{schema:"atarang.lyrics/1",originalId,revision:0,offsetUs,lines,updatedAt:now};
}

export function exportLrc(document:LyricsDocumentV1){const output=[`[offset:${Math.round(document.offsetUs/1000)}]`];for(const line of document.lines){if(line.startTimeUs===undefined)continue;const content=line.words.length?line.words.map(word=>`<${timestamp(word.startTimeUs)}>${word.text}`).join(""):line.text;output.push(`[${timestamp(line.startTimeUs)}]${content}`)}return `${output.join("\n")}\n`}
export function activeLyricLine(document:LyricsDocumentV1,timeUsValue:number){const adjusted=timeUsValue-document.offsetUs;let active=-1;for(let index=0;index<document.lines.length;index++){const line=document.lines[index]!;if(line.startTimeUs!==undefined&&line.startTimeUs<=adjusted&&(line.endTimeUs===undefined||adjusted<line.endTimeUs))active=index}return active}

export function lyricLoopRange(lines:LyricLineV1[],from:number,to:number,offsetUs:number,durationUs:number):[number,number]|null{
  const first=Math.min(from,to),last=Math.max(from,to),start=lines[first]?.startTimeUs;
  if(start===undefined)return null;
  const end=lines[last]?.endTimeUs??lines.slice(last+1).find(line=>line.startTimeUs!==undefined)?.startTimeUs;
  if(end===undefined)return null;
  return [Math.max(0,start+offsetUs),Math.min(durationUs,end+offsetUs)];
}
