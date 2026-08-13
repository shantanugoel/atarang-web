# Atarang Web — outstanding work

Everything the August 2026 audit and remediation pass left open, grouped by
functionality. Seven commits on `fix/webgpu-chords-ui` fixed the WebGPU root
cause, the chord pipeline, the CPU fallback, OPFS eviction handling and the
interface defects; this file is what remains.

Two kinds of item are mixed together deliberately, because from a user's seat
they are the same thing — the app not doing what it should:

- **Limits** — something that ships and underperforms, with a measured reason.
- **Gaps** — a workflow the iOS app has and this one has never had.

Impact is about the product. Effort is engineering time. ROI is the ratio, and
is the column to sort by when time is short.

---

## A. Chord and harmony analysis

### A1. Chord roots are unstable on dense, distorted mixes — *limit*

**Gap.** The ported pipeline decodes a synthesised I–V–vi–IV exactly, and on a
real rock track the bass reads the root unambiguously, but the decoded roots
still wander across a chromatic cluster.

**Why it matters.** Chords are one of the two headline reasons to open this app.
Output a guitarist cannot trust is worse than no output, because they have to
verify every bar by ear anyway.

**Measured cause.** A tuning histogram over the separated guitar stem is flat —
the strongest cent-deviation bin holds **1.5%** of peak energy, where a tonal
recording concentrates 20–40% near zero. The spectral peaks in a heavily
distorted stem are not tonal partials, so template matching has nothing to match.
This is a property of the evidence, not a tuning constant.

**Achieves.** Chord output a player can follow on the material they actually
practise — rock, punk, anything with gain on the guitar.

**Approach.** Replace the chroma stage with a learned front end: a small CNN over
a constant-Q transform, trained on a public chord corpus, exported to the ONNX
runtime the app already ships and loads. Everything downstream survives — the
Viterbi decode, the bass term, the key estimate, the segment contract and the
user correction layer all consume the same shapes.

**Impact:** High · **Effort:** Large · **ROI:** Medium-High

### A2. Tuning estimation is not shipped — *limit*

**Gap.** The app assumes A 440 and assumes the spectrum is tonal. Neither is
checked.

**Why it matters.** Bands tune down, tape drifts, and live recordings are rarely
at concert pitch — every one of those smears the chroma across neighbouring
semitones. Separately, the app currently prints confident chord symbols for
audio where no chord is recoverable.

**Achieves.** Correct chroma on off-pitch recordings, and an honest "chords are
unreliable for this track" signal instead of confident nonsense.

**Approach.** Already prototyped during the audit: parabolic-interpolate spectral
peaks, histogram their deviation from the equal-tempered grid in cents, take the
weighted mode as the global offset. A flat histogram is the "not tonal" signal.
Roughly 40 lines plus a confidence banner in the chord rail.

**Impact:** Medium · **Effort:** Small · **ROI:** **High**

### A3. No user chord library — *gap*

**Gap.** `UserChords.swift` and `UserChordImportView.swift` are 2 412 Swift lines
with no web counterpart. The web app can import and export ChordPro per song; it
cannot hold a personal, corrected chord vocabulary across songs.

**Why it matters.** It is the largest single feature gap remaining, and it is the
thing that makes corrections compound: fix a voicing once, have it apply
everywhere. Without it every song starts from the detector's guess.

**Achieves.** Corrections that accumulate into a library instead of evaporating
per song — which also partly compensates for A1 while A1 is unsolved.

**Approach.** A new IndexedDB store plus a contract alongside `user-chart-v1`, a
management screen, and a resolution step where a user chord outranks a detected
one at the same time range. The correction-layer contract already exists and is
unused.

**Impact:** High · **Effort:** Large · **ROI:** Medium

---

## B. Rhythm analysis

### B1. Tempo is a single global estimate — *limit*

**Gap.** One autocorrelation lag for the whole song, so any drift or tempo change
desynchronises progressively. The reliability score sat at **0.303** on an
ordinary rock song, just under the 0.35 gate, which sent chord windows to
arbitrary half-second blocks instead of beats.

**Why it matters.** The beat grid is load-bearing: it drives the metronome, the
count-in, the loop snapping that does not exist yet, and the beat-synchronous
averaging the chord detector was designed around. A grid that fails its own
confidence check silently degrades the feature above it.

**Achieves.** Beat-synchronous chords in practice rather than in principle, a
metronome that stays with the song, and the foundation for bar-aware looping.

**Approach.** A dynamic-programming beat tracker (Ellis-style) with a log-normal
tempo prior centred near 120 BPM to resist half- and double-time errors, over the
onset novelty curve the worker already computes. The downbeat phase detector
added in this pass sits on top unchanged.

**Impact:** High · **Effort:** Medium · **ROI:** **High**

---

## C. Separation performance and delivery

### C1. CPU inference is single-threaded — *limit*

**Gap.** The WASM path runs at RTF 2.44 against 0.23 on WebGPU. It is
single-threaded because `numThreads > 1` leaves the first
`InferenceSession.create` pending past the 90-second watchdog inside a module
worker. There is a `ponytail:` marker at the site.

**Why it matters.** This is the only local path on Safari, on Firefox, and on any
machine without a usable adapter. At RTF 2.44 a four-minute song takes about ten
minutes, which is tolerable rather than pleasant.

**Achieves.** A no-GPU path fast enough that browser choice stops mattering.

**Approach.** Route through the runtime's own proxy worker rather than adding
threads to the existing one, which is what deadlocks. Expect a severalfold
improvement; measure before and after with the existing device benchmark.

**Impact:** Medium-High · **Effort:** Small · **ROI:** **High**

### C2. The model is a 126 MB precondition — *gap*

**Gap.** Nothing works locally until 125.9 MB has downloaded.

**Why it matters.** It decides who can use the headline feature at all — on a
phone, a metered connection or a hotel network, that download is where people
leave.

**Achieves.** Local separation reachable on far more devices and connections.

**Approach.** Quantise to int8, or ship a lighter four-stem model as the default
with the current one as an explicit "best quality" opt-in. The manifest, the
checksum verification and the piece-wise download already support more than one
artifact.

**Impact:** Medium · **Effort:** Medium · **ROI:** Medium

---

## D. Storage durability

### D1. Eviction is handled but never explained — *limit*

**Gap.** Persistence is already requested at import (`storage/importer.ts`); the
browser simply declines it. During the audit the library was evicted twice — the
model once and a song's stems once. The code now detects the aftermath and
degrades correctly, but the user is never told it can happen or why their
separated song became an original again.

**Why it matters.** A local-first app whose data quietly disappears loses trust
permanently, and the remedy — granting persistence — is something only the user
can do.

**Achieves.** A surprising data loss becomes an understood, recoverable one.

**Approach.** Read `navigator.storage.persisted()` on load; when false, show a
quiet dismissible banner explaining that browser storage can be reclaimed, with
the existing "Request persistent storage" action inline, plus a one-tap
re-download when the model is the thing that went missing.

**Impact:** Medium · **Effort:** Small · **ROI:** **High**

---

## E. Practice workflow

### E1. The waveform does not zoom — *gap*

**Gap.** The analysis computes a four-level pyramid — 256, 1 024, 4 096 and
16 384 frames per bucket — and the transport renders 128 bars from it. Three of
the four levels are computed on every import and thrown away.

**Why it matters.** Practising means working on a bar, not a song. At 128 points
across four minutes, a bar is roughly one pixel wide, so the waveform cannot be
used to find anything.

**Achieves.** The transport becomes a place to navigate rather than a decoration.

**Approach.** Wire zoom and horizontal scroll to the pyramid levels that already
exist, selecting the level by pixels-per-second. No new analysis, no new storage.
The cheapest large improvement on this list.

**Impact:** High · **Effort:** Small · **ROI:** **Highest**

### E2. The loop cannot be dragged — *gap*

**Gap.** A–B is set by keyboard (`I`/`O`) or two steppers in a side panel. The
iOS app also loops by holding a lyric line and drags across lines for a selection.

**Why it matters.** Looping a passage is the single most-used action in a
practice tool, and it currently requires either memorised shortcuts or a trip to
a panel that is behind a switcher on narrow screens.

**Achieves.** Loop setting becomes a gesture on the thing you are looking at.

**Approach.** Pointer drag on the waveform writing `loopStartUs`/`loopEndUs`,
snapping to the stored beat grid when it is reliable. Best done after E1, since
both need the same pixel-to-time mapping, and after B1, since snapping is only
worth having on a grid worth trusting.

**Impact:** High · **Effort:** Small · **ROI:** **High**

### E3. No sections, tempo ramps or tap tempo — *gap*

**Gap.** No saved loops, no loop snapping to reliable bars, no gradual speed-up,
no tap tempo or subdivision control.

**Why it matters.** This is the difference between a player with a speed slider
and a practice tool. Tap tempo also gives the user a way out when B1's detector
is unsure, rather than leaving them stuck with a wrong grid.

**Achieves.** A practice session with structure: named passages, repetition, and
speed that increases as the passage is learned.

**Approach.** A saved-sections store seeded from lyric section labels, a
repetition schedule extending the existing repetitions/pause settings, and a tap
tempo control writing to the user-edited beat grid path that already exists.

**Impact:** Medium-High · **Effort:** Medium · **ROI:** Medium

---

## F. Lyrics

### F1. No sing-along mode or lyric gestures — *gap*

**Gap.** Lyrics are display-and-seek. There is no full-screen mode, no explicit
follow / resume-follow behaviour when the user scrolls by hand, no
hold-a-line-to-loop, and no drag across lines to make an A–B selection.

**Why it matters.** For singers this is the primary interface, and 2 666 Swift
lines of iOS behaviour reduce to a scrolling list here. Manual scrolling also
currently fights the auto-follow with no way to say which should win.

**Achieves.** The lyrics pane becomes usable while actually performing, not only
while editing.

**Approach.** A full-screen route reusing the existing timed-line rendering;
follow state as a store flag with a "resume follow" affordance on manual scroll;
line-hold and line-drag writing the same loop boundaries as E2.

**Impact:** Medium-High · **Effort:** Medium · **ROI:** Medium

---

## G. Mixer

### G1. No presets, pan or meters — *gap*

**Gap.** This pass deleted the fake pan dials and the meters frozen at 61%
rather than building the real ones. Learn / Guide / Play Along presets do not
exist.

**Why it matters.** Presets are how a beginner uses stem separation without
understanding stem separation — one tap for "guide vocal quiet, everything else
up". Meters answer "is this stem even playing", which is the first question when
a mix sounds wrong.

**Achieves.** Stem mixing usable without audio-engineering knowledge.

**Approach.** Presets are a named map of gains and mutes applied to the existing
store, and are close to free. Pan needs a `pan` field in the store and a
`StereoPannerNode` per stem in the separated engine. Meters need periodic RMS
from the audio worklet, which already runs.

**Impact:** Medium · **Effort:** Small (presets) / Medium (pan, meters) ·
**ROI:** **High** for presets, Medium for the rest

---

## H. Library management

### H1. Shallow library management — *gap*

**Gap.** No multi-select deletion, no per-category storage totals, no inline
preview, and no way to remove a separation, an analysis or a recording
independently of its original.

**Why it matters.** Four lossless stems are roughly 65 MB per song, so a library
fills browser storage quickly, and the only current remedy is deleting whole
songs — including irreplaceable recorded takes, which cannot be regenerated.

**Achieves.** Users can reclaim space without losing the one thing they cannot
recreate.

**Approach.** Multi-select over the existing rows, per-category totals from blob
sizes already tracked, and independent removal paths through the existing
reference-counted blob store, which supports this already.

**Impact:** Medium · **Effort:** Medium · **ROI:** Medium

---

## I. Recording and takes

### I1. Takes cannot be previewed or compared — *gap*

**Gap.** Capture, trim, fade and WAV export work. Preview, reference-versus-take
comparison and non-destructive mix editing do not.

**Why it matters.** Recording without playback is a write-only feature. The
reason to record against a backing track is to hear yourself against it.

**Achieves.** The recording loop closes: play, record, listen, compare, keep or
discard.

**Approach.** A preview player over the existing dual-stream manifest, an A/B
control between take and reference, and a mix editor writing to the `edit` block
already in the performance contract and already respected on export.

**Impact:** Medium · **Effort:** Medium · **ROI:** Medium

---

## J. Engineering hygiene

### J1. The stem chord re-decode is silent — *limit, introduced by this pass*

**Gap.** The stem-based chord analysis added in this pass decodes both stems and
re-runs the decode with no progress messages at all. On a long song the chords
change some seconds after separation finishes, with nothing on screen.

**Why it matters.** Output changing on its own with no explanation reads as a
bug, and it is the kind of thing that makes people doubt the rest of the output.

**Achieves.** A visible, explained upgrade instead of a silent mutation.

**Approach.** Emit `chords/progress` from the worker on the same channel the
waveform pass already uses, and surface it where the separation progress banner
already appears.

**Impact:** Low-Medium · **Effort:** Trivial · **ROI:** **High**

### J2. No end-to-end coverage of the real path — *gap*

**Gap.** One 152-line Playwright shell test. Nothing exercises import →
separate → play.

**Why it matters.** That is precisely the path that was completely broken by a
one-line wasm mismatch and shipped anyway. Unit tests and `tsc` both passed
throughout.

**Achieves.** The class of failure that motivated this whole audit gets caught by
CI instead of by a user.

**Approach.** One headless run over the bundled CC0 demo: import, separate
locally, assert four stems published and the transport advancing. Slow, so gate
it to a nightly or pre-release job rather than every push.

**Impact:** Medium · **Effort:** Medium · **ROI:** **High**

---

## Suggested order

Sequenced so that each phase either unblocks the next or delivers something a
user notices immediately. Within a phase, order is by ROI.

### Phase 1 — cheap wins and trust (days)

1. **E1 · Zoomable waveform** — highest ROI on the list; the data already exists.
2. **J1 · Progress for the stem chord re-decode** — trivial, and stops the app
   contradicting itself.
3. **C1 · Multi-threaded CPU inference** — a marker is already in the code; makes
   the no-GPU path respectable.
4. **D1 · Explain eviction** — small, and protects trust in a local-first app.
5. **A2 · Ship tuning estimation** — already prototyped, and its "not tonal"
   signal lets the app be honest about A1 before A1 is solved.
6. **G1 · Mixer presets only** — a named map over the existing store; defer pan
   and meters.
Addendum: The app keeps losing state on switching between tabs and things. We should fix this thoroughly by checking all such ux patterns.

### Phase 2 — make the analysis trustworthy (weeks)

7. **B1 · Real beat tracker** — do this before anything that snaps to bars. It
   also improves chord windowing immediately, at no cost to the chord code.
8. **J2 · End-to-end coverage** — land it before the large analysis change in
   Phase 3, so that change has a safety net.
9. **A1 · Learned chord front end** — the biggest lever on perceived quality, and
   the only real fix for the measured limit. Everything downstream is already
   built for it.

### Phase 3 — practice workflow (weeks)

10. **E2 · Drag to set the loop** — needs E1's pixel mapping and B1's grid to
    snap to, which is why it waits.
11. **E3 · Sections, tempo ramps, tap tempo** — builds on E2.
12. **F1 · Sing-along and lyric gestures** — shares the loop-gesture work in E2.

### Phase 4 — depth and parity (months)

13. **H1 · Library management** — pressure grows with library size, so it can
    wait, but not indefinitely.
14. **I1 · Take preview and comparison** — closes the recording loop.
15. **A3 · User chord library** — the largest gap, and the most valuable *after*
    A1, since it is far more useful to correct good detections than bad ones.
16. **G1 · Pan and live meters** — the remainder of the mixer work.
17. **C2 · Smaller model** — reach, once the thing being reached is worth it.

### Two notes on the ordering

**A1 before A3.** A user chord library is worth more once detections are close
enough to be worth correcting. Correcting output that is wrong more often than
right is data entry, not correction.

**B1 before E2 and E3.** Snapping loops to an unreliable grid is worse than not
snapping at all, because it moves the boundary the user just set. On the test
song the grid failed its own confidence check.
