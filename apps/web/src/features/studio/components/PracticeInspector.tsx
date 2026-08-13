import { useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { useStudioStore } from "../studioStore";
import { tapTempoBpm } from "../tempo";
import type {BeatGridV1} from "@atarang/contracts";
import styles from "./PracticeInspector.module.css";

type StepperKey = "speed" | "pitch" | "repetitions" | "pause" | "countIn" | "speedRamp";
const rows: { key: StepperKey; label: string; format: (v:number)=>string }[] = [
  { key: "speed", label: "Speed", format: (v) => `${v.toFixed(2)}×` },
  { key: "pitch", label: "Pitch", format: (v) => `${v > 0 ? "+" : ""}${v}` },
  { key: "repetitions", label: "Repetitions", format: String },
  { key: "pause", label: "Pause", format: (v) => `${v}s` },
  { key: "speedRamp", label: "Speed ramp", format: (v) => v ? `+${v}% / rep` : "Off" },
];

const formatBoundary = (timeUs: number) => { const totalMs = Math.max(0, Math.round(timeUs / 1000)); const seconds = Math.floor(totalMs / 1000); return `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}.${String(totalMs % 1000).padStart(3,"0")}`; };

// Speed is the only one of these a plain <audio> element can do. Repetitions,
// pause, count-in, pitch and the metronome all need the four-stem engine, and
// leaving them interactive before separation makes the app look broken rather
// than incomplete.
const STEM_ONLY_HINT = "Available with four-stem playback. Separate this song to enable it.";

export function PracticeInspector({ durationUs, currentTimeUs = 0, stemsAvailable = true,beatGrid,setTempo,analyzable=true }: { durationUs?: number | undefined; currentTimeUs?: number; stemsAvailable?:boolean;beatGrid?:BeatGridV1|null|undefined;setTempo?:((bpm:number)=>void)|undefined;analyzable?:boolean }) {
  const state = useStudioStore();
  // `undefined` is a grid still being read. `null` is one that will never
  // arrive: the demo preview is not in the Library, so nothing ever analyzes
  // it, and a failed pass leaves nothing behind either. Reporting both as
  // "Analyzing" promised work that was not happening, forever.
  const tempoLabel = beatGrid ? `${Math.round(beatGrid.bpm)} BPM` : beatGrid === undefined ? "Analyzing" : "Unavailable";
  const tempoHint = beatGrid?.reliable ? `${Math.round(beatGrid.reliability * 100)}% beat-grid reliability`
    : beatGrid ? "Adjusting tempo marks this grid as user-corrected."
    : beatGrid === undefined ? "Reading the beat grid from this audio."
    : analyzable ? "Analysis produced no beat grid. Retry it from the Chords tab."
    : "The bundled demo is not analyzed. Add it to your Library to get a tempo.";
  const [sectionName, setSectionName] = useState("");
  // Taps only mean something in a row, so they live for the gesture and no longer.
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    // A gap longer than two seconds is someone starting again, not a slow tempo.
    taps.current = [...(now - (taps.current.at(-1) ?? 0) > 2000 ? [] : taps.current), now].slice(-8);
    const bpm = tapTempoBpm(taps.current);
    if (bpm !== null) setTempo?.(bpm);
  };
  return <aside className={styles.inspector} aria-label="Practice settings">
    <header><h2>Practice</h2>{!stemsAvailable&&<p className={styles.notice}>Speed, loop and tempo work now. The rest needs four stems.</p>}</header>
    <section className={styles.loop}><h3>Loop</h3><div><button aria-label="Set loop start at playhead" onClick={()=>durationUs&&state.setLoopStart(currentTimeUs,durationUs)}><b>A</b><span>{formatBoundary(state.loopStartUs)}</span></button><button aria-label="Set loop end at playhead" onClick={()=>durationUs&&state.setLoopEnd(currentTimeUs,durationUs)}><b>B</b><span>{formatBoundary(state.loopEndUs)}</span></button></div>
      <form className={styles.saveSection} onSubmit={event=>{event.preventDefault();if(!sectionName.trim())return;state.saveSection(sectionName);setSectionName("")}}>
        <input value={sectionName} onChange={event=>setSectionName(event.target.value)} placeholder="Name this passage" aria-label="Name for the current loop" maxLength={60}/>
        <button disabled={!sectionName.trim()} aria-label="Save the current loop as a section"><Plus/></button>
      </form>
      {state.sections.length>0&&<ul className={styles.sections}>{state.sections.map(section=><li key={section.id}>
        <button onClick={()=>durationUs&&state.setLoop(section.startTimeUs,section.endTimeUs,durationUs)}><strong>{section.name}</strong><span>{formatBoundary(section.startTimeUs).slice(0,5)}–{formatBoundary(section.endTimeUs).slice(0,5)}</span></button>
        <button className={styles.removeSection} onClick={()=>state.removeSection(section.id)} aria-label={`Delete section ${section.name}`}><X/></button>
      </li>)}</ul>}
    </section>
    <section className={styles.controls}>
      {rows.map(({key,label,format}) => {const disabled=key!=="speed"&&!stemsAvailable;return <div className={styles.row} key={key} title={disabled?STEM_ONLY_HINT:undefined}><label>{label}</label><div className={styles.stepper}><button disabled={disabled} onClick={()=>state.adjust(key,-1)} aria-label={`Decrease ${label}`}>−</button><output>{format(state[key])}</output><button disabled={disabled} onClick={()=>state.adjust(key,1)} aria-label={`Increase ${label}`}>+</button></div></div>})}
      {durationUs&&<div className={styles.row} title={tempoHint}><label>Tempo</label><div className={styles.stepper}><button disabled={!beatGrid} onClick={()=>beatGrid&&setTempo?.(beatGrid.bpm-1)} aria-label="Decrease tempo">−</button><output>{tempoLabel}</output><button disabled={!beatGrid} onClick={()=>beatGrid&&setTempo?.(beatGrid.bpm+1)} aria-label="Increase tempo">+</button></div></div>}
      {/* The way out when the detector is unsure: tap the tempo you hear rather than nudge a wrong one into place. */}
      {durationUs&&<div className={styles.row}><label>Tap tempo</label><button className={styles.tap} disabled={!beatGrid} onClick={tap}>Tap</button></div>}
      <div className={styles.row} title={stemsAvailable?undefined:STEM_ONLY_HINT}><label htmlFor="metronome">Metronome</label><button id="metronome" disabled={!stemsAvailable} className={styles.switch} role="switch" aria-checked={state.metronome} onClick={state.toggleMetronome}><span /></button></div>
      <div className={styles.row} title={stemsAvailable?undefined:STEM_ONLY_HINT}><label>Count-in</label><div className={styles.stepper}><button disabled={!stemsAvailable} onClick={()=>state.adjust("countIn",-1)} aria-label="Decrease count-in">−</button><output>{state.countIn}</output><button disabled={!stemsAvailable} onClick={()=>state.adjust("countIn",1)} aria-label="Increase count-in">+</button></div></div>
    </section>
    <p className={styles.hint}><kbd>Space</kbd> Play · <kbd>I</kbd>/<kbd>O</kbd> Loop · <kbd>M</kbd> Click · drag the ruler above the waveform to loop a passage</p>
  </aside>;
}
