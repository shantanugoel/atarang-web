import { useEffect, useRef, useState } from "react";
import { assertPracticeState, type PracticeStateV1 } from "@atarang/contracts";
import type { OriginalRecord } from "../../storage/database";
import { getPractice, putPractice } from "../../storage/repositories";
import { useStudioStore, type StudioState } from "./studioStore";

const changed = (state: StudioState, previous: StudioState) => state.target !== previous.target || state.levels !== previous.levels || state.speed !== previous.speed || state.pitch !== previous.pitch || state.repetitions !== previous.repetitions || state.pause !== previous.pause || state.countIn !== previous.countIn || state.metronome !== previous.metronome || state.loopEnabled !== previous.loopEnabled || state.loopStartUs !== previous.loopStartUs || state.loopEndUs !== previous.loopEndUs || state.sections !== previous.sections || state.speedRamp !== previous.speedRamp;

export function usePracticePersistence(original: OriginalRecord | undefined, sourceTimeUs: number, playing: boolean, playbackReady: boolean, seekTo: (seconds: number) => void) {
  const sourceTimeRef = useRef(sourceTimeUs);
  const persistRef = useRef<(() => void) | null>(null);
  const previousPlaying = useRef(playing);
  const [restoreTimeUs, setRestoreTimeUs] = useState<number | null>(null);
  sourceTimeRef.current = sourceTimeUs;

  useEffect(() => {
    if (!original) { setRestoreTimeUs(null); return; }
    let active = true;
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let revision = 0;
    let createdAt = new Date().toISOString();
    const persist = () => {
      if (!ready) return;
      if (timer) clearTimeout(timer);
      const state = useStudioStore.getState();
      const now = new Date().toISOString();
      revision += 1;
      const document: PracticeStateV1 = { schema:"atarang.practice/1",originalId:original.id,revision,sourceTimeUs:Math.max(0,Math.min(original.durationUs,Math.round(sourceTimeRef.current))),target:state.target,loop:{enabled:state.loopEnabled,startTimeUs:state.loopStartUs,endTimeUs:state.loopEndUs},speed:state.speed,pitchSemitones:state.pitch,repetitions:state.repetitions,pauseSeconds:state.pause,countIn:state.countIn as 0|2|4,metronome:state.metronome,stemGainDb:{...state.levels},sections:state.sections,speedRampPercent:state.speedRamp,updatedAt:now };
      void putPractice({ id:original.id,originalId:original.id,revision,document,schemaVersion:1,createdAt,updatedAt:now });
    };
    persistRef.current = persist;
    const onPageHide = () => persist();
    window.addEventListener("pagehide", onPageHide);
    void getPractice(original.id).then((record) => {
      if (!active) return;
      let document: PracticeStateV1 | undefined;
      try { if (record) { assertPracticeState(record.document); document = record.document; } } catch { /* Invalid derived state is replaced by bounded defaults. */ }
      revision = record?.revision ?? 0;
      createdAt = record?.createdAt ?? createdAt;
      if (document?.originalId === original.id) { useStudioStore.getState().hydratePractice(document, original.durationUs); setRestoreTimeUs(Math.min(document.sourceTimeUs, original.durationUs)); }
      else { useStudioStore.getState().resetPractice(original.durationUs); setRestoreTimeUs(0); }
      ready = true;
      unsubscribe = useStudioStore.subscribe((state, previous) => { if (changed(state, previous)) { if (timer) clearTimeout(timer); timer = setTimeout(persist, 350); } });
    });
    return () => { active = false; if (timer) clearTimeout(timer); persist(); unsubscribe?.(); window.removeEventListener("pagehide", onPageHide); if (persistRef.current === persist) persistRef.current = null; };
  }, [original]);

  useEffect(() => { if (restoreTimeUs !== null && playbackReady) { seekTo(restoreTimeUs / 1_000_000); setRestoreTimeUs(null); } }, [playbackReady, restoreTimeUs, seekTo]);
  useEffect(() => { if (previousPlaying.current && !playing) persistRef.current?.(); previousPlaying.current = playing; }, [playing]);
}
