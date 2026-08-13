import { useCallback, useEffect, useState } from "react";
import type { OriginalRecord, WaveformRecord } from "../../storage/database";
import { ensureWaveform } from "./waveformAnalysis";

export function useWaveform(original?: OriginalRecord) {
  const [waveform, setWaveform] = useState<WaveformRecord | null>(null);
  const [status, setStatus] = useState<"idle"|"analyzing"|"ready"|"error">("idle");
  // Bumped by `retry`, which is the only way back from a failed pass: nothing
  // was written, so `ensureWaveform` runs the whole analysis again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!original) { setWaveform(null); setStatus("idle"); return; }
    setStatus("analyzing"); setWaveform(null);
    void ensureWaveform(original).then((record) => { if (active) { setWaveform(record); setStatus("ready"); } }, () => { if (active) setStatus("error"); });
    return () => { active=false; };
  }, [original, attempt]);
  return { waveform, status, retry: useCallback(() => setAttempt((value) => value + 1), []) };
}
