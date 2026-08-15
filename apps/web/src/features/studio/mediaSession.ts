import { useEffect } from "react";
import type { ImportedPlayback } from "./useImportedAudio";

/**
 * What the OS is told about where we are. `null` where there is nothing honest
 * to say: a position past the duration, or a duration of zero before the audio
 * has been decoded, is a TypeError out of `setPositionState` rather than a
 * no-op, and a zero rate is rejected the same way.
 */
export function positionState(currentTimeUs: number, durationUs: number, speed: number): MediaPositionState | null {
  const duration = durationUs / 1_000_000;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return { duration, position: Math.max(0, Math.min(currentTimeUs / 1_000_000, duration)), playbackRate: speed > 0 ? speed : 1 };
}

/**
 * Publishes the session to the OS: lock screen, headphone buttons, car
 * controls — and Bluetooth page-turner pedals, which send media keys and are
 * the closest thing to a foot switch this app will ever need to build.
 *
 * The shortcuts in `PlaybackSession` cover all of this from a keyboard, and a
 * keyboard is exactly what is out of reach with both hands on an instrument.
 *
 * Nothing here reads an `<audio>` element: the four-stem path is an AudioWorklet
 * graph, so the metadata, the playback state and the position are all pushed
 * from the same snapshot the UI draws. That keeps them honest through speed
 * changes and loop wraps, which a hidden media element would not survive.
 */
export function useMediaSession(playback: ImportedPlayback, title: string, artist: string, speed: number) {
  const { playing, currentTimeUs, durationUs, toggle, seekBy, seekTo } = playback;

  // Its own effect: rebuilding the metadata on every play and pause makes some
  // notification shades flash the whole card.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }] });
  }, [artist, title]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    // `play` and `pause` are separate actions and the OS can send either one at
    // any time — a car head unit re-sends `play` on reconnect — so each checks
    // the state it wants before toggling, or the button does the opposite.
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => { if (!playing) void toggle(); }],
      ["pause", () => { if (playing) void toggle(); }],
      ["seekbackward", (details) => seekBy(-(details.seekOffset ?? 10))],
      ["seekforward", (details) => seekBy(details.seekOffset ?? 10)],
      ["seekto", (details) => { if (details.seekTime !== undefined) seekTo(details.seekTime); }],
    ];
    // An unsupported action throws rather than being ignored, and one bad name
    // would take the rest of the handlers with it.
    for (const [action, handler] of actions) try { session.setActionHandler(action, handler); } catch { /* not supported here */ }
    return () => { for (const [action] of actions) try { session.setActionHandler(action, null); } catch { /* not supported here */ } };
  }, [playing, seekBy, seekTo, toggle]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    session.playbackState = playing ? "playing" : "paused";
    const state = positionState(currentTimeUs, durationUs, speed);
    if (state) session.setPositionState(state);
    // No cleanup: this runs on every position update, so clearing the state here
    // would blank the OS controls four times a second. The session goes away
    // with the page, which is the only time it should.
  }, [currentTimeUs, durationUs, playing, speed]);
}
