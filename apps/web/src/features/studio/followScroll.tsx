import { useEffect, useRef } from "react";
import { CrosshairSimple } from "@phosphor-icons/react";
import { useStudioStore } from "./studioStore";
import styles from "./followScroll.module.css";

// Keeps the active lyric line centred while playback moves, and stops as soon
// as the reader scrolls away themselves. The two are told apart by a deadline
// rather than by the event, because a scroll event carries no origin: a
// programmatic smooth scroll keeps firing events until it lands, so each one
// inside the window pushes the window out, and the first event after the
// animation has gone quiet is the reader's.
export function useFollowScroll<T extends HTMLElement>(active: number, enabled = true) {
  const following = useStudioStore((state) => state.lyricsFollowing),
    setFollowing = useStudioStore((state) => state.setLyricsFollowing),
    line = useRef<T>(null),
    autoScrollUntil = useRef(0);
  const scrollToActive = () => {
    autoScrollUntil.current = performance.now() + 600;
    // A view that scrolls itself every few seconds is the one piece of motion
    // here nobody can opt out of in CSS: the behaviour is an argument.
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    line.current?.scrollIntoView({ block: "center", behavior: reduced ? "instant" : "smooth" });
  };
  useEffect(() => {
    if (enabled && following && active >= 0) scrollToActive();
  }, [active, enabled, following]);
  return {
    line,
    following,
    // Resuming has to scroll as well: `following` may already be true from a
    // view that never moved, and then the effect above has nothing to react to.
    resume: () => { setFollowing(true); scrollToActive(); },
    onScroll: () => {
      if (!following) return;
      const now = performance.now();
      if (now < autoScrollUntil.current) autoScrollUntil.current = now + 150;
      else setFollowing(false);
    },
  };
}

// Sticky at the foot of the scroller it is dropped into, so it is on screen at
// the moment it is wanted — which is precisely the moment the lyrics, and any
// toolbar sitting with them, have been scrolled away from.
export function FollowResume({ follow }: { follow: Pick<ReturnType<typeof useFollowScroll>, "following" | "resume"> }) {
  if (follow.following) return null;
  return (
    <button className={styles.resume} onClick={follow.resume}>
      <CrosshairSimple weight="bold" aria-hidden />
      Back to playing
    </button>
  );
}
