import { useCallback, useEffect, useRef, useState } from "react";
import type { OriginalRecord } from "../../storage/database";
import { fileForOpfsPath } from "../../storage/opfs";
import { getBlob } from "../../storage/repositories";

export interface ImportedPlayback {
  ready: boolean;
  playing: boolean;
  currentTimeUs: number;
  durationUs: number;
  error: string;
  driftFrames?: number;
  underruns?: number;
  repetition?: number;
  metronomeClicks?:number;
  recording?:boolean;
  recordingError?:string;
  toggleRecording?():Promise<void>;
  toggle(): Promise<void>;
  seekBy(seconds: number): void;
  seekTo(seconds: number): void;
}

export function useImportedAudio(original?: OriginalRecord, speed = 1): ImportedPlayback {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState({ ready: false, playing: false, currentTimeUs: 0, durationUs: original?.durationUs ?? 0, error: "" });

  useEffect(() => {
    if (!original) { audioRef.current = null; setState({ ready: false, playing: false, currentTimeUs: 0, durationUs: 0, error: "" }); return; }
    let cancelled = false;
    let objectUrl = "";
    const audio = new Audio();
    audio.preload = "auto";
    audio.playbackRate = speed;
    audio.preservesPitch = true;
    audioRef.current = audio;
    const update = () => setState((current) => ({ ...current, playing: !audio.paused, currentTimeUs: Math.round(audio.currentTime * 1_000_000), durationUs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1_000_000) : original.durationUs }));
    const ready = () => setState((current) => ({ ...current, ready: true, error: "" }));
    const failed = () => setState((current) => ({ ...current, ready: false, playing: false, error: "This stored audio could not be decoded by this browser." }));
    for (const event of ["timeupdate", "play", "pause", "ended", "durationchange"]) audio.addEventListener(event, update);
    audio.addEventListener("canplay", ready); audio.addEventListener("error", failed);
    void (async () => {
      const blob = await getBlob(original.blobId);
      if (!blob) throw new Error("result_integrity_failed");
      const file = await fileForOpfsPath(blob.opfsPath);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(file);
      audio.src = objectUrl;
      audio.load();
    })().catch(failed);
    return () => {
      cancelled = true; audio.pause(); audio.removeAttribute("src"); audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      for (const event of ["timeupdate", "play", "pause", "ended", "durationchange"]) audio.removeEventListener(event, update);
      audio.removeEventListener("canplay", ready); audio.removeEventListener("error", failed);
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [original]);
  useEffect(()=>{if(audioRef.current){audioRef.current.playbackRate=speed;audioRef.current.preservesPitch=true}},[speed]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play(); else audio.pause();
  }, []);
  const seekBy = useCallback((seconds: number) => { const audio = audioRef.current; if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + seconds)); }, []);
  const seekTo = useCallback((seconds: number) => { const audio = audioRef.current; if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, seconds)); }, []);
  return { ...state, toggle, seekBy, seekTo };
}
