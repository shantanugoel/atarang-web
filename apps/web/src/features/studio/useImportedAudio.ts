import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OriginalRecord } from "../../storage/database";
import type { StemKind } from "@atarang/contracts";
import { fileForOpfsPath } from "../../storage/opfs";
import { getBlob } from "../../storage/repositories";
import { useStudioStore } from "./studioStore";

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
  meters?:Record<StemKind,number>;
  recording?:boolean;
  recordingError?:string;
  toggleRecording?():Promise<void>;
  toggle(): Promise<void>;
  seekBy(seconds: number): void;
  seekTo(seconds: number): void;
}

// A decode failure and a file the browser has thrown away are the same silence
// to the user, and only one of them has a way out. Saying "could not be decoded"
// for audio that is simply not there sends people to re-separate a song that
// needs re-importing.
const AUDIO_RECLAIMED ="This song’s audio is no longer on this device — the browser reclaimed the space. Re-import the source file from your Library to play it again.";

/**
 * Send the element back to A the moment it passes B.
 *
 * The A–B loop used to be held from React: `timeupdate` fires about four times
 * a second, the time went through state, and the seek came back an effect
 * later — a quarter of a second of the next bar, every pass, on a loop people
 * set to practise one phrase. So the element's own clock is read here instead,
 * per frame while it is playing and on every `timeupdate` in a hidden tab,
 * where frames stop. The four-stem engine loops inside the worklet and needs
 * none of this.
 *
 * A loop whose B sits at the song's last frame has one extra problem: the
 * element raises `ended` and stops itself before any of the checks above can
 * run again, and a paused element ignores every seek-based retry after that.
 * So `ended` gets its own pass, with permission to press play again.
 */
export function wrapLoop(audio: HTMLAudioElement, resume = false) {
  const { loopEnabled, loopStartUs, loopEndUs } = useStudioStore.getState();
  // A seek already on its way still reports the old time, and asking for the
  // same one again only restarts it.
  if (!loopEnabled || audio.seeking) return;
  if (!resume && audio.paused) return;
  if (audio.currentTime * 1_000_000 >= loopEndUs) {
    audio.currentTime = loopStartUs / 1_000_000;
    if (resume && audio.paused) void audio.play().catch(() => { /* The user asked to stop; stay stopped. */ });
  }
}

export function useLoopWrap(audioRef: RefObject<HTMLAudioElement | null>, playing: boolean) {
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function check() { frame = requestAnimationFrame(check); if (audioRef.current) wrapLoop(audioRef.current); });
    return () => cancelAnimationFrame(frame);
  }, [audioRef, playing]);
}

export function useImportedAudio(original?: OriginalRecord, speed = 1, volume = 1): ImportedPlayback {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState({ ready: false, playing: false, currentTimeUs: 0, durationUs: original?.durationUs ?? 0, error: "" });

  useEffect(() => {
    if (!original) { audioRef.current = null; setState({ ready: false, playing: false, currentTimeUs: 0, durationUs: 0, error: "" }); return; }
    // The record's own duration, until the element reports the decoded one. It
    // is right often enough to matter when the element never loads at all: with
    // zero here the transport falls back to its placeholder length and draws a
    // playhead against a song that does not exist.
    setState({ ready: false, playing: false, currentTimeUs: 0, durationUs: original.durationUs, error: "" });
    let cancelled = false;
    let objectUrl = "";
    const audio = new Audio();
    audio.preload = "auto";
    audio.playbackRate = speed;
    audio.volume = volume;
    audio.preservesPitch = true;
    audioRef.current = audio;
    const update = () => { wrapLoop(audio); setState((current) => ({ ...current, playing: !audio.paused, currentTimeUs: Math.round(audio.currentTime * 1_000_000), durationUs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1_000_000) : original.durationUs })); };
    const ready = () => setState((current) => ({ ...current, ready: true, error: "" }));
    const failed = (message: string) => setState((current) => ({ ...current, ready: false, playing: false, error: message }));
    const decodeFailed = () => failed("This stored audio could not be decoded by this browser.");
    // `update` also runs on `ended`, but by then the element is paused and
    // wrapLoop's ordinary pass skips it; only this one may press play again.
    const restart = () => wrapLoop(audio, true);
    for (const event of ["timeupdate", "play", "pause", "ended", "durationchange"]) audio.addEventListener(event, update);
    audio.addEventListener("ended", restart);
    audio.addEventListener("canplay", ready); audio.addEventListener("error", decodeFailed);
    void (async () => {
      const blob = await getBlob(original.blobId);
      // No record, or a record pointing at a file OPFS no longer has: both mean
      // the bytes are gone, whether or not the integrity sweep has run yet.
      const file = blob && await fileForOpfsPath(blob.opfsPath).catch(() => undefined);
      if (cancelled) return;
      if (!file) { failed(AUDIO_RECLAIMED); return; }
      objectUrl = URL.createObjectURL(file);
      audio.src = objectUrl;
      audio.load();
    })().catch(decodeFailed);
    return () => {
      cancelled = true; audio.pause(); audio.removeAttribute("src"); audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      for (const event of ["timeupdate", "play", "pause", "ended", "durationchange"]) audio.removeEventListener(event, update);
      audio.removeEventListener("ended", restart);
      audio.removeEventListener("canplay", ready); audio.removeEventListener("error", decodeFailed);
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [original]);
  useLoopWrap(audioRef, state.playing);
  useEffect(()=>{if(audioRef.current){audioRef.current.playbackRate=speed;audioRef.current.preservesPitch=true}},[speed]);
  useEffect(()=>{if(audioRef.current)audioRef.current.volume=Math.max(0,Math.min(1,volume))},[volume]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play(); else audio.pause();
  }, []);
  const seekBy = useCallback((seconds: number) => { const audio = audioRef.current; if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + seconds)); }, []);
  const seekTo = useCallback((seconds: number) => { const audio = audioRef.current; if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, seconds)); }, []);
  return { ...state, toggle, seekBy, seekTo };
}
