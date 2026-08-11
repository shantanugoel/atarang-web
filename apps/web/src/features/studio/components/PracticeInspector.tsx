import { useStudioStore } from "../studioStore";
import type {BeatGridV1} from "@atarang/contracts";
import styles from "./PracticeInspector.module.css";

type StepperKey = "speed" | "pitch" | "repetitions" | "pause" | "countIn";
const rows: { key: StepperKey; label: string; format: (v:number)=>string }[] = [
  { key: "speed", label: "Speed", format: (v) => `${v.toFixed(2)}×` },
  { key: "pitch", label: "Pitch", format: (v) => `${v > 0 ? "+" : ""}${v}` },
  { key: "repetitions", label: "Repetitions", format: String },
  { key: "pause", label: "Pause", format: (v) => `${v}s` },
];

const formatBoundary = (timeUs: number) => { const totalMs = Math.max(0, Math.round(timeUs / 1000)); const seconds = Math.floor(totalMs / 1000); return `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}.${String(totalMs % 1000).padStart(3,"0")}`; };

export function PracticeInspector({ durationUs, currentTimeUs = 0, pitchAvailable = true,beatGrid,adjustTempo }: { durationUs?: number | undefined; currentTimeUs?: number; pitchAvailable?:boolean;beatGrid?:BeatGridV1|null|undefined;adjustTempo?:((delta:number)=>void)|undefined }) {
  const state = useStudioStore();
  return <aside className={styles.inspector} aria-label="Practice settings">
    <header><h2>Practice</h2></header>
    <section className={styles.loop}><h3>Loop</h3><div><button aria-label="Set loop start at playhead" onClick={()=>durationUs&&state.setLoopStart(currentTimeUs,durationUs)}><b>A</b><span>{formatBoundary(state.loopStartUs)}</span></button><button aria-label="Set loop end at playhead" onClick={()=>durationUs&&state.setLoopEnd(currentTimeUs,durationUs)}><b>B</b><span>{formatBoundary(state.loopEndUs)}</span></button></div></section>
    <section className={styles.controls}>
      {rows.map(({key,label,format}) => {const disabled=key==="pitch"&&!pitchAvailable;return <div className={styles.row} key={key} title={disabled?"Pitch shifting is available with four-stem playback.":undefined}><label>{label}</label><div className={styles.stepper}><button disabled={disabled} onClick={()=>state.adjust(key,-1)} aria-label={`Decrease ${label}`}>−</button><output>{format(state[key])}</output><button disabled={disabled} onClick={()=>state.adjust(key,1)} aria-label={`Increase ${label}`}>+</button></div></div>})}
      {durationUs&&<div className={styles.row} title={beatGrid?.reliable?`${Math.round(beatGrid.reliability*100)}% beat-grid reliability`:"Adjusting tempo marks this grid as user-corrected."}><label>Tempo</label><div className={styles.stepper}><button disabled={!beatGrid} onClick={()=>adjustTempo?.(-1)} aria-label="Decrease tempo">−</button><output>{beatGrid?`${Math.round(beatGrid.bpm)} BPM`:"Analyzing"}</output><button disabled={!beatGrid} onClick={()=>adjustTempo?.(1)} aria-label="Increase tempo">+</button></div></div>}
      <div className={styles.row}><label htmlFor="metronome">Metronome</label><button id="metronome" className={styles.switch} role="switch" aria-checked={state.metronome} onClick={state.toggleMetronome}><span /></button></div>
      <div className={styles.row}><label>Count-in</label><div className={styles.stepper}><button onClick={()=>state.adjust("countIn",-1)} aria-label="Decrease count-in">−</button><output>{state.countIn}</output><button onClick={()=>state.adjust("countIn",1)} aria-label="Increase count-in">+</button></div></div>
    </section>
    <p className={styles.hint}><kbd>Space</kbd> Play · <kbd>I</kbd>/<kbd>O</kbd> Loop · <kbd>M</kbd> Click</p>
  </aside>;
}
