import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { StemKind, useStudioStore } from "../studioStore";
import styles from "./Mixer.module.css";

const stemList: { key: StemKind; label: string }[] = [
  { key: "vocals", label: "Vocals" }, { key: "drums", label: "Drums" }, { key: "bass", label: "Bass" }, { key: "other", label: "Other" },
];

export function Mixer({ available = true }: { available?: boolean }) {
  const state = useStudioStore();
  return (
    <aside className={`${styles.mixer} ${available ? "" : styles.unavailable}`} aria-label={available ? "Four stem mixer" : "Stem mixer unavailable until separation"} title={available ? undefined : "Import is ready for playback. Separate this song to enable stem mixing."}>
      {stemList.map(({ key, label }) => (
        <section className={styles.channel} data-stem={key} key={key}>
          <button disabled={!available} className={styles.stemName} onClick={() => state.setTarget(key)} aria-pressed={state.target === key}>{label}</button>
          <div className={styles.channelButtons}>
            <button disabled={!available} onClick={() => state.toggleSolo(key)} aria-pressed={state.soloed[key]} aria-label={`Solo ${label}`}>S</button>
            <button disabled={!available} onClick={() => state.toggleMute(key)} aria-pressed={state.muted[key]} aria-label={`Mute ${label}`}>M</button>
          </div>
          <div className={styles.pan}><span>L</span><span className={styles.panDial} /><span>R</span></div>
          <div className={styles.faderWrap}>
            <span className={styles.meter} aria-hidden />
            <input disabled={!available} aria-label={`${label} level, ${state.levels[key]} decibels`} type="range" min="-60" max="10" step="0.5" value={state.levels[key]} onChange={(e) => state.setLevel(key, Number(e.target.value))} />
          </div>
          <output>{state.levels[key].toFixed(1)} dB</output>
          <span className={styles.colorRule} />
          <button disabled={!available} className={styles.speaker} onClick={() => state.toggleMute(key)} aria-label={`${state.muted[key] ? "Unmute" : "Mute"} ${label}`}>
            {state.muted[key] ? <SpeakerSlash /> : <SpeakerHigh />}
          </button>
        </section>
      ))}
    </aside>
  );
}
