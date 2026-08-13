import {beforeEach,describe,expect,test} from "bun:test";
import {useStudioStore} from "./studioStore";

const state=()=>useStudioStore.getState();
beforeEach(()=>{state().openSong(null);state().resetPractice(240_000_000);state().setTarget("vocals")});

describe("view state across a remount",()=>{
  // Opening the Library and coming back remounts the page, which re-runs the
  // practice hydration. Everything the user aimed has to survive that.
  test("hydrating practice state for the same song leaves the view alone",()=>{
    state().openSong("song-a");
    state().zoomBy(3);
    state().setTab("chords");
    state().setPane("mix");
    state().setChartId("chart-1");
    state().setLyricsFollowing(false);
    state().openSong("song-a");
    state().resetPractice(240_000_000);
    expect(state().zoom).toBe(8);
    expect(state().tab).toBe("chords");
    expect(state().pane).toBe("mix");
    expect(state().chartId).toBe("chart-1");
    expect(state().lyricsFollowing).toBe(false);
  });

  test("opening a different song drops what belonged to the last one",()=>{
    state().openSong("song-a");
    state().zoomBy(2);
    state().setChartId("chart-1");
    state().setTab("chords");
    state().openSong("song-b");
    expect(state().zoom).toBe(1);
    expect(state().chartId).toBeNull();
    // How this user reads a song, not a property of the song.
    expect(state().tab).toBe("chords");
  });
});

describe("loop drag",()=>{
  test("a right-to-left drag sets the same loop as a left-to-right one",()=>{
    state().setLoop(90_000_000,30_000_000,240_000_000);
    expect([state().loopStartUs,state().loopEndUs]).toEqual([30_000_000,90_000_000]);
    expect(state().loopEnabled).toBe(true);
  });
  test("a drag shorter than the minimum still leaves a loop worth playing",()=>{
    state().setLoop(10_000_000,10_050_000,240_000_000);
    expect(state().loopEndUs-state().loopStartUs).toBe(500_000);
  });
  test("clamps to the song, including a drag that ends past it",()=>{
    state().setLoop(-5_000_000,900_000_000,240_000_000);
    expect([state().loopStartUs,state().loopEndUs]).toEqual([0,240_000_000]);
  });
  test("a drag against the far end keeps the minimum length inside the song",()=>{
    state().setLoop(239_900_000,240_000_000,240_000_000);
    expect(state().loopStartUs).toBe(239_500_000);
    expect(state().loopEndUs).toBe(240_000_000);
  });
});

describe("saved sections",()=>{
  test("saves the loop exactly as it stands",()=>{
    state().setLoop(30_000_000,60_000_000,240_000_000);
    state().saveSection("  Chorus  ");
    expect(state().sections).toMatchObject([{name:"Chorus",startTimeUs:30_000_000,endTimeUs:60_000_000}]);
  });
  test("deleting one leaves the rest alone",()=>{
    state().saveSection("One");
    state().saveSection("Two");
    const[first,second]=state().sections;
    state().removeSection(first!.id);
    expect(state().sections.map(section=>section.id)).toEqual([second!.id]);
  });
});

describe("speed ramp",()=>{
  test("does nothing until it is turned on",()=>{
    state().adjust("speed",-4);
    const before=state().speed;
    state().rampSpeed();
    expect(state().speed).toBe(before);
  });
  test("steps toward full speed on each repetition and stops there",()=>{
    state().adjust("speed",-4);
    state().adjust("speedRamp",5);
    expect(state().speed).toBe(.8);
    state().rampSpeed();
    expect(state().speed).toBe(.85);
    for(let repetition=0;repetition<20;repetition++)state().rampSpeed();
    // Practising above the recording is not a thing, so 1x is the ceiling.
    expect(state().speed).toBe(1);
  });
});

describe("mix presets",()=>{
  test("pan is bounded and every preset returns the mix to centre",()=>{
    state().setPan("vocals",2);
    expect(state().pan.vocals).toBe(1);
    state().applyPreset("guide");
    expect(Object.values(state().pan)).toEqual([0,0,0,0]);
  });
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
