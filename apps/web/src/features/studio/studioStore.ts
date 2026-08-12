import { create } from "zustand";
import type { PracticeStateV1 } from "@atarang/contracts";

export type StemKind = "vocals" | "drums" | "bass" | "other";
export type StudioTab = "lyrics" | "chords" | "sheet" | "takes";

export interface StudioState {
  playing: boolean;
  recording: boolean;
  metronome: boolean;
  tab: StudioTab;
  target: StemKind;
  muted: Record<StemKind, boolean>;
  soloed: Record<StemKind, boolean>;
  levels: Record<StemKind, number>;
  masterLevel: number;
  speed: number;
  pitch: number;
  repetitions: number;
  pause: number;
  countIn: number;
  loopEnabled: boolean;
  loopStartUs: number;
  loopEndUs: number;
  togglePlaying(): void;
  toggleRecording(): void;
  toggleMetronome(): void;
  setTab(tab: StudioTab): void;
  setTarget(target: StemKind): void;
  toggleMute(stem: StemKind): void;
  toggleSolo(stem: StemKind): void;
  setLevel(stem: StemKind, level: number): void;
  setMasterLevel(level: number): void;
  setLoopStart(timeUs: number, durationUs: number): void;
  setLoopEnd(timeUs: number, durationUs: number): void;
  toggleLoop(): void;
  clearLoop(durationUs: number): void;
  resetPractice(durationUs: number): void;
  hydratePractice(document: PracticeStateV1, durationUs: number): void;
  adjust(key: "speed" | "pitch" | "repetitions" | "pause" | "countIn", delta: number): void;
}

const stems: Record<StemKind, boolean> = { vocals: false, drums: false, bass: false, other: false };
const defaultLevels: Record<StemKind, number> = { vocals: 0, drums: 0, bass: -2.5, other: -4 };
const MIN_LOOP_US = 500_000;

export const useStudioStore = create<StudioState>((set) => ({
  playing: false,
  recording: false,
  metronome: true,
  tab: "lyrics",
  target: "vocals",
  muted: { ...stems },
  soloed: { ...stems },
  levels: { ...defaultLevels },
  masterLevel: 0,
  speed: 1,
  pitch: 0,
  repetitions: 4,
  pause: 2,
  countIn: 2,
  loopEnabled: false,
  loopStartUs: 0,
  loopEndUs: 30_000_000,
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  toggleRecording: () => set((s) => ({ recording: !s.recording, playing: s.recording ? s.playing : true })),
  toggleMetronome: () => set((s) => ({ metronome: !s.metronome })),
  setTab: (tab) => set({ tab }),
  setTarget: (target) => set({ target }),
  toggleMute: (stem) => set((s) => ({ muted: { ...s.muted, [stem]: !s.muted[stem] } })),
  toggleSolo: (stem) => set((s) => ({ soloed: { ...s.soloed, [stem]: !s.soloed[stem] } })),
  setLevel: (stem, level) => set((s) => ({ levels: { ...s.levels, [stem]: level } })),
  setMasterLevel: (masterLevel) => set({ masterLevel: Math.max(-60, Math.min(0, masterLevel)) }),
  setLoopStart: (timeUs, durationUs) => set((state) => { const start = Math.max(0, Math.min(Math.round(timeUs), Math.max(0, durationUs - MIN_LOOP_US))); return { loopStartUs: start, loopEndUs: Math.min(durationUs, Math.max(state.loopEndUs, start + MIN_LOOP_US)), loopEnabled: true }; }),
  setLoopEnd: (timeUs, durationUs) => set((state) => { const end = Math.min(durationUs, Math.max(MIN_LOOP_US, Math.round(timeUs))); return { loopStartUs: Math.max(0, Math.min(state.loopStartUs, end - MIN_LOOP_US)), loopEndUs: end, loopEnabled: true }; }),
  toggleLoop: () => set((state) => ({ loopEnabled: !state.loopEnabled })),
  clearLoop: (durationUs) => set({ loopEnabled: false, loopStartUs: 0, loopEndUs: Math.max(MIN_LOOP_US, durationUs) }),
  resetPractice: (durationUs) => set({ target:"vocals",muted:{...stems},soloed:{...stems},levels:{...defaultLevels},speed:1,pitch:0,repetitions:4,pause:2,countIn:2,metronome:true,loopEnabled:false,loopStartUs:0,loopEndUs:Math.max(MIN_LOOP_US,durationUs) }),
  hydratePractice: (document, durationUs) => set({ target:document.target,muted:{...stems},soloed:{...stems},levels:{...document.stemGainDb},speed:document.speed,pitch:document.pitchSemitones,repetitions:document.repetitions,pause:document.pauseSeconds,countIn:document.countIn,metronome:document.metronome,loopEnabled:document.loop.enabled,loopStartUs:Math.min(document.loop.startTimeUs,Math.max(0,durationUs-MIN_LOOP_US)),loopEndUs:Math.min(durationUs,Math.max(document.loop.endTimeUs,MIN_LOOP_US)) }),
  adjust: (key, delta) => set((s) => {
    const ranges = { speed: [.5, 1, .05], pitch: [-12, 12, 1], repetitions: [1, 999, 1], pause: [0, 10, 1], countIn: [0, 4, 2] } as const;
    const [min, max, step] = ranges[key];
    const value = Math.min(max, Math.max(min, Math.round(((s[key] + delta * step) + Number.EPSILON) * 100) / 100));
    return { [key]: value } as Pick<StudioState, typeof key>;
  }),
}));
