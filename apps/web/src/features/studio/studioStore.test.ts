import {beforeEach,describe,expect,test} from "bun:test";
import {useStudioStore} from "./studioStore";

const state=()=>useStudioStore.getState();
beforeEach(()=>{state().resetPractice(240_000_000);state().setTarget("vocals")});

describe("mix presets",()=>{
  test("Learn lifts the selected stem and lowers the band, without muting it",()=>{
    state().setTarget("bass");
    state().applyPreset("learn");
    expect(state().levels.bass).toBeGreaterThan(state().levels.drums);
    expect(state().levels.bass).toBeGreaterThan(state().levels.other);
    // Muting the rest would leave nothing to play along to.
    expect(Object.values(state().muted)).toEqual([false,false,false,false]);
  });

  test("Learn follows the stem the player selected",()=>{
    state().setTarget("drums");
    state().applyPreset("learn");
    const drumsForward=state().levels.drums;
    state().setTarget("vocals");
    state().applyPreset("learn");
    expect(state().levels.vocals).toBe(drumsForward);
    expect(state().levels.drums).toBeLessThan(drumsForward);
  });

  test("Guide drops the vocal to a cue without touching the band",()=>{
    const before={...state().levels};
    state().applyPreset("guide");
    expect(state().levels.vocals).toBeLessThan(before.vocals-10);
    expect(state().levels.drums).toBe(before.drums);
    expect(state().levels.bass).toBe(before.bass);
    expect(state().levels.other).toBe(before.other);
  });

  test("Play along silences only the selected stem",()=>{
    state().setTarget("other");
    state().applyPreset("playAlong");
    expect(state().levels.other).toBe(-60);
    expect(state().levels.vocals).toBe(0);
    // Through the fader, not the mute flag, because only the fader is persisted.
    expect(Object.values(state().muted)).toEqual([false,false,false,false]);
  });

  test("every preset is a whole mix, so Balanced is always the way back",()=>{
    const defaults={...state().levels};
    state().setTarget("bass");
    for(const preset of ["learn","guide","playAlong"] as const){
      state().applyPreset(preset);
      state().applyPreset("balanced");
      expect(state().levels).toEqual(defaults);
      expect(Object.values(state().muted)).toEqual([false,false,false,false]);
      expect(Object.values(state().soloed)).toEqual([false,false,false,false]);
    }
  });

  test("applying one preset after another does not compound",()=>{
    state().setTarget("bass");
    state().applyPreset("learn");
    const once={...state().levels};
    state().applyPreset("learn");
    expect(state().levels).toEqual(once);
  });
});
