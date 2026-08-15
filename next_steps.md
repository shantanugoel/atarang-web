# Next steps

Eighteen things worth considering after v1, ranked. The last five are the ones to
turn down on purpose — a roadmap without them is just a wishlist.

The numbering has gaps because it is the original numbering, and the missing
numbers shipped: PWA icons (01), screen wake lock (02), Media Session controls
(03), the dead Contributing links (05), the `?` shortcut sheet (06), the
update-available prompt (07), word-level LRC (09), the chromatic tuner (12) and
the light theme with motion preferences (17). Item 14 is still here because only
half of it was done — the touch ergonomics, not the iPad Safari verification.

Effort is in developer-days. Impact and ROI are 1–5, higher is better;
complexity is 1–5, higher is worse.

---

## Tier 0 — finish what v1 already claims

### 04. There is no CI, and the gates are honour-system — ~1 d

No `.github/` directory exists. The gates themselves all exist as scripts —
`typecheck`, `test`, `test:e2e`, and the OpenAPI snapshot regeneration — and the
README now says plainly that nothing enforces them.

**Why:** This is one workflow file wiring up what is already written. Two things
have already rotted unnoticed for want of it: two e2e assertions that had stopped
matching the app, and a service worker whose scope had been wrong since it was
written. The Playwright specs are the ones most likely to rot, and they are
exactly what a human skips before pushing.

**Why not:** Solo project, and the checks run locally today.

**Watch out for:**
- Playwright in CI needs the COOP/COEP headers the preview server sends.
- The e2e build has to be made with `ATARANG_BACKEND_URL=` (empty), or every page
  load probes the real backend and the CORS failure fails each test that asserts
  an empty console.
- There are three Playwright projects now — desktop, phone, and a coarse-pointer
  tablet — and the tablet one only runs the shell spec.
- `chords-eval` and the separation spec are slow and gated behind their own
  environment flags; decide deliberately whether CI runs them.

---

### 26. The per-song lease refuses same-tab work, and blames another tab — ~0.5 d

Arriving in the Studio starts waveform analysis, which takes
`withSongMutationLease` on the song. Importing lands on `/studio/<id>?separate=1`,
which opens the separation sheet on arrival. Press Start before analysis
finishes and separation is refused with "This song is already being processed in
another tab. Close the other tab or wait for it to finish." There is no other
tab. It is this one, running analysis, and the advice cannot help.

**Why:** It sits on the main import path — the sheet opens at the exact moment
analysis is running, so the reader is invited to press the button that will
fail. The message is not merely unclear, it is false, and it sends someone
hunting for a tab that does not exist.

**Why not:** It is recoverable by pressing Start again, and the model check
often takes long enough that analysis has finished first, so it hits fast
clickers and slow devices rather than everyone.

**Watch out for:**
- The lease is `ifAvailable: true`, so it refuses instead of queueing. Queueing
  for same-tab work is probably the fix; a lease that waits changes the meaning
  of every caller, so check `separationImporter` too.
- Failing here is at least clean: the lease wraps `runUnlocked` from outside, so
  no operation record is written and no partial stems exist.
- The message is right for the case it was written for — a genuinely different
  tab. Keep that wording for the cross-tab case and distinguish the two.

### 27. `ensureWaveform` claims its lease after three awaits — ~0.5 d

`ensureWaveform` checks the in-flight map only after awaiting the waveform, beat
grid and chord lookups. It is called from `useWaveform` and `useBeatGrid`, which
mount together, so both can pass the check and both claim the lease. One wins
and analyses; the other is refused.

**Why:** The two callers fail differently, and one does not recover.
`useBeatGrid` subscribes to the library, so when the winner's analysis lands it
refreshes and picks up the real grid. `useWaveform` has no subscription: it sets
`status: "error"` and stays there, offering "Retry chord detection" for an
analysis that in fact succeeded and is already in the database.

**Why not:** No data is lost or wrong — the winner writes the real analysis, and
retry returns instantly because `ensureWaveform` then finds it current.

**Watch out for:**
- The fix is to claim the in-flight slot synchronously, before the awaits, not
  to widen the lease.
- Both callers overwrite `active` with their own promise, so the map can end up
  holding the rejected one; whatever replaces this should set it once.
- Reproduces on first open of a newly imported song, which is also when someone
  is most likely to be watching.

---

## Tier 1 — the next real features

Each of these sits on machinery that exists — the section list, the backup
writer, the beat grid, the repetition counter in the worklet. That's the filter:
features whose hard part is already done and shipped.

### 08. Practice runlist — chain the sections you saved — ~3 d

`studioStore` already holds named `sections`, kept deliberately in save order
because "a practice session works through a list the player built". But recalling
one is a one-shot jump: play it, then reach for the screen again. The store also
already has `repetitions`, `pause`, `countIn` and `speedRamp` — every ingredient
of an automated drill.

**Why:** Advance to the next section when the repetition count is met, and the
list becomes a session you press play on once. This is the feature the existing
data model was clearly reaching for.

**Why not:** Section transitions have to be sample-accurate through the worklet's
loop counter, and per-section overrides (this passage at 0.6×, that one at 0.9×)
expand `PracticeStateV1` — a schema change with backup/restore consequences. Ship
the naive version first: same speed, same reps, just advance.

### 10. Song packs — share the work without the audio — ~2 d

`createBackup(includeMedia = false)` already exists and already writes a verified,
schema-checked zip. A per-song variant of it — lyrics, chord chart, sections,
practice state, beat grid, no copyrighted audio — is a small addition to a format
that's built and tested.

**Why:** A teacher sends a student the loop points and the chart; the student
supplies their own copy of the song. It's the one sharing feature that doesn't
contradict the product's local-first, rights-respecting stance, because nothing
transferable is anyone's recording.

**Why not:** Needs a matching rule for "is this the same song" — the content hash
exists, and `healMissingAudio` already solves the near-identical problem of
re-attaching a re-imported file. Reuse that or it becomes a fuzzy-matching
project.

### 11. Meter beyond 4/4 — ~4 d

`beatDetection.ts` says it outright: the downbeat logic assumes 4/4, and the beat
grid contract assumes it too. The metronome, the count-in and every downbeat
marker on the waveform inherit that. Waltzes, 6/8 ballads and anything in 5 are
quietly wrong.

**Why:** Whole genres are currently mis-served — and silently, which is worse than
being unsupported. A user-set meter is most of the value; automatic detection is
the expensive half and can wait.

**Why not:** It reaches into `BeatGridV1`, the worklet's metronome scheduling and
the count-in. Do the manual override first and see whether detection is ever
missed.

### 13. Practice history — ~4 d

The worklet already counts loop repetitions and the session already knows which
section is playing at what speed. Recording "you spent 40 minutes on the bridge
this week, and you're up from 0.7× to 0.9×" is mostly persistence, not new
measurement.

**Why:** Speed progress on a specific passage is the one metric that actually
reflects practice, and it's already being tracked in memory and thrown away.

**Why not:** This is where practice apps get bloated — streaks, badges, goals,
charts. It also adds a per-session table that backup, restore and the storage
totals all have to account for. Ship a single sentence per song, and only build
more if the sentence gets used.

---

## Tier 2 — worth doing, not worth doing next

Real value, real cost, and none of them urgent. Ordered by how much reach they buy
per week of work.

### 14. Verify the engine on real iPad Safari — ~3 d

The touch ergonomics half of this shipped: coarse-pointer sizing across the
practice steppers, mixer and loop lane, `touch-action` on the faders, and a third
Playwright project at 1024px with a coarse pointer. What did not ship is the part
that needs hardware — every test above runs in Chromium, and Chromium is not where
this breaks.

**Why:** A tablet on a music stand is the natural home of the app, and it is now
the only supported layout whose engine has never been run on the browser it will
actually meet.

**Why not:** iPad Safari is where cross-origin isolation, OPFS quota and
`SharedArrayBuffer` get least forgiving, and the whole four-stem engine depends on
all three. This is a verification budget, not a build one — expect the output to
be a list of new work rather than a green run.

**Watch out for:** OPFS quota behaviour under memory pressure, whether a 126 MB
model download survives a backgrounded tab, and recording, which needs isolation
*and* a microphone permission Safari treats differently.

### 15. Chord diagrams beyond six strings — ~6 d

`shapes.ts` is explicitly a guitar catalogue ported from iOS — six frets, low E
first, hardcoded through the shape type, the spelling logic and the user chord
library. Ukulele, bass and a piano keyboard view are the same detected chords
drawn differently.

**Why:** Chord detection, transposition, capo and simplification are the expensive
parts and they're instrument-agnostic already. This is presentation on top of
solved analysis, and it roughly doubles the addressable player.

**Why not:** "Six entries, low E first" runs through the type system, the
catalogue, the spelling tests and the saved user chords. Piano is a different
renderer entirely, not a different tuning. Do ukulele first — it's the same
fretboard renderer with four strings — and treat piano as separate work.

### 16. Six-stem separation — ~10 d

Everything is four-way: the `StemKind` union, the mixer, the presets, the
separation manifest, the package importer's per-stem error codes. `htdemucs_6s`
adds guitar and piano.

**Why:** "Mute the guitar and play the part" is the single most requested thing in
this category of app, and the Play-along preset — which silences whichever stem
you selected — is already built for exactly that gesture. Today a guitarist gets
"other".

**Why not:** A larger checkpoint against a 126 MB budget that already has to fit
browser memory, slower inference on devices that barely qualify now, and six-stem
quality is audibly worse than four on the stems that already worked. Also a
migration: existing separations stay four-stem forever.

### 18. Setlists — ~4 d

The Library groups by asset type — Originals, Separated, Performances — which is
how the storage is organised, not how a gig or a lesson plan is. There's no
user-defined ordering anywhere.

**Why:** A named, ordered list of songs, played through, is the other half of
"practice session" that the runlist covers within a song. Simple schema, obvious
UI.

**Why not:** Adds a table, a page and backup surface for something a browser
bookmark folder approximates. Only worth it once a library is big enough to need
it — and it should probably wait for the runlist, which solves the more common
problem.

### 19. Take punch-in and comping — ~8 d

Recording captures a dual dry-mic/backing stream per take, with trim, fades and
gain in `TakesWorkspace`. What it can't do is re-record one phrase inside an
otherwise good take, or assemble a keeper from several.

**Why:** It's what you actually want after the fourth take, and the A–B loop
machinery already defines exactly the region a punch-in would replace.

**Why not:** Crossfades, alignment and a multi-region manifest — a genuine editor,
and every user has a DAW that does it better. The take list also shows a static
waveform icon rather than a waveform; drawing the real one is a fraction of the
cost and probably most of the felt benefit.

### 20. MIDI export of chords and beat grid — ~2 d

Detected chords carry times, the beat grid carries a tempo map. Writing a type-1
MIDI file with a chord track and a tempo track is roughly a hundred lines and no
dependency.

**Why:** Cheap, self-contained, and it makes the analysis useful outside the app —
drop the tempo map into a DAW and the session lines up.

**Why not:** Serves a narrow, DAW-owning slice of users, and it's an export path to
maintain. Genuinely optional — do it on an afternoon when it sounds fun, not as
planned work.

---

## Tier 3 — decide against these now

Each of these will get suggested. Writing down the reason now is cheaper than
re-arguing it in six months, and two of them would actively damage what the
product is.

### 21. Accounts and cloud sync — months

The README already enumerates the cost precisely: identity and sessions, per-user
job ownership, rate limits, abuse controls, consent records, revocation, and a
policy for source-cache sharing. That list is the answer.

**Why not:** "Your music stays in this browser" is the product's actual position,
not a limitation of it. Backup, restore and song packs cover the real need —
getting your work onto another machine — without becoming a service that holds
other people's music and needs a lawyer.

### 22. Real notation — MusicXML, transcription, a score view — months

**Why not:** The "Sheet" tab is plain lyrics, and that's the honest scope. Turning
stems into readable notation means polyphonic transcription plus rhythm
quantisation plus engraving — three hard problems, each of which is somebody's
whole company. A chord chart over synced lyrics is what this analysis can actually
support, and it already ships. Bad notation is worse than none, because a player
will try to read it.

### 23. Per-stem EQ, reverb, amp simulation — ~10 d

**Why not:** The mixer exists to make a stem audible enough to learn from — level,
pan, solo, mute, and four presets that each say something musical. Effects are for
making a mix sound good, which is a different job that every DAW already does.
Adding a chain also puts new DSP in the path of a worklet that currently has to
stay real-time under speed and pitch shifting, and that budget is spent. The one
exception worth reconsidering: a gentle high-pass on the backing during recording,
if takes come back muddy.

### 24. Native iOS/Android wrappers — ~15 d plus store upkeep

**Why not:** Icons, wake lock and Media Session now ship, and they delivered most
of what "feels like a native app" means here for about two days of work — the
install has an icon, the screen stays awake through a loop, and a Bluetooth
page-turner pedal drives the transport. A wrapper adds store review, two release
channels, and a signing identity, and it doesn't fix the one thing that would
actually justify it: cross-origin isolation and `SharedArrayBuffer` inside a
webview. Revisit only if item 14's verification finds iPad Safari to be a hard
blocker.

### 25. Automated performance scoring — a "practice coach" — ~15 d

**Why not:** Grading a take against the original needs reliable polyphonic pitch
and onset alignment on a dry mic in a room, and the failure mode is telling a
player they're wrong when they aren't — which destroys trust in the whole app, not
just the score. The product's existing stance is better and is stated in the code:
a made-up chord box is worse than no box. Same logic, higher stakes. If anything
here, it's a non-judgemental loudness/timing overlay against the beat grid — data,
not a grade.

---

## Summary

| # | Item | Tier | Impact | ROI | Cplx | Effort | Why | Why not | Watch out for |
|---|---|---|---|---|---|---|---|---|---|
| 04 | CI workflow | Fix v1 | 4 | 4 | 2 | 1 d | No `.github/` exists; two things have already rotted unnoticed. | Solo project, checks run locally. | COOP/COEP headers, an empty `ATARANG_BACKEND_URL`, and three Playwright projects. |
| 26 | Lease refuses same-tab work | Fix v1 | 4 | 5 | 1 | 0.5 d | On the import path, and the message blames a tab that does not exist. | Recoverable by pressing Start again. | `ifAvailable` refuses rather than queues; keep the real cross-tab wording. |
| 27 | `ensureWaveform` races itself | Fix v1 | 3 | 4 | 2 | 0.5 d | Two hooks claim the same lease; `useWaveform` offers retry for analysis that succeeded. | No data lost; retry returns instantly. | Claim the in-flight slot before the awaits, not by widening the lease. |
| 08 | Practice runlist | Next | 5 | 4 | 3 | 3 d | Sections, reps, pause and ramp all exist; nothing chains them. | Per-section overrides mean a schema change. | Ship without per-section speed first; watch `PracticeStateV1` and backups. |
| 10 | Song packs (no audio) | Next | 4 | 5 | 2 | 2 d | `createBackup(false)` already does the hard part. | Needs a same-song matching rule. | Reuse the content hash and `healMissingAudio`, don't invent matching. |
| 11 | Meter beyond 4/4 | Next | 3 | 3 | 3 | 4 d | Code admits the 4/4 assumption; waltzes are silently wrong. | Reaches into contract, worklet and count-in. | Manual override first; automatic detection may never be needed. |
| 13 | Practice history | Next | 3 | 2 | 3 | 4 d | Repetitions and speed are already tracked, then discarded. | Where practice apps get bloated. | One sentence per song. No streaks, no badges. New table hits backup. |
| 14 | Verify on iPad Safari | Later | 5 | 3 | 4 | 3 d | The supported layout whose engine has never met the browser it will run in. | A verification budget, not a build one. | Isolation, OPFS quota, `SharedArrayBuffer`, and recording's permissions. |
| 15 | Ukulele / bass / piano chords | Later | 4 | 3 | 3 | 6 d | Detection is instrument-agnostic; only drawing is guitar-bound. | "Six strings, low E first" runs through the type system. | Ukulele first. Piano is a separate renderer, not a tuning. |
| 16 | Six-stem separation | Later | 5 | 2 | 5 | 10 d | Guitarists get "other" today; Play-along is built for this gesture. | Bigger model, slower, worse on the stems that worked. | Four-way `StemKind` is everywhere; old separations never migrate. |
| 18 | Setlists | Later | 3 | 2 | 2 | 4 d | Library groups by storage type, not by how a session is planned. | A bookmark folder approximates it. | Wait for the runlist — it solves the more common problem. |
| 19 | Punch-in / comping | Later | 2 | 2 | 4 | 8 d | What you want after the fourth take; A–B already defines the region. | It's a DAW feature, and users have DAWs. | Draw the real take waveform first — a fraction of the cost, most of the benefit. |
| 20 | MIDI export | Later | 2 | 3 | 1 | 2 d | Chord times and tempo map already exist; ~100 lines, no dependency. | Narrow audience. | An afternoon's fun, not planned work. |
| 21 | Accounts and cloud sync | Decline | 3 | 1 | 5 | months | Would let a library follow a user across devices. | The README already lists the full cost; local-first is the position, not a gap. | Backup, restore and song packs already cover the real need. |
| 22 | Notation / MusicXML | Decline | 2 | 1 | 5 | months | Frequently requested by readers of standard notation. | Transcription + quantisation + engraving are three separate hard problems. | Bad notation is worse than none — players will try to read it. |
| 23 | Per-stem effects | Decline | 1 | 1 | 4 | 10 d | Sounds like a natural mixer extension. | The mixer's job is audibility, not mix quality; the worklet's budget is spent. | Possible exception: a high-pass on the backing during recording. |
| 24 | Native app wrappers | Decline | 2 | 1 | 4 | 15 d + | Store presence and a native-feeling install. | Icons, wake lock and Media Session already delivered most of that. | Revisit only if item 14 finds iPad Safari blocks outright. |
| 25 | Automated performance scoring | Decline | 2 | 1 | 5 | 15 d | The obvious "AI feature" for a practice app. | Needs reliable polyphonic pitch on a room mic; wrong grades destroy trust app-wide. | If anything: a non-judgemental timing overlay against the beat grid. |

---

**If you only do one thing:** item 04, the CI workflow. Everything above it is
already written down as a script, and the two things that rotted while nothing
ran them are the argument.

**If you only ship one feature:** item 08, the practice runlist — the data model
has been reaching for it since sections were added.
