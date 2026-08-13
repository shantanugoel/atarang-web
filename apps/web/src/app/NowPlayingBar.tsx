import { ArrowCounterClockwise, MusicNotes, Pause, Play } from "@phosphor-icons/react";
import { Link } from "react-router";
import { DEMO_TRACK } from "../features/studio/useDemoAudio";
import { usePlaybackSession } from "../features/studio/PlaybackSession";
import { formatTime } from "../features/studio/waveformView";
import styles from "./NowPlayingBar.module.css";

/**
 * What is playing, while you are somewhere else.
 *
 * Only outside the Studio, where the transport is already this bar with a
 * waveform attached, and only once there is a session to describe — an empty
 * bar on a first visit to the Library is furniture, not information.
 */
export function NowPlayingBar() {
  const { original, playback, started } = usePlaybackSession();
  if (!started || !playback.ready) return null;
  const durationUs = playback.durationUs || original?.durationUs || DEMO_TRACK.durationUs;
  return (
    <section className={styles.bar} aria-label="Now playing">
      <Link className={styles.song} to={original ? `/studio/${original.id}` : "/studio"}>
        <span className={styles.art}><MusicNotes weight="fill" aria-hidden /></span>
        <span>
          <strong>{original?.title ?? DEMO_TRACK.title}</strong>
          <small>{original?.artist ?? DEMO_TRACK.artist}</small>
        </span>
      </Link>
      <div className={styles.controls}>
        <button onClick={() => playback.seekBy(-10)} aria-label="Rewind 10 seconds"><ArrowCounterClockwise /></button>
        <button className={styles.play} onClick={() => void playback.toggle()} aria-label={playback.playing ? "Pause" : "Play"} aria-pressed={playback.playing}>
          {playback.playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button className={styles.forward} onClick={() => playback.seekBy(10)} aria-label="Forward 10 seconds"><ArrowCounterClockwise /></button>
      </div>
      <div className={styles.scrub}>
        <time>{formatTime(playback.currentTimeUs)}</time>
        {/* A native range: keyboard seeking, touch targets and a11y for free. */}
        <input
          type="range"
          min={0}
          max={Math.round(durationUs / 1_000_000)}
          value={Math.round(playback.currentTimeUs / 1_000_000)}
          aria-label="Seek"
          onChange={(event) => playback.seekTo(Number(event.target.value))}
        />
        <time>{formatTime(durationUs)}</time>
      </div>
    </section>
  );
}
