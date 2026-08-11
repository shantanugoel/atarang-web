export function pitchCorrectionSemitones(speed:number,pitchSemitones:number){const boundedSpeed=Math.max(.5,Math.min(1,speed));return Math.max(-12,Math.min(12,pitchSemitones))-12*Math.log2(boundedSpeed)}
export function expectedSourceFrames(outputFrames:number,speed:number){return Math.round(outputFrames*Math.max(.5,Math.min(1,speed)))}
