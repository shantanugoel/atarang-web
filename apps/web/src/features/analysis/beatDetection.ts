export interface DetectedBeatGrid {bpm:number;reliability:number;reliable:boolean;beatsFrames:number[];downbeatPhase:0|1|2|3}

/**
 * Which of every four beats starts the bar.
 *
 * Bars are where the arrangement pushes hardest: the kick lands, the chord
 * changes, the section turns. Summing onset novelty over each of the four
 * candidate phases and taking the strongest is the cheapest form of that
 * argument, and it is the difference between a real downbeat and calling every
 * fourth beat from the start of the file a downbeat.
 *
 * ponytail: assumes 4/4, which the beat grid contract already does. A meter
 * detector would need the contract to carry a time signature first.
 */
function downbeatPhase(novelty:readonly number[],beatsFrames:readonly number[],hopFrames:number):0|1|2|3{
  let best:0|1|2|3=0,bestScore=-1;
  for(const candidate of [0,1,2,3] as const){
    let score=0;
    for(let index=candidate;index<beatsFrames.length;index+=4)score+=novelty[Math.round(beatsFrames[index]!/hopFrames)]??0;
    if(score>bestScore){bestScore=score;best=candidate}
  }
  return best;
}
export function detectBeatGrid(flux:readonly number[],sampleRate:number,hopFrames:number,durationFrames:number):DetectedBeatGrid{
  const framesPerSecond=sampleRate/hopFrames,minLag=Math.max(2,Math.round(framesPerSecond*60/200)),maxLag=Math.min(flux.length-2,Math.round(framesPerSecond*60/60));
  if(flux.length<maxLag+4||maxLag<=minLag)return{bpm:120,reliability:0,reliable:false,beatsFrames:[],downbeatPhase:0};
  const sorted=[...flux].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]??0,novelty=flux.map(value=>Math.max(0,value-median));
  const scores:{lag:number;score:number}[]=[];for(let lag=minLag;lag<=maxLag;lag++){let score=0,count=0;for(let index=lag;index<novelty.length;index++){score+=novelty[index]!*novelty[index-lag]!;count++}scores.push({lag,score:count?score/count:0})}
  let best=scores[0]!;for(const candidate of scores)if(candidate.score>best.score)best=candidate;const mean=scores.reduce((sum,item)=>sum+item.score,0)/scores.length,reliability=best.score<=0?0:Math.max(0,Math.min(1,(best.score/(mean+1e-12)-1)/5));
  let phase=0,phaseScore=-1;for(let candidate=0;candidate<best.lag;candidate++){let score=0;for(let index=candidate;index<novelty.length;index+=best.lag)score+=novelty[index]!;if(score>phaseScore){phaseScore=score;phase=candidate}}
  const beatsFrames:number[]=[];for(let frame=phase*hopFrames;frame<durationFrames;frame+=best.lag*hopFrames)beatsFrames.push(frame);return{bpm:60*sampleRate/(hopFrames*best.lag),reliability,reliable:reliability>=.35&&phaseScore>0,beatsFrames,downbeatPhase:downbeatPhase(novelty,beatsFrames,hopFrames)};
}
