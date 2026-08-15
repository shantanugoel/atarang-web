import { describe, expect, test } from "bun:test";
import { positionState } from "./mediaSession";

describe("positionState", () => {
  test("reports seconds and the current speed", () => {
    expect(positionState(12_500_000, 46_210_612, 0.7)).toEqual({ duration: 46.210612, position: 12.5, playbackRate: 0.7 });
  });
  test("says nothing before the duration is known", () => {
    expect(positionState(0, 0, 1)).toBeNull();
    expect(positionState(0, Number.NaN, 1)).toBeNull();
    expect(positionState(0, Number.POSITIVE_INFINITY, 1)).toBeNull();
  });
  test("clamps a position outside the song rather than throwing at the OS", () => {
    expect(positionState(99_000_000, 46_000_000, 1)?.position).toBe(46);
    expect(positionState(-1_000, 46_000_000, 1)?.position).toBe(0);
  });
  test("never reports a zero rate, which the API rejects", () => {
    expect(positionState(0, 46_000_000, 0)?.playbackRate).toBe(1);
  });
});
