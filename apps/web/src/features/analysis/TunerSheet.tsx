import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { detectPitch, medianHz, nearestNote } from "./pitch";
import styles from "./TunerSheet.module.css";

/** Inside this, the string is in tune as far as anyone can hear. */
const IN_TUNE_CENTS = 4;
// Half a second of unclear frames before the readout goes blank: a plucked note
// decays through the threshold long before the player has finished turning the
// peg, and a number that vanishes between plucks is unusable.
const HOLD_FRAMES = 8;
// Below this the frame was room noise, a squeak, or the tail of a note. A tuner
// is believed absolutely, so it says nothing rather than something shaky.
const MIN_CLARITY = 0.85;
const READ_INTERVAL_MS = 60;

/**
 * A chromatic tuner on the microphone.
 *
 * Self-contained on purpose: it borrows nothing from the four-stem engine, needs
 * no cross-origin isolation and no model, and holds its own stream only while it
 * is open. What it does share is the detector in `pitch.ts`, which is where the
 * accuracy actually lives.
 */
export function TunerSheet({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reading, setReading] = useState<{ name: string; octave: number; cents: number; hz: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => {
    let stopped = false, frame = 0, context: AudioContext | undefined, stream: MediaStream | undefined;
    void (async () => {
      try {
        // The three processing flags off: gain control and noise suppression are
        // built to flatter speech and both bend a sustained note's pitch.
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch {
        setError("The microphone is not available. Allow microphone access for this site and open the tuner again.");
        return;
      }
      if (stopped) { for (const track of stream.getTracks()) track.stop(); return; }
      context = new AudioContext();
      // The permission prompt eats the click that opened this, so the context can
      // be born suspended — and a suspended context hands the analyser silence
      // forever, which looks exactly like a dead tuner.
      if (context.state === "suspended") await context.resume().catch(() => {});
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const recent: number[] = [];
      let misses = 0, lastRead = 0;
      frame = requestAnimationFrame(function tick(now) {
        frame = requestAnimationFrame(tick);
        // The detector costs about a millisecond and a half; sixteen reads a
        // second is already faster than a hand can turn a peg.
        if (now - lastRead < READ_INTERVAL_MS) return;
        lastRead = now;
        analyser.getFloatTimeDomainData(samples);
        const found = detectPitch(samples, context!.sampleRate);
        if (!found || found.clarity < MIN_CLARITY) {
          if (++misses > HOLD_FRAMES) { recent.length = 0; setReading(null); }
          return;
        }
        misses = 0;
        recent.push(found.hz);
        if (recent.length > 5) recent.shift();
        const hz = medianHz(recent)!;
        setReading({ ...nearestNote(hz), hz });
      });
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      void context?.close();
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, []);

  const inTune = reading !== null && Math.abs(reading.cents) <= IN_TUNE_CENTS;
  return (
    <dialog ref={dialog} className={styles.sheet} onClose={onClose} onMouseDown={(event) => { if (event.target === dialog.current) dialog.current?.close(); }} aria-labelledby="tuner-title">
      <header>
        <h2 id="tuner-title">Tuner</h2>
        <button aria-label="Close tuner" onClick={() => dialog.current?.close()}><X /></button>
      </header>
      {error
        ? <div className={styles.readout}><p className={styles.hint} role="alert">{error}</p></div>
        : <div className={styles.readout} aria-label="Tuner readout">
            {/* Only the note is announced. The cents change several times a second
                and reading every one of them aloud would make this unusable. */}
            <div className={`${styles.note}${inTune ? ` ${styles.inTune}` : ""}`} role="status">
              {reading ? <>{reading.name}<small>{reading.octave}</small></> : <small>—</small>}
            </div>
            <div className={styles.cents}>
              {reading ? `${reading.cents > 0 ? "+" : ""}${reading.cents} cents · ${reading.hz.toFixed(1)} Hz` : "Play a single note"}
            </div>
            <div className={styles.meter}>
              {reading && <div className={`${styles.needle}${inTune ? ` ${styles.inTune}` : ""}`} style={{ left: `${50 + Math.max(-50, Math.min(50, reading.cents)) }%` }} />}
            </div>
            <div className={styles.scale}><span>−50</span><span>{inTune ? "In tune" : "0"}</span><span>+50</span></div>
          </div>}
      <footer>One string at a time, with the room quiet — the microphone hears the backing track too. Referenced to A440.</footer>
    </dialog>
  );
}
