import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { MixPreset, StemKind, useStudioStore } from "../studioStore";
import styles from "./Mixer.module.css";

const stemList: { key: StemKind; label: string }[] = [
  { key: "vocals", label: "Vocals" }, { key: "drums", label: "Drums" }, { key: "bass", label: "Bass" }, { key: "other", label: "Other" },
];

// Named so a beginner can use stem separation without understanding it. The
// descriptions name the selected stem, because two of the four act on it.
const presets: { key: MixPreset; label: string; describe: (stem: string) => string }[] = [
  { key: "balanced", label: "Balanced", describe: () => "Every stem at its default level" },
  { key: "learn", label: "Learn", describe: (stem) => `${stem} out front, the rest behind it` },
  { key: "guide", label: "Guide", describe: () => "Vocals dropped to a cue level" },
  { key: "playAlong", label: "Play along", describe: (stem) => `${stem} silenced so you play that part` },
];

export function Mixer({ available = true,meters={} }: { available?: boolean;meters?:Partial<Record<StemKind,number>> }) {
  const state = useStudioStore();
  const targetLabel = stemList.find((stem) => stem.key === state.target)?.label ?? "The selected stem";
  return (
    <aside className={`${styles.mixer} ${available ? "" : styles.unavailable}`} aria-label={available ? "Four stem mixer" : "Stem mixer unavailable until separation"} title={available ? undefined : "Import is ready for playback. Separate this song to enable stem mixing."}>
      <div className={styles.presets} role="group" aria-label="Mix presets">
        {presets.map(({ key, label, describe }) => (
          <button key={key} disabled={!available} onClick={() => state.applyPreset(key)} title={describe(targetLabel)}>{label}</button>
        ))}
      </div>
      {stemList.map(({ key, label }) => (
        <section className={styles.channel} data-stem={key} key={key}>
          <button disabled={!available} className={styles.stemName} onClick={() => state.setTarget(key)} aria-pressed={state.target === key}>{label}</button>
          <div className={styles.channelButtons}>
            <button disabled={!available} onClick={() => state.toggleSolo(key)} aria-pressed={state.soloed[key]} aria-label={`Solo ${label}`}>S</button>
            <button disabled={!available} onClick={() => state.toggleMute(key)} aria-pressed={state.muted[key]} aria-label={`Mute ${label}`}>M</button>
          </div>
          <div className={styles.faderWrap}>
            <input disabled={!available} aria-label={`${label} level, ${state.levels[key]} decibels`} type="range" min="-60" max="10" step="0.5" value={state.levels[key]} onChange={(e) => state.setLevel(key, Number(e.target.value))} />
            <span className={styles.meter} role="meter" aria-label={`${label} live level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((meters[key]??0)*100)}><i style={{height:`${Math.round((meters[key]??0)*100)}%`}} /></span>
          </div>
          <output>{state.levels[key].toFixed(1)} dB</output>
          <label className={styles.pan}><span>L</span><input disabled={!available} aria-label={`${label} pan`} type="range" min="-1" max="1" step="0.05" value={state.pan[key]} onChange={event=>state.setPan(key,Number(event.target.value))}/><span>R</span></label>
          <span className={styles.colorRule} />
          <button disabled={!available} className={styles.speaker} onClick={() => state.toggleMute(key)} aria-label={`${state.muted[key] ? "Unmute" : "Mute"} ${label}`}>
            {state.muted[key] ? <SpeakerSlash /> : <SpeakerHigh />}
          </button>
        </section>
      ))}
      <section className={`${styles.channel} ${styles.master}`}>
        <strong className={styles.stemName}>Master</strong>
        <div className={styles.masterIcon}><SpeakerHigh aria-hidden /></div>
        <div className={styles.faderWrap}>
          <input aria-label={`Master level, ${state.masterLevel} decibels`} type="range" min="-60" max="0" step="0.5" value={state.masterLevel} onChange={(event)=>state.setMasterLevel(Number(event.target.value))}/>
        </div>
        <output>{state.masterLevel.toFixed(1)} dB</output>
        <span className={styles.panSpacer}>PAN</span>
        <span className={styles.colorRule} />
        <span className={styles.masterLabel}>OUTPUT</span>
      </section>
    </aside>
  );
}
