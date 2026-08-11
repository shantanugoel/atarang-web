export interface DetectedBeatGrid {bpm:number;reliability:number;reliable:boolean;beatsFrames:number[]}
export function detectBeatGrid(flux:readonly number[],sampleRate:number,hopFrames:number,durationFrames:number):DetectedBeatGrid{
  const framesPerSecond=sampleRate/hopFrames,minLag=Math.max(2,Math.round(framesPerSecond*60/200)),maxLag=Math.min(flux.length-2,Math.round(framesPerSecond*60/60));
  if(flux.length<maxLag+4||maxLag<=minLag)return{bpm:120,reliability:0,reliable:false,beatsFrames:[]};
  const sorted=[...flux].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]??0,novelty=flux.map(value=>Math.max(0,value-median));
  const scores:{lag:number;score:number}[]=[];for(let lag=minLag;lag<=maxLag;lag++){let score=0,count=0;for(let index=lag;index<novelty.length;index++){score+=novelty[index]!*novelty[index-lag]!;count++}scores.push({lag,score:count?score/count:0})}
  let best=scores[0]!;for(const candidate of scores)if(candidate.score>best.score)best=candidate;const mean=scores.reduce((sum,item)=>sum+item.score,0)/scores.length,reliability=best.score<=0?0:Math.max(0,Math.min(1,(best.score/(mean+1e-12)-1)/5));
  let phase=0,phaseScore=-1;for(let candidate=0;candidate<best.lag;candidate++){let score=0;for(let index=candidate;index<novelty.length;index+=best.lag)score+=novelty[index]!;if(score>phaseScore){phaseScore=score;phase=candidate}}
  const beatsFrames:number[]=[];for(let frame=phase*hopFrames;frame<durationFrames;frame+=best.lag*hopFrames)beatsFrames.push(frame);return{bpm:60*sampleRate/(hopFrames*best.lag),reliability,reliable:reliability>=.35&&phaseScore>0,beatsFrames};
}
