import { useCallback, useEffect, useRef, useState } from "react";
import demoUrl from "../../assets/backbeat.mp3";
import type { ImportedPlayback } from "./useImportedAudio";

export const DEMO_TRACK = {
  title: "Backbeat",
  artist: "Kevin MacLeod",
  durationUs: 46_210_612,
  license: "CC0 / public domain",
  source: "https://en.freepd.cn/music/electronic",
  sha256: "3007058b62f48ffa5740452faf5474fca288930ddfbf56b4aff96859f5f565db",
} as const;

export function useDemoAudio(speed = 1, enabled = true, volume = 1): ImportedPlayback {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<Pick<ImportedPlayback, "ready" | "playing" | "currentTimeUs" | "durationUs" | "error">>({ ready: false, playing: false, currentTimeUs: 0, durationUs: DEMO_TRACK.durationUs, error: "" });

  useEffect(() => {
    if (!enabled) {
      audioRef.current = null;
      setState({ ready: false, playing: false, currentTimeUs: 0, durationUs: DEMO_TRACK.durationUs, error: "" });
      return;
    }
    const audio = new Audio(new URL(demoUrl, import.meta.url).href);
    audio.preload = "auto";
    audio.playbackRate = speed;
    audio.volume = volume;
    audio.preservesPitch = true;
    audioRef.current = audio;
    const update = () => setState((current) => ({ ...current, playing: !audio.paused, currentTimeUs: Math.round(audio.currentTime * 1_000_000), durationUs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1_000_000) : DEMO_TRACK.durationUs }));
    const ready = () => setState((current) => ({ ...current, ready: true, error: "" }));
    const failed = () => setState((current) => ({ ...current, ready: false, playing: false, error: "The bundled demo audio could not be decoded by this browser." }));
    for (const event of ["timeupdate", "play", "pause", "ended", "durationchange"]) audio.addEventListener(event, update);
    audio.addEventListener("canplay", ready);
    audio.addEventListener("error", failed);
    audio.load();
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      for (const event of ["timeupdate", "play", "pause", "ended", "durationchange"]) audio.removeEventListener(event, update);
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", failed);
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
      audioRef.current.preservesPitch = true;
    }
  }, [speed]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, volume)); }, [volume]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play(); else audio.pause();
  }, []);
  const seekBy = useCallback((seconds: number) => { const audio = audioRef.current; if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + seconds)); }, []);
  const seekTo = useCallback((seconds: number) => { const audio = audioRef.current; if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, seconds)); }, []);
  return { ...state, toggle, seekBy, seekTo };
}
