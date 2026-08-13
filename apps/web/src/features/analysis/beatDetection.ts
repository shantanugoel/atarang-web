export interface DetectedBeatGrid {bpm:number;reliability:number;reliable:boolean;beatsFrames:number[];downbeatPhase:0|1|2|3}

const TEMPO_MIN_BPM=60,TEMPO_MAX_BPM=200,PRIOR_CENTRE_BPM=120;
/** Width of the tempo prior in octaves. Wide enough to reach 60 and 200, narrow enough to prefer the human range. */
const PRIOR_OCTAVES=0.9;
/**
 * How hard the tracker resists changing its stride.
 *
 * The transition cost is `TIGHTNESS · ln(interval/period)²`, so an 8% deviation
 * costs about 0.7 and a doubling costs 58. With onsets normalised to unit
 * standard deviation, that buys drift tracking without letting one loud
 * off-beat snare halve the tempo.
 *
 * ponytail: one constant tuned against synthetic pulse trains and the audit's
 * rock case. If real material argues, this is the knob — not the algorithm.
 */
const TIGHTNESS=120;
/**
 * How periodic the onsets have to be before the grid is trusted downstream.
 *
 * This is a correlation coefficient, so it is 1 for a metronome and 0 for
 * anything without a pulse. It cannot be replaced by "do the beats land on
 * onsets" — the tracker places beats on peaks by construction, so that question
 * answers yes even for noise. The evidence has to come from the audio.
 */
const RELIABLE_PERIODICITY=0.25;

/**
 * Half-wave rectified novelty with the running level removed, scaled to unit
 * standard deviation.
 *
 * The scaling is what makes `TIGHTNESS` a constant rather than a per-song
 * mystery: without it the same transition cost means something different for a
 * quiet folk recording and a loud master.
 */
function onsetEnvelope(flux:readonly number[]){
  const sorted=[...flux].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]??0;
  const rectified=flux.map(value=>Math.max(0,value-median));
  const mean=rectified.reduce((sum,value)=>sum+value,0)/rectified.length;
  const deviation=Math.sqrt(rectified.reduce((sum,value)=>sum+(value-mean)**2,0)/rectified.length);
  return deviation>0?rectified.map(value=>value/deviation):null;
}

/**
 * The lag the onsets repeat at, argued down towards a walking pulse.
 *
 * Autocorrelation alone cannot tell 75 BPM from 150 — both are true of the same
 * signal — so the log-normal prior around 120 decides, which is the standard
 * cure for half- and double-time errors.
 */
function dominantPeriod(novelty:readonly number[],minLag:number,maxLag:number,framesPerSecond:number){
  const centre=framesPerSecond*60/PRIOR_CENTRE_BPM;
  let bestLag=Math.round(centre),bestScore=-1;
  for(let lag=minLag;lag<=maxLag;lag++){
    let sum=0;
    for(let index=lag;index<novelty.length;index++)sum+=novelty[index]!*novelty[index-lag]!;
    const score=sum/(novelty.length-lag)*Math.exp(-.5*(Math.log2(lag/centre)/PRIOR_OCTAVES)**2);
    if(score>bestScore){bestScore=score;bestLag=lag}
  }
  return bestLag;
}

/**
 * The best path of beats through the whole song, by dynamic programming.
 *
 * Every frame records the best-scoring beat sequence that could end on it:
 * its own onset strength, plus the best predecessor about one period back,
 * less the cost of that interval differing from the period. Backtracking from
 * the best total gives a grid that is globally consistent but locally free —
 * which is what a single autocorrelation lag can never be, because one lag
 * describes the whole song and real players speed up.
 *
 * David Ellis, "Beat Tracking by Dynamic Programming" (2007).
 */
function traceBeats(novelty:readonly number[],period:number){
  const count=novelty.length,cumulative=new Float64Array(count),backlink=new Int32Array(count).fill(-1);
  const shortest=Math.max(1,Math.round(period/2)),longest=Math.max(shortest+1,Math.round(period*2));
  for(let frame=0;frame<count;frame++){
    let bestScore=-Infinity,bestFrom=-1;
    for(let interval=shortest;interval<=longest;interval++){
      const from=frame-interval;
      if(from<0)break;
      const score=cumulative[from]!-TIGHTNESS*Math.log(interval/period)**2;
      if(score>bestScore){bestScore=score;bestFrom=from}
    }
    // Before the first full period there is nothing to come from, so the frame
    // starts a chain on its own evidence.
    cumulative[frame]=novelty[frame]!+(bestFrom<0?0:bestScore);
    backlink[frame]=bestFrom;
  }
  let end=0;
  for(let frame=1;frame<count;frame++)if(cumulative[frame]!>cumulative[end]!)end=frame;
  const beats:number[]=[];
  for(let frame=end;frame>=0;frame=backlink[frame]!){
    beats.push(frame);
    if(backlink[frame]===-1)break;
  }
  return beats.reverse();
}

/** Correlation of the curve with itself one interval back. Mean-centred, or a non-negative curve correlates with everything through its own average. */
function correlate(novelty:readonly number[],interval:number){
  const mean=novelty.reduce((sum,value)=>sum+value,0)/novelty.length;
  let cross=0,energy=0;
  for(let index=0;index<novelty.length;index++){
    energy+=(novelty[index]!-mean)**2;
    if(index>=interval)cross+=(novelty[index]!-mean)*(novelty[index-interval]!-mean);
  }
  return energy>0?cross/energy:0;
}

/**
 * How much of the onset curve actually repeats at the beat, in six-beat windows.
 *
 * Over a whole song one lag is the wrong question: a take that speeds up is
 * strongly pulsed everywhere and correlates with itself at no single lag, which
 * would report the best-tracked material as unreliable. Six beats is short
 * enough that drift inside a window is negligible and long enough that noise
 * cannot fake it — measured, an eighteen-percent drift scores 0.63 against 0.1
 * for noise.
 */
function periodicity(novelty:readonly number[],interval:number){
  const span=Math.max(Math.round(interval*6),128),shortest=Math.max(2,Math.round(interval*.85)),longest=Math.round(interval*1.15);
  const strongest=(slice:readonly number[])=>{let best=0;for(let lag=shortest;lag<=longest;lag++)best=Math.max(best,correlate(slice,lag));return best};
  let total=0,windows=0;
  for(let start=0;start+span<=novelty.length;start+=span){total+=strongest(novelty.slice(start,start+span));windows++}
  return windows?total/windows:strongest(novelty);
}

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

const unreliable=(bpm=120):DetectedBeatGrid=>({bpm,reliability:0,reliable:false,beatsFrames:[],downbeatPhase:0});

export function detectBeatGrid(flux:readonly number[],sampleRate:number,hopFrames:number,durationFrames:number):DetectedBeatGrid{
  const framesPerSecond=sampleRate/hopFrames,minLag=Math.max(2,Math.round(framesPerSecond*60/TEMPO_MAX_BPM)),maxLag=Math.min(flux.length-2,Math.round(framesPerSecond*60/TEMPO_MIN_BPM));
  if(flux.length<maxLag+4||maxLag<=minLag)return unreliable();
  const novelty=onsetEnvelope(flux);
  if(!novelty)return unreliable();
  const period=dominantPeriod(novelty,minLag,maxLag,framesPerSecond);
  const beats=traceBeats(novelty,period).filter(frame=>frame*hopFrames<durationFrames);
  if(beats.length<2)return unreliable(60*framesPerSecond/period);

  const intervals=beats.slice(1).map((frame,index)=>frame-beats[index]!).sort((a,b)=>a-b);
  const medianInterval=intervals[Math.floor(intervals.length/2)]||period;
  // The measured stride, not the prior's: the whole point of the trace is that
  // it may have settled somewhere the autocorrelation peak was not.
  const bpm=Math.max(30,Math.min(300,60*framesPerSecond/medianInterval));
  const reliability=Math.max(0,Math.min(1,periodicity(novelty,medianInterval)));
  const beatsFrames=beats.map(frame=>frame*hopFrames);
  return{bpm,reliability,reliable:reliability>=RELIABLE_PERIODICITY,beatsFrames,downbeatPhase:downbeatPhase(novelty,beatsFrames,hopFrames)};
}
