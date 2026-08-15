# Next steps

Twenty-five things worth considering after v1, ranked. The first seven are
corrections to promises v1 already makes and cost days, not weeks. The last five
are the ones to turn down on purpose — a roadmap without them is just a wishlist.

Effort is in developer-days. Impact and ROI are 1–5, higher is better;
complexity is 1–5, higher is worse.

---

## Tier 0 — finish what v1 already claims

None of these are features. Each is a place where the app says it does something
and then doesn't, or where a browser API the product is clearly shaped around was
never called. Together they're roughly a week, and they change how finished v1
feels more than anything below them.

### 01. The web manifest ships with no icons — ~0.5 d

`apps/web/public/manifest.webmanifest` declares `"icons": []`, and `src/assets`
holds one MP3 and nothing else. The manifest asks for `display: standalone` and
`start_url: /studio` — so the app is already asking to be installed, and then
installs as a blank tile. On iOS, Add to Home Screen falls back to a screenshot
of the page.

**Why:** This is the app's front door on a tablet propped against a music stand,
which is the device the whole product is for. One SVG, four PNG sizes emitted
from `build.ts`, an `apple-touch-icon` link, done.

**Why not:** Nothing, honestly. The only cost is deciding what the icon is.

### 02. The screen dims in the middle of a loop — ~0.5 d

There is no `wakeLock` call anywhere in the source. Set a 16-bar loop running at
0.7×, put the tablet on the stand, pick up the instrument — and the display
sleeps. Every practice session hits this within two minutes.

**Why:** Ten lines in `PlaybackSession.tsx`, acquired on play and released on
pause, re-acquired on `visibilitychange`. Supported in Chrome, Edge and Safari
16.4+. It's the single largest quality-of-life gap in the product relative to its
cost.

**Why not:** Firefox still doesn't support it, so it degrades rather than works
everywhere — but degrading to today's behaviour is free.

### 03. No Media Session, so no hands-free transport — ~1 d

`navigator.mediaSession` appears nowhere. The keyboard shortcuts in
`PlaybackSession.tsx` are good — Space/K play, J/L seek, I/O loop points, M
click, R record — and completely unreachable when both hands are on a guitar.

**Why:** Setting metadata plus `play`, `pause`, `seekbackward`, `seekforward`
handlers is about twenty lines, and it lights up lock-screen controls, headphone
buttons, car controls — and Bluetooth page-turner pedals, which send media keys
and cost players £40. That's a foot-pedal feature you get without building a
foot-pedal feature.

**Why not:** The four-stem engine is an AudioWorklet graph, not an `<audio>`
element, so the session has to be driven manually and position state kept honest
through speed changes and loop wraps. Real work, but contained.

### 04. There is no CI, and the README cites CI gates — ~1 d

No `.github/` directory exists. Meanwhile the README instructs that CI require
`uv lock --check`, and names `typecheck`, `test`, `test:e2e` and the OpenAPI
snapshot regeneration as the gates. All of it is currently honour-system.

**Why:** The gates already exist as scripts — this is one workflow file wiring up
what's written. The OpenAPI-diff check in particular is the kind of thing that
only ever fails when someone has already forgotten it.

**Why not:** Solo project, and the checks run locally today. The counter is that
the Playwright specs are the ones most likely to rot unnoticed, and they're
exactly what a human skips before pushing.

**Watch out for:** Playwright in CI needs the COOP/COEP headers the preview
server sends.

### 05. The README points at two files that were deleted — ~0.5 h

Contributing sends readers to `IMPLEMENTATION_PLAN.md` for architecture and
`AUDIT.md` for known limits. Commit `16d8ce6` removed both. A first-time reader's
first two clicks are 404s.

**Why:** Half an hour. Either restore a trimmed architecture note or rewrite the
paragraph to point at what actually exists.

**Why not:** None — but resist re-creating a large planning doc that goes stale
the same way. A short "how the pieces fit" section inside the README is the
version that survives.

### 06. The shortcuts are invisible unless you open Practice — ~0.5 d

The keymap is documented in one `<kbd>` line at the bottom of
`PracticeInspector`. The shortcuts themselves are global — they work on the
Library and Settings too — so the one place they're described is the one place
you have to already be.

**Why:** `?` opens a sheet listing the keymap. It reuses the dialog pattern
`SeparationSheet` already establishes, including its focus handling.
Discoverability of existing work is the cheapest feature there is.

**Why not:** Another modal. Keep it to one screen and don't let it become a
settings surface.

### 07. A new build can't tell an open tab it exists — ~0.5 d

`main.tsx` registers the service worker and never looks at it again — no
`updatefound`, no waiting-worker check. Since a session here is "leave the tab
open on the stand for a week", an installed copy can sit a release or two behind
with nothing on screen suggesting it.

**Why:** Listen for a waiting worker, show one line in the existing
`StorageNotice` slot offering a reload. The version string is already generated
into the build, so there's something concrete to name.

**Why not:** Navigation requests are already network-first, so the shell isn't
badly stale in practice. This is polish on a real but slow-moving problem.

**Watch out for:** Don't auto-reload — it would stop playback mid-take.

---

## Tier 1 — the next real features

Each of these sits on machinery that exists — the section list, the LRC parser,
the backup writer, the beat grid, the repetition counter in the worklet. That's
the filter: features whose hard part is already done and shipped.

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

### 09. Word-level lyrics (enhanced LRC) — ~3 d

`lrc.ts` parses line-level timing, so sing-along highlights a whole line at a
time. Enhanced LRC adds inline `<mm:ss.xx>` word tags, and LRCLIB carries them for
a meaningful slice of its catalogue.

**Why:** The parser extension is small and the payoff is the karaoke behaviour
everybody expects from a sing-along view. It also sharpens the lyrics-plus-chords
view, where `chords.ts` currently admits its own shortcut — characters standing in
for syllables when placing a chord over a word. Real word timings replace a
heuristic with data.

**Why not:** Coverage is partial, so both paths have to render well and the
line-level path stays the default. Don't build a word-timing *editor* — that's a
different, much larger product.

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

### 12. Chromatic tuner — ~2 d

Recording already opens a microphone stream, and the FFT dependency and CQT code
are already in the bundle. A YIN or autocorrelation pitch detector on top of that
is maybe 150 lines and touches nothing else.

**Why:** It's the tool a guitarist reaches for immediately before the tool this
app already is, and it's the rare feature that's genuinely self-contained.

**Why not:** Every phone already has one, and a mediocre tuner is worse than no
tuner — players trust them absolutely. Either it's accurate to a couple of cents
with a stable readout, or skip it. Ranked below the runlist for that reason.

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

### 14. Tablet as a first-class target — ~8 d

The README is candid: "Mobile layouts support playback and review. Mobile
recording and browser separation are not release promises." But a tablet on a
music stand is the archetypal device for this product, and the three-pane layout
already collapses to a pane switcher below 1024px. The gap is touch ergonomics —
the mixer faders, the loop drag on the ruler, the stepper buttons — not layout.

**Why:** It's the natural home of the app, and half the work is already in the CSS.

**Why not:** iPad Safari is where cross-origin isolation, OPFS quota and
`SharedArrayBuffer` get least forgiving, and the whole four-stem engine depends on
all three. Budget as much for verification as for building.

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

### 17. Light theme, reduced motion, contrast pass — ~4 d

`tokens.css` defines one palette and there's no `prefers-color-scheme` or
`prefers-reduced-motion` anywhere in the CSS. Dark is right for a studio; it's
wrong for a sunlit rehearsal room, and the sing-along view is the one people read
from across a room.

**Why:** Tokens are already centralised, so the palette work is contained, and
respecting a stated OS preference is table stakes rather than a feature.

**Why not:** Every module CSS file has to be audited for literal colors that only
work on dark, and the four stem hues need light-ground variants that stay
distinguishable. Slower than it looks. Audit first, then decide.

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

**Why not:** Items 01, 02 and 03 — icons, wake lock, media session — deliver most
of what "feels like a native app" means here, for about two days total. A wrapper
adds store review, two release channels, and a signing identity, and it doesn't
fix the one thing that would actually justify it: cross-origin isolation and
`SharedArrayBuffer` inside a webview. Revisit only if iPad Safari turns out to be
a hard blocker after item 14.

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
| 01 | PWA icons | Fix v1 | 4 | 5 | 1 | 0.5 d | Manifest says `icons: []` while asking to be installed standalone. | No reason not to. | Needs an `apple-touch-icon` link too, or iOS screenshots the page. |
| 02 | Screen wake lock | Fix v1 | 5 | 5 | 1 | 0.5 d | The display sleeps mid-loop on the device this product is for. | Unsupported in Firefox — degrades to today. | Re-acquire on `visibilitychange`; release on pause, not on unmount only. |
| 03 | Media Session controls | Fix v1 | 5 | 4 | 2 | 1 d | Lock screen, headphones, and Bluetooth pedals — hands-free for free. | Worklet graph must drive position state by hand. | Position reporting under speed change and loop wrap. |
| 04 | CI workflow | Fix v1 | 3 | 4 | 2 | 1 d | No `.github/` exists; the README already specifies the gates. | Solo project, checks run locally. | Playwright in CI needs the COOP/COEP headers the preview server sends. |
| 05 | Fix dead README links | Fix v1 | 2 | 5 | 1 | 0.5 h | Contributing points at two files deleted in `16d8ce6`. | None. | Don't recreate a big planning doc that goes stale again. |
| 06 | Shortcut help sheet | Fix v1 | 3 | 4 | 1 | 0.5 d | Global shortcuts documented only inside the Practice panel. | One more modal. | Reuse `SeparationSheet`'s focus handling; keep it one screen. |
| 07 | Update-available prompt | Fix v1 | 2 | 3 | 1 | 0.5 d | SW is registered and never checked; tabs stay open for days. | Navigations are already network-first. | Don't auto-reload — it would stop playback mid-take. |
| 08 | Practice runlist | Next | 5 | 4 | 3 | 3 d | Sections, reps, pause and ramp all exist; nothing chains them. | Per-section overrides mean a schema change. | Ship without per-section speed first; watch `PracticeStateV1` and backups. |
| 09 | Word-level LRC | Next | 4 | 4 | 2 | 3 d | Real karaoke timing, and it replaces the chord-placement heuristic. | LRCLIB coverage is partial. | Line-level stays the default path; don't build a timing editor. |
| 10 | Song packs (no audio) | Next | 4 | 5 | 2 | 2 d | `createBackup(false)` already does the hard part. | Needs a same-song matching rule. | Reuse the content hash and `healMissingAudio`, don't invent matching. |
| 11 | Meter beyond 4/4 | Next | 3 | 3 | 3 | 4 d | Code admits the 4/4 assumption; waltzes are silently wrong. | Reaches into contract, worklet and count-in. | Manual override first; automatic detection may never be needed. |
| 12 | Chromatic tuner | Next | 3 | 3 | 2 | 2 d | Mic stream, FFT and CQT are already in the bundle. | Every phone has one already. | Accurate to a few cents with a stable readout, or don't ship it. |
| 13 | Practice history | Next | 3 | 2 | 3 | 4 d | Repetitions and speed are already tracked, then discarded. | Where practice apps get bloated. | One sentence per song. No streaks, no badges. New table hits backup. |
| 14 | Tablet as first-class | Later | 5 | 3 | 4 | 8 d | The archetypal device; layout already collapses correctly. | iPad Safari is hostile to the engine's requirements. | Isolation, OPFS quota and `SharedArrayBuffer`; budget verification time. |
| 15 | Ukulele / bass / piano chords | Later | 4 | 3 | 3 | 6 d | Detection is instrument-agnostic; only drawing is guitar-bound. | "Six strings, low E first" runs through the type system. | Ukulele first. Piano is a separate renderer, not a tuning. |
| 16 | Six-stem separation | Later | 5 | 2 | 5 | 10 d | Guitarists get "other" today; Play-along is built for this gesture. | Bigger model, slower, worse on the stems that worked. | Four-way `StemKind` is everywhere; old separations never migrate. |
| 17 | Light theme + a11y prefs | Later | 3 | 3 | 3 | 4 d | No `prefers-color-scheme` or `prefers-reduced-motion` at all. | Slower than it looks once module CSS is audited. | Stem hues need light-ground variants that stay distinguishable. |
| 18 | Setlists | Later | 3 | 2 | 2 | 4 d | Library groups by storage type, not by how a session is planned. | A bookmark folder approximates it. | Wait for the runlist — it solves the more common problem. |
| 19 | Punch-in / comping | Later | 2 | 2 | 4 | 8 d | What you want after the fourth take; A–B already defines the region. | It's a DAW feature, and users have DAWs. | Draw the real take waveform first — a fraction of the cost, most of the benefit. |
| 20 | MIDI export | Later | 2 | 3 | 1 | 2 d | Chord times and tempo map already exist; ~100 lines, no dependency. | Narrow audience. | An afternoon's fun, not planned work. |
| 21 | Accounts and cloud sync | Decline | 3 | 1 | 5 | months | Would let a library follow a user across devices. | The README already lists the full cost; local-first is the position, not a gap. | Backup, restore and song packs already cover the real need. |
| 22 | Notation / MusicXML | Decline | 2 | 1 | 5 | months | Frequently requested by readers of standard notation. | Transcription + quantisation + engraving are three separate hard problems. | Bad notation is worse than none — players will try to read it. |
| 23 | Per-stem effects | Decline | 1 | 1 | 4 | 10 d | Sounds like a natural mixer extension. | The mixer's job is audibility, not mix quality; the worklet's budget is spent. | Possible exception: a high-pass on the backing during recording. |
| 24 | Native app wrappers | Decline | 2 | 1 | 4 | 15 d + | Store presence and a native-feeling install. | Items 01–03 deliver most of that in two days. | Revisit only if iPad Safari blocks item 14 outright. |
| 25 | Automated performance scoring | Decline | 2 | 1 | 5 | 15 d | The obvious "AI feature" for a practice app. | Needs reliable polyphonic pitch on a room mic; wrong grades destroy trust app-wide. | If anything: a non-judgemental timing overlay against the beat grid. |

---

**If you only do one thing:** items 01, 02 and 03 are about two days together, and
they are the difference between a web app you open and a practice tool you live
with.

**If you only ship one feature:** item 08, the practice runlist — the data model
has been reaching for it since sections were added.
