import { create } from "zustand";
import type { PracticeSectionV1, PracticeStateV1 } from "@atarang/contracts";
import type { ChordDisplay } from "../chords/shapes";
import { uuidV7 } from "../../storage/ids";
import { stepZoom } from "./waveformView";

export type StemKind = "vocals" | "drums" | "bass" | "other";
export type StudioTab = "lyrics" | "chords" | "sheet" | "takes";
export type ChordView = "timeline" | "chart" | "lyricsChords";
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
  chordView: ChordView;
  /**
   * How the chords are read: transpose, capo and how far symbols are simplified.
   * A selected user chart saves its own copy, but detected chords have nowhere
   * else to live — held locally they were reset by a trip to the Library.
   */
  chordDisplay: ChordDisplay;
  target: StemKind;
  muted: Record<StemKind, boolean>;
  soloed: Record<StemKind, boolean>;
  levels: Record<StemKind, number>;
  pan: Record<StemKind, number>;
  masterLevel: number;
  speed: number;
  pitch: number;
  repetitions: number;
  pause: number;
  countIn: number;
  loopEnabled: boolean;
  loopStartUs: number;
  loopEndUs: number;
  /** Named passages, saved from the loop and restored to it. */
  sections: PracticeSectionV1[];
  /** Percent added to the speed at the end of each loop repetition. 0 is off. */
  speedRamp: number;
  /** Waveform magnification. Lives here so switching tabs or views does not throw the view away. */
  zoom: number;
  /** Whether timed lyrics should keep the active line centred. Manual scrolling turns this off. */
  lyricsFollowing: boolean;
  /** The same, for the detected chord rail. Song-scoped, so a new song follows again. */
  chordsFollowing: boolean;
  /** Sing-along text size, as a multiplier. How this user reads any song, so it outlives the song. */
  singScale: number;
  /** Which half of the lyrics + chords view is shown. */
  leadMode: "both" | "lyrics" | "chords";
  togglePlaying(): void;
  toggleRecording(): void;
  toggleMetronome(): void;
  setTab(tab: StudioTab): void;
  setPane(pane: StudioPane): void;
  setChartId(chartId: string | null): void;
  setChordView(view: ChordView): void;
  setChordDisplay(change: Partial<ChordDisplay>): void;
  openSong(songId: string | null): void;
  setTarget(target: StemKind): void;
  toggleMute(stem: StemKind): void;
  toggleSolo(stem: StemKind): void;
  setLevel(stem: StemKind, level: number): void;
  setPan(stem: StemKind, pan: number): void;
  setMasterLevel(level: number): void;
  setLoopStart(timeUs: number, durationUs: number): void;
  setLoopEnd(timeUs: number, durationUs: number): void;
  /** Both boundaries at once, for a drag: setting them one at a time makes a right-to-left drag fight the minimum length. */
  setLoop(startUs: number, endUs: number, durationUs: number): void;
  toggleLoop(): void;
  clearLoop(durationUs: number): void;
  saveSection(name: string): void;
  removeSection(id: string): void;
  /** One loop repetition finished: step the speed up, never past 1×. */
  rampSpeed(): void;
  zoomBy(steps: number): void;
  setLyricsFollowing(following: boolean): void;
  setChordsFollowing(following: boolean): void;
  setLeadMode(leadMode: StudioState["leadMode"]): void;
  applyPreset(preset: MixPreset): void;
  resetPractice(durationUs: number): void;
  hydratePractice(document: PracticeStateV1, durationUs: number): void;
  adjust(key: "speed" | "pitch" | "repetitions" | "pause" | "countIn" | "speedRamp" | "singScale", delta: number): void;
}

const stems: Record<StemKind, boolean> = { vocals: false, drums: false, bass: false, other: false };
const defaultLevels: Record<StemKind, number> = { vocals: 0, drums: 0, bass: -2.5, other: -4 };
const centered: Record<StemKind, number> = { vocals: 0, drums: 0, bass: 0, other: 0 };
const MIN_LOOP_US = 500_000;
const DEFAULT_CHORD_DISPLAY: ChordDisplay = { transposeSemitones: 0, complexity: "full", capo: 0 };
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
  chordView: "timeline",
  chordDisplay: { ...DEFAULT_CHORD_DISPLAY },
  target: "vocals",
  muted: { ...stems },
  soloed: { ...stems },
  levels: { ...defaultLevels },
  pan: { ...centered },
  masterLevel: 0,
  speed: 1,
  pitch: 0,
  repetitions: 4,
  pause: 2,
  countIn: 2,
  loopEnabled: false,
  loopStartUs: 0,
  loopEndUs: 30_000_000,
  sections: [],
  speedRamp: 0,
  zoom: 1,
  lyricsFollowing: true,
  chordsFollowing: true,
  singScale: 1,
  leadMode: "both",
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  toggleRecording: () => set((s) => ({ recording: !s.recording, playing: s.recording ? s.playing : true })),
  toggleMetronome: () => set((s) => ({ metronome: !s.metronome })),
  setTab: (tab) => set({ tab }),
  setPane: (pane) => set({ pane }),
  setChartId: (chartId) => set({ chartId }),
  setChordView: (chordView) => set({ chordView }),
  setChordDisplay: (change) => set((s) => ({ chordDisplay: { ...s.chordDisplay, ...change } })),
  // A different song, not a remount: the zoom and the chart belong to the song
  // that was open, and the pane and tab are how this user reads any song.
  openSong: (songId) => set((s) => (s.songId === songId ? {} : { songId, zoom: 1, chartId: null, chordDisplay: { ...DEFAULT_CHORD_DISPLAY }, chordsFollowing: true })),
  setTarget: (target) => set({ target }),
  toggleMute: (stem) => set((s) => ({ muted: { ...s.muted, [stem]: !s.muted[stem] } })),
  toggleSolo: (stem) => set((s) => ({ soloed: { ...s.soloed, [stem]: !s.soloed[stem] } })),
  setLevel: (stem, level) => set((s) => ({ levels: { ...s.levels, [stem]: level } })),
  setPan: (stem, pan) => set((s) => ({ pan: { ...s.pan, [stem]: Math.max(-1, Math.min(1, pan)) } })),
  setMasterLevel: (masterLevel) => set({ masterLevel: Math.max(-60, Math.min(0, masterLevel)) }),
  setLoopStart: (timeUs, durationUs) => set((state) => { const start = Math.max(0, Math.min(Math.round(timeUs), Math.max(0, durationUs - MIN_LOOP_US))); return { loopStartUs: start, loopEndUs: Math.min(durationUs, Math.max(state.loopEndUs, start + MIN_LOOP_US)), loopEnabled: true }; }),
  setLoopEnd: (timeUs, durationUs) => set((state) => { const end = Math.min(durationUs, Math.max(MIN_LOOP_US, Math.round(timeUs))); return { loopStartUs: Math.max(0, Math.min(state.loopStartUs, end - MIN_LOOP_US)), loopEndUs: end, loopEnabled: true }; }),
  setLoop: (startUs, endUs, durationUs) => {
    const start = Math.max(0, Math.min(Math.round(Math.min(startUs, endUs)), durationUs - MIN_LOOP_US));
    set({ loopStartUs: start, loopEndUs: Math.min(durationUs, Math.max(Math.round(Math.max(startUs, endUs)), start + MIN_LOOP_US)), loopEnabled: true });
  },
  toggleLoop: () => set((state) => ({ loopEnabled: !state.loopEnabled })),
  clearLoop: (durationUs) => set({ loopEnabled: false, loopStartUs: 0, loopEndUs: Math.max(MIN_LOOP_US, durationUs) }),
  // Kept in the order they were saved rather than by time: a practice session
  // works through a list the player built, not a table of contents.
  saveSection: (name) => set((state) => ({ sections: [...state.sections, { id: uuidV7(), name: name.trim().slice(0, 60), startTimeUs: state.loopStartUs, endTimeUs: state.loopEndUs }] })),
  removeSection: (id) => set((state) => ({ sections: state.sections.filter((section) => section.id !== id) })),
  // Practising at 0.6× is only useful on the way to full speed, so each pass
  // through the loop gets a little closer and the ramp stops when it arrives.
  rampSpeed: () => set((state) => (state.speedRamp ? { speed: Math.min(1, Math.round((state.speed + state.speedRamp / 100) * 100) / 100) } : {})),
  zoomBy: (steps) => set((state) => ({ zoom: stepZoom(state.zoom, steps) })),
  setLyricsFollowing: (lyricsFollowing) => set({ lyricsFollowing }),
  setChordsFollowing: (chordsFollowing) => set({ chordsFollowing }),
  setLeadMode: (leadMode) => set({ leadMode }),
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
    return { levels, pan: { ...centered }, muted: { ...stems }, soloed: { ...stems } };
  }),
  // Practice state only. These run whenever the page mounts, so anything view
  // shaped in here would be reset by a trip to the Library and back — that is
  // what `openSong` is for.
  resetPractice: (durationUs) => set({ target:"vocals",muted:{...stems},soloed:{...stems},levels:{...defaultLevels},pan:{...centered},speed:1,pitch:0,repetitions:4,pause:2,countIn:2,metronome:true,loopEnabled:false,loopStartUs:0,loopEndUs:Math.max(MIN_LOOP_US,durationUs),sections:[],speedRamp:0 }),
  hydratePractice: (document, durationUs) => set({ target:document.target,muted:{...stems},soloed:{...stems},levels:{...document.stemGainDb},pan:{...(document.stemPan??centered)},speed:document.speed,pitch:document.pitchSemitones,repetitions:document.repetitions,pause:document.pauseSeconds,countIn:document.countIn,metronome:document.metronome,loopEnabled:document.loop.enabled,loopStartUs:Math.min(document.loop.startTimeUs,Math.max(0,durationUs-MIN_LOOP_US)),loopEndUs:Math.min(durationUs,Math.max(document.loop.endTimeUs,MIN_LOOP_US)),sections:document.sections??[],speedRamp:document.speedRampPercent??0 }),
  adjust: (key, delta) => set((s) => {
    const ranges = { speed: [.5, 1, .05], pitch: [-12, 12, 1], repetitions: [1, 999, 1], pause: [0, 10, 1], countIn: [0, 4, 2], speedRamp: [0, 25, 1], singScale: [.7, 1.5, .1] } as const;
    const [min, max, step] = ranges[key];
    const value = Math.min(max, Math.max(min, Math.round(((s[key] + delta * step) + Number.EPSILON) * 100) / 100));
    return { [key]: value } as Pick<StudioState, typeof key>;
  }),
}));
