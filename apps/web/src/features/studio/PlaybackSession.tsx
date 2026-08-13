import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { matchPath, useLocation } from "react-router";
import type { OriginalRecord, SeparationRecord, WaveformRecord } from "../../storage/database";
import { getOriginal } from "../../storage/repositories";
import { useSeparation } from "../separation/useSeparation";
import { useBeatGrid } from "./useBeatGrid";
import { useDemoAudio } from "./useDemoAudio";
import { useImportedAudio, type ImportedPlayback } from "./useImportedAudio";
import { usePracticePersistence } from "./usePracticePersistence";
import { useSeparatedAudio } from "./useSeparatedAudio";
import { useStudioStore } from "./studioStore";
import { useWaveform } from "./useWaveform";
import type { BeatGridV1 } from "@atarang/contracts";

export interface PlaybackSession {
  /** `undefined` while the record is being opened, `null` for the bundled demo. */
  original: OriginalRecord | null | undefined;
  playback: ImportedPlayback;
  waveform: WaveformRecord | null;
  waveformStatus: "idle" | "analyzing" | "ready" | "error";
  /** Re-runs the waveform/beat/chord pass after a failure. */
  retryAnalysis(): void;
  beatGrid: BeatGridV1 | null | undefined;
  setTempo(bpm: number): void;
  separation: SeparationRecord | null | undefined;
  /** True once this song has been played, which is what makes it worth describing elsewhere. */
  started: boolean;
}

const Context = createContext<PlaybackSession | null>(null);

export function usePlaybackSession() {
  const session = useContext(Context);
  if (!session) throw new Error("playback_session_missing");
  return session;
}

/**
 * Owns the song, the audio and the shortcuts, above the router outlet.
 *
 * Playing something and then opening the Library used to stop the music, because
 * the audio element and the four-stem engine were created inside the Studio
 * route and torn down with it. Every player people already know keeps playing
 * while they browse, so the session lives here and the route only draws it.
 *
 * The song is read from the store rather than the URL: the Library route has no
 * song in its path, and what is playing has to outlive the page that started it.
 */
export function PlaybackSessionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // On the Studio route the URL says which song; anywhere else the store
  // remembers the one that is playing. Read during render, not in an effect, so
  // opening a song never shows the previous one for a frame first.
  const studioMatch = matchPath("/studio/:songId?", pathname);
  const routeSongId = studioMatch ? studioMatch.params.songId ?? null : undefined;
  const storedSongId = useStudioStore((state) => state.songId);
  const songId = routeSongId === undefined ? storedSongId : routeSongId;
  const speed = useStudioStore((state) => state.speed);
  const masterLevel = useStudioStore((state) => state.masterLevel);
  const toggleMetronome = useStudioStore((state) => state.toggleMetronome);
  const toggleRecording = useStudioStore((state) => state.toggleRecording);
  const setLoopStart = useStudioStore((state) => state.setLoopStart);
  const setLoopEnd = useStudioStore((state) => state.setLoopEnd);
  const loopEnabled = useStudioStore((state) => state.loopEnabled);
  const loopStartUs = useStudioStore((state) => state.loopStartUs);
  const loopEndUs = useStudioStore((state) => state.loopEndUs);
  const [original, setOriginal] = useState<OriginalRecord | null | undefined>(songId ? undefined : null);
  // The demo is a megabyte of audio. Someone who only opens the Library should
  // not fetch it, so it waits until the Studio has been opened at least once.
  const [studioOpened, setStudioOpened] = useState(pathname.startsWith("/studio"));
  const [started, setStarted] = useState(false);
  const lastRepetition = useRef(1);

  const waveform = useWaveform(original ?? undefined);
  const beats = useBeatGrid(original ?? undefined);
  const separation = useSeparation(original ?? undefined);
  const importedPlayback = useImportedAudio(separation === null ? original ?? undefined : undefined, speed, 10 ** (masterLevel / 20));
  const separatedPlayback = useSeparatedAudio(separation ?? undefined, beats.grid);
  const demoPlayback = useDemoAudio(speed, original === null && studioOpened, 10 ** (masterLevel / 20));
  const playback = original ? (separation ? separatedPlayback : importedPlayback) : demoPlayback;
  const playbackToggle = playback.toggle;
  const playbackSeekBy = playback.seekBy;

  usePracticePersistence(original ?? undefined, playback.currentTimeUs, playback.playing, playback.ready, playback.seekTo);

  useEffect(() => { if (routeSongId !== undefined) { setStudioOpened(true); useStudioStore.getState().openSong(routeSongId); } }, [routeSongId]);
  useEffect(() => { let active = true; setStarted(false); if (!songId) { setOriginal(null); return; } setOriginal(undefined); void getOriginal(songId).then((record) => { if (active) setOriginal(record ?? null); }); return () => { active = false; }; }, [songId]);
  useEffect(() => { if (playback.playing) setStarted(true); }, [playback.playing]);
  // The worklet counts the repetitions, so the ramp reacts to a pass actually
  // finishing rather than to a timer. A seek resets the count, which is a
  // decrease and so never steps the speed — and a new song or a fresh engine
  // starts counting from one again, so the mark has to go back with it or the
  // ramp sits dead for as many passes as the last song reached.
  useEffect(() => { lastRepetition.current = 1; }, [original, separation]);
  useEffect(() => { const repetition = playback.repetition ?? 1; if (repetition > lastRepetition.current) useStudioStore.getState().rampSpeed(); lastRepetition.current = repetition; }, [playback.repetition]);
  useEffect(() => { if (separation === null && playback.playing && loopEnabled && playback.currentTimeUs >= loopEndUs) playback.seekTo(loopStartUs / 1_000_000); }, [loopEnabled, loopEndUs, loopStartUs, playback.currentTimeUs, playback.playing, playback.seekTo, separation]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      // Space is how a keyboard user presses the button they are on. These
      // shortcuts now reach every page, so taking it would break Import, the
      // tabs and every other control the moment they have focus.
      if (event.code === "Space" && target?.closest("button, a[href], [role='button'], summary")) return;
      if (event.code === "Space" || event.key.toLowerCase() === "k") { event.preventDefault(); void playbackToggle(); }
      if (event.key.toLowerCase() === "j") playbackSeekBy(-10);
      if (event.key.toLowerCase() === "l") playbackSeekBy(10);
      if (event.key.toLowerCase() === "i" && original) setLoopStart(playback.currentTimeUs, original.durationUs);
      if (event.key.toLowerCase() === "o" && original) setLoopEnd(playback.currentTimeUs, original.durationUs);
      if (event.key.toLowerCase() === "m") toggleMetronome();
      if (event.key.toLowerCase() === "r") { if (playback.toggleRecording) void playback.toggleRecording(); else if (!original) toggleRecording(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [original, playback.currentTimeUs, playbackSeekBy, playbackToggle, setLoopEnd, setLoopStart, toggleMetronome, toggleRecording]);

  return <Context.Provider value={{ original, playback, waveform: waveform.waveform, waveformStatus: waveform.status, retryAnalysis: waveform.retry, beatGrid: beats.grid, setTempo: beats.setTempo, separation, started }}>{children}</Context.Provider>;
}
