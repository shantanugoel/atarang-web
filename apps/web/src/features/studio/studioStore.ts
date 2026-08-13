import { create } from "zustand";
import type { PracticeStateV1 } from "@atarang/contracts";
import { stepZoom } from "./waveformView";

export type StemKind = "vocals" | "drums" | "bass" | "other";
export type StudioTab = "lyrics" | "chords" | "sheet" | "takes";
export type StudioPane = "mix" | "song" | "practice";
export type MixPreset = "balanced" | "learn" | "guide" | "playAlong";

/**
 * Everything the studio shows survives a remount, because React unmounts this
 * whole page for a trip to the Library and every `useState` in it goes with it.
 * Three homes, decided once rather than per control:
 *
 * - here: anything the user aimed (which pane, which tab, which chart, how far
 *   zoomed in). Song-scoped members are reset by `openSong`, not by remounting.
 * - the URL: what identifies the view — the song id, the Library category.
 * - local `useState`: only what is meaningless a second later — an open dialog,
 *   a half-typed search, an in-flight progress fraction.
 */
export interface StudioState {
  playing: boolean;
  recording: boolean;
  metronome: boolean;
  /** The song these song-scoped fields describe, so a remount is not mistaken for a new song. */
  songId: string | null;
  tab: StudioTab;
  /** Only consulted below 1024px, where the three panels no longer fit together. */
  pane: StudioPane;
  /** Selected user chord chart, which outlives the Chords tab that selects it. */
  chartId: string | null;
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
  /** Waveform magnification. Lives here so switching tabs or views does not throw the view away. */
  zoom: number;
  togglePlaying(): void;
  toggleRecording(): void;
  toggleMetronome(): void;
  setTab(tab: StudioTab): void;
  setPane(pane: StudioPane): void;
  setChartId(chartId: string | null): void;
  openSong(songId: string | null): void;
  setTarget(target: StemKind): void;
  toggleMute(stem: StemKind): void;
  toggleSolo(stem: StemKind): void;
  setLevel(stem: StemKind, level: number): void;
  setMasterLevel(level: number): void;
  setLoopStart(timeUs: number, durationUs: number): void;
  setLoopEnd(timeUs: number, durationUs: number): void;
  /** Both boundaries at once, for a drag: setting them one at a time makes a right-to-left drag fight the minimum length. */
  setLoop(startUs: number, endUs: number, durationUs: number): void;
  toggleLoop(): void;
  clearLoop(durationUs: number): void;
  zoomBy(steps: number): void;
  applyPreset(preset: MixPreset): void;
  resetPractice(durationUs: number): void;
  hydratePractice(document: PracticeStateV1, durationUs: number): void;
  adjust(key: "speed" | "pitch" | "repetitions" | "pause" | "countIn", delta: number): void;
}

const stems: Record<StemKind, boolean> = { vocals: false, drums: false, bass: false, other: false };
const defaultLevels: Record<StemKind, number> = { vocals: 0, drums: 0, bass: -2.5, other: -4 };
const MIN_LOOP_US = 500_000;
// Loud enough to pick out a line, quiet enough that the rest is still a band —
// muting everything else leaves nothing to play along to.
const LEARN_FOREGROUND_DB = 3, LEARN_BACKGROUND_DB = -9;
// A cue, not a performance: enough to hear where the melody goes without
// singing over the top of it.
const GUIDE_VOCAL_DB = -14;
// The bottom of the fader rather than the mute flag. Mutes are not in the
// practice contract and hydratePractice clears them, so a preset built on one
// would be the only one of the four that did not survive a reload — and it is
// the one a player leaves set for a whole session.
const SILENT_DB = -60;

export const useStudioStore = create<StudioState>((set) => ({
  playing: false,
  recording: false,
  metronome: true,
  songId: null,
  tab: "lyrics",
  pane: "song",
  chartId: null,
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
  zoom: 1,
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  toggleRecording: () => set((s) => ({ recording: !s.recording, playing: s.recording ? s.playing : true })),
  toggleMetronome: () => set((s) => ({ metronome: !s.metronome })),
  setTab: (tab) => set({ tab }),
  setPane: (pane) => set({ pane }),
  setChartId: (chartId) => set({ chartId }),
  // A different song, not a remount: the zoom and the chart belong to the song
  // that was open, and the pane and tab are how this user reads any song.
  openSong: (songId) => set((s) => (s.songId === songId ? {} : { songId, zoom: 1, chartId: null })),
  setTarget: (target) => set({ target }),
  toggleMute: (stem) => set((s) => ({ muted: { ...s.muted, [stem]: !s.muted[stem] } })),
  toggleSolo: (stem) => set((s) => ({ soloed: { ...s.soloed, [stem]: !s.soloed[stem] } })),
  setLevel: (stem, level) => set((s) => ({ levels: { ...s.levels, [stem]: level } })),
  setMasterLevel: (masterLevel) => set({ masterLevel: Math.max(-60, Math.min(0, masterLevel)) }),
  setLoopStart: (timeUs, durationUs) => set((state) => { const start = Math.max(0, Math.min(Math.round(timeUs), Math.max(0, durationUs - MIN_LOOP_US))); return { loopStartUs: start, loopEndUs: Math.min(durationUs, Math.max(state.loopEndUs, start + MIN_LOOP_US)), loopEnabled: true }; }),
  setLoopEnd: (timeUs, durationUs) => set((state) => { const end = Math.min(durationUs, Math.max(MIN_LOOP_US, Math.round(timeUs))); return { loopStartUs: Math.max(0, Math.min(state.loopStartUs, end - MIN_LOOP_US)), loopEndUs: end, loopEnabled: true }; }),
  setLoop: (startUs, endUs, durationUs) => {
    const start = Math.max(0, Math.min(Math.round(Math.min(startUs, endUs)), durationUs - MIN_LOOP_US));
    set({ loopStartUs: start, loopEndUs: Math.min(durationUs, Math.max(Math.round(Math.max(startUs, endUs)), start + MIN_LOOP_US)), loopEnabled: true });
  },
  toggleLoop: () => set((state) => ({ loopEnabled: !state.loopEnabled })),
  clearLoop: (durationUs) => set({ loopEnabled: false, loopStartUs: 0, loopEndUs: Math.max(MIN_LOOP_US, durationUs) }),
  zoomBy: (steps) => set((state) => ({ zoom: stepZoom(state.zoom, steps) })),
  // Each preset is the defaults plus one change, which is what makes them safe
  // to tap: any of them is a whole mix, not a modifier on the last one, and
  // Balanced is always the way back.
  applyPreset: (preset) => set((state) => {
    const levels = { ...defaultLevels };
    // Learn and Play along act on the stem the player selected, so the one
    // control the mixer already has decides what "your part" means.
    if (preset === "learn") for (const stem of Object.keys(levels) as StemKind[]) levels[stem] = stem === state.target ? LEARN_FOREGROUND_DB : defaultLevels[stem] + LEARN_BACKGROUND_DB;
    if (preset === "guide") levels.vocals = GUIDE_VOCAL_DB;
    if (preset === "playAlong") levels[state.target] = SILENT_DB;
    return { levels, muted: { ...stems }, soloed: { ...stems } };
  }),
  // Practice state only. These run whenever the page mounts, so anything view
  // shaped in here would be reset by a trip to the Library and back — that is
  // what `openSong` is for.
  resetPractice: (durationUs) => set({ target:"vocals",muted:{...stems},soloed:{...stems},levels:{...defaultLevels},speed:1,pitch:0,repetitions:4,pause:2,countIn:2,metronome:true,loopEnabled:false,loopStartUs:0,loopEndUs:Math.max(MIN_LOOP_US,durationUs) }),
  hydratePractice: (document, durationUs) => set({ target:document.target,muted:{...stems},soloed:{...stems},levels:{...document.stemGainDb},speed:document.speed,pitch:document.pitchSemitones,repetitions:document.repetitions,pause:document.pauseSeconds,countIn:document.countIn,metronome:document.metronome,loopEnabled:document.loop.enabled,loopStartUs:Math.min(document.loop.startTimeUs,Math.max(0,durationUs-MIN_LOOP_US)),loopEndUs:Math.min(durationUs,Math.max(document.loop.endTimeUs,MIN_LOOP_US)) }),
  adjust: (key, delta) => set((s) => {
    const ranges = { speed: [.5, 1, .05], pitch: [-12, 12, 1], repetitions: [1, 999, 1], pause: [0, 10, 1], countIn: [0, 4, 2] } as const;
    const [min, max, step] = ranges[key];
    const value = Math.min(max, Math.max(min, Math.round(((s[key] + delta * step) + Number.EPSILON) * 100) / 100));
    return { [key]: value } as Pick<StudioState, typeof key>;
  }),
}));
