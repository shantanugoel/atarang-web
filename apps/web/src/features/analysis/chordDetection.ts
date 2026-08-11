const NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;
const MAJOR=[0,4,7] as const,MINOR=[0,3,7] as const;

export interface ChromaClassification{chord:string;confidence:number}

export function classifyChroma(values:ArrayLike<number>):ChromaClassification{
  const total=Array.from({length:12},(_,index)=>Math.max(0,values[index]??0)).reduce((sum,value)=>sum+value,0);
  if(total<=1e-9)return{chord:"N",confidence:0};
  let best={chord:"N",score:0},second=0;
  for(let root=0;root<12;root++)for(const [quality,intervals]of [["",MAJOR],["m",MINOR]] as const){const chordEnergy=intervals.reduce<number>((sum,interval)=>sum+Math.max(0,values[(root+interval)%12]??0),0),score=chordEnergy/total;if(score>best.score){second=best.score;best={chord:`${NAMES[root]}${quality}`,score}}else second=Math.max(second,score)}
  const confidence=Math.max(0,Math.min(1,(best.score-second)*2));
  return best.score<.3?{chord:"N",confidence:0}:{chord:best.chord,confidence};
}

export function mergeChordWindows(windows:{startFrame:number;endFrame:number;chord:string;confidence:number}[],sampleRate:number){const result:{startTimeUs:number;endTimeUs:number;chord:string;confidence:number}[]=[];for(const value of windows){const segment={startTimeUs:Math.round(value.startFrame/sampleRate*1_000_000),endTimeUs:Math.round(value.endFrame/sampleRate*1_000_000),chord:value.chord,confidence:value.confidence},previous=result.at(-1);if(previous?.chord===segment.chord&&previous.endTimeUs===segment.startTimeUs){previous.endTimeUs=segment.endTimeUs;previous.confidence=Math.max(previous.confidence,segment.confidence)}else result.push(segment)}return result}
