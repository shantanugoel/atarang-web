import type { BeatGridV1 } from "@atarang/contracts";

/**
 * Beat-grid arithmetic, kept apart from the hooks that use it because those
 * reach storage the moment they are imported and this has to stay testable.
 */

/**
 * Nearest beat to `timeUs`, or `timeUs` unchanged when there is no grid worth
 * trusting. A loop boundary a fraction of a beat off the bar is audible on every
 * repetition, and dragging cannot hit a beat by hand — so on a reliable grid the
 * snap is unconditional, and `bypass` (the Alt key) is the way to place a
 * boundary between beats.
 */
export function snapToBeat(timeUs: number, beatGrid?: BeatGridV1 | null, bypass = false) {
  if (bypass || !beatGrid?.reliable || !beatGrid.beats.length) return timeUs;
  let nearest = timeUs, distance = Infinity;
  // ponytail: linear scan over a few thousand beats per pointermove; binary
  // search if a grid ever gets long enough to show up in a frame budget.
  for (const beat of beatGrid.beats) {
    const gap = Math.abs(beat.timeUs - timeUs);
    if (gap >= distance) break;
    nearest = beat.timeUs; distance = gap;
  }
  return nearest;
}

/**
 * BPM from a series of tap times in milliseconds, or `null` until there is
 * enough to read.
 *
 * The median gap rather than the mean, because the tap that lands late while
 * someone finds the beat should not drag the tempo with it. Gaps outside
 * 30–300 BPM are a restart, not a tap.
 */
export function tapTempoBpm(taps: number[]) {
  const gaps = taps.slice(1).map((time, index) => time - taps[index]!).filter((gap) => gap >= 200 && gap <= 2000);
  if (gaps.length < 2) return null;
  const sorted = gaps.sort((a, b) => a - b), middle = sorted.length >> 1;
  return Math.round(60_000 / (sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2));
}
