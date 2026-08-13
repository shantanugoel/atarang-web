import type { BeatGridV1 } from "@atarang/contracts";
import type { WaveformRecord } from "../../storage/database";

/** Each step halves the visible span. 64x puts about a bar on screen for a four-minute song. */
export const MAX_ZOOM = 64;
export const PEAKS_PER_SCREEN = 128;
const TICK_SECONDS = [.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

// The demo song has no analysis behind it, so its shape is synthesised. Sampling
// the same curve at any count keeps that shape steady while zooming.
const placeholder = (count: number) => Array.from({length: count}, (_, index) => { const position = index * PEAKS_PER_SCREEN / count; return 12 + Math.abs(Math.sin(position * 1.71) * 28 + Math.sin(position * .31) * 17); });

/**
 * Folds the pyramid down to `target` bar heights.
 *
 * The level nearest the requested resolution is picked, which is what makes zoom
 * cheap: a zoomed-in view reads a finer level rather than re-reading the audio.
 */
export function displayPeaks(waveform: WaveformRecord | null | undefined, target: number) {
  if (!waveform?.levels.length) return placeholder(target);
  // The coarsest level that still has a bucket per bar drawn. Nearest-length
  // would sometimes pick a level below the target and draw fewer bars than the
  // screen has room for, throwing away detail that was already computed.
  const coarseToFine = [...waveform.levels].sort((a, b) => a.max.length - b.max.length);
  const level = coarseToFine.find((candidate) => candidate.max.length >= target) ?? coarseToFine[coarseToFine.length-1]!;
  const count = Math.min(target, level.max.length);
  const raw = Array.from({length:count}, (_, output) => {
    const start = Math.floor(output * level.max.length / count); const end = Math.max(start+1, Math.floor((output+1)*level.max.length/count)); let peak=0;
    for (let index=start;index<end;index++) peak=Math.max(peak,Math.abs(level.min[index]??0),Math.abs(level.max[index]??0),level.rms[index]??0);
    return peak;
  });
  const maximum = Math.max(...raw, Number.EPSILON);
  return raw.map((peak) => Math.max(3, Math.min(52, 3 + peak / maximum * 46)));
}

/** Ruler marks on round times, spaced so roughly `visible` of them land on screen at this zoom. */
export function timeTicks(durationUs: number, zoom: number, visible = 5) {
  const seconds = Math.max(1, durationUs / 1_000_000), target = seconds / zoom / visible;
  const step = TICK_SECONDS.find((candidate) => candidate >= target) ?? Math.ceil(target / 300) * 300;
  return { step, ticks: Array.from({length: Math.floor(seconds / step) + 1}, (_, index) => index * step) };
}

export function formatTime(timeUs: number, decimals = 0) {
  const scale = 10 ** decimals, rounded = Math.round(Math.max(0, timeUs / 1_000_000) * scale) / scale;
  const minutes = Math.floor(rounded / 60), seconds = rounded - minutes * 60;
  return `${String(minutes).padStart(2,"0")}:${seconds < 10 ? "0" : ""}${seconds.toFixed(decimals)}`;
}

export const stepZoom = (zoom: number, steps: number) => Math.min(MAX_ZOOM, Math.max(1, zoom * 2 ** steps));

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
