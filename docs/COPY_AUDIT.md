# User-facing copy audit

Every string the app puts in front of someone, read once as a whole. The app's
existing copy is careful — most of it explains what happened and what is safe,
which is rare — so this is not a rewrite. It is the list of places where the
sentence was written from inside the implementation and reads that way from
outside it.

Three rules were applied:

1. **Name the thing the user has, not the API that holds it.** "Origin", "the
   Origin Private File System", "IndexedDB" and "cross-origin isolation" are
   accurate and mean nothing to a guitarist.
2. **A number is only useful if it answers a question the reader has.** `RTF
   0.75` is the measurement; "about 3 minutes for a 4-minute song" is the
   answer.
3. **Say it once.** Two sentences in one section both promising checksum
   verification is one sentence and one echo.

Status: **Applied** means it is in the app now. **Left alone** means the audit
looked and decided against changing it, with the reason.

---

## Settings → Browser storage

| Where | Current | Proposed | Status |
| --- | --- | --- | --- |
| Row label | `Origin usage` | `Everything Atarang stores` | Applied |
| Row label | `Persistence` | `Protected from cleanup` | Applied |
| Row value | `Granted` / `Not granted` | `Yes` / `No` | Applied |
| Row label | `Imported originals` | `Songs you imported` | Applied |
| Row label | `Recovery notices` | `Damaged files found` | Applied |
| Section intro | `Atarang stores your library locally using IndexedDB and the Origin Private File System.` | `Your songs, stems, takes and settings are kept in this browser, on this device. Nothing is sent anywhere unless you ask for it.` | Applied |
| Button | `Refresh usage` | `Check again` | Applied |
| Backup intro | `Backups include originals, separated stems, takes, practice settings, lyrics, charts, and saved chord voicings. Every binary is checksum-verified before restore publishes anything.` | `A backup holds your songs, separated stems, takes, practice settings, lyrics, charts and saved chord shapes. Every file is checked against its checksum before a restore puts anything back.` | Applied |

`Origin usage` was the reported one. "Origin" is the browser's word for a
scheme-host-port tuple; on screen it read as though Atarang had an origin story.
The row is the total of everything the app keeps against what the browser allows,
so it says that.

`Persistence: Granted` describes the outcome of `navigator.storage.persist()`.
What the user cares about is whether the browser may delete their library, which
is what "Protected from cleanup" says — and it agrees with the wording of the
banner above it, which already talks about the browser reclaiming storage.

## Settings → Audio engine

| Where | Current | Proposed | Status |
| --- | --- | --- | --- |
| Row label | `Cross-origin isolation` | `Four-stem playback` | Applied |
| Row value | `Enabled` / `Unavailable` | `Available` / `Not available in this browser` | Applied |
| Row label | `Shared memory` | `Audio memory` | Applied |
| Row value | `Available` / `Transfer-buffer fallback` | `Shared between threads` / `Copied between threads (a little slower)` | Applied |

Both rows are diagnostics, and stayed diagnostics — they now report the
consequence rather than the browser flag. Cross-origin isolation is precisely
the thing that gates four-stem playback, metronome, count-in and recording, so
naming it after what it enables loses nothing and tells the reader whether their
browser can do the thing they came for.

## Settings → Browser separation model

| Where | Current | Proposed | Status |
| --- | --- | --- | --- |
| Readout | `Ready · RTF 0.75` | `Ready · about 3 minutes for a 4-minute song` | Applied |
| Readout | `Ready, but slower than cloud · RTF 1.40` | `Ready, but slower than cloud · about 6 minutes for a 4-minute song` | Applied |
| Readout | `Ready · not benchmarked` | `Ready · speed not measured` | Applied |
| Readout | `Running optional performance test… 42%` | `Running optional speed test… 42%` | Applied |
| Button | `Test performance (optional)` | `Test this device's speed (optional)` | Applied |
| Status | `The browser model is installed and enabled. The optional test only measures this device's performance and continues if you visit Library or Studio.` | `The model is installed and ready. The optional test only measures how fast this device is, and keeps running if you go to Library or Studio.` | Applied |
| Status | `The built-in model is ready for an explicit, verified download.` | `The model has not been downloaded yet.` | Applied |
| Section intro | `Every model piece is checksum-verified before it is installed.` | `Every piece is checked against its checksum before anything is installed.` | Applied |

The real-time factor was the worst string in the app: a ratio, unlabelled, in a
place where the user is deciding whether to separate here or on a server. It is
now the same fact as a duration, via one shared `separationEstimate` helper so
Settings and the separation sheet cannot quote different numbers.

`ready for an explicit, verified download` was arguing with the reader about a
policy they had not questioned, and repeated the checksum promise made two
sentences earlier. The checksum sentence stayed where it belongs, in the
description; the status line just reports the state.

## Settings → Cloud processing

| Where | Current | Proposed | Status |
| --- | --- | --- | --- |
| Field label | `Server origin` | `Server address` | Applied |
| Notice | `Audio only leaves this browser after per-operation confirmation.` | `Audio only leaves this browser after you confirm it, every time.` | Applied |
| Help text | `The deployment key remains in session storage and is cleared when this tab session ends. It is not included in backups.` | `The deployment key is kept only until you close this tab, and is never included in a backup.` | Applied |
| Status | `Server capability verified for this session.` | `Server reached and accepted your key. Saved for this tab.` | Applied |
| Field label | `Deployment key` | — | Left alone: this surface is for whoever runs the server, and that is what the server calls it. |

## Library

| Where | Current | Proposed | Status |
| --- | --- | --- | --- |
| Import phase | `Writing to protected staging` | `Copying into this browser` | Applied |
| Import phase | `Verifying content-addressed copy` | `Checking the copy is identical` | Applied |
| Import phase | `Publishing to your Library` | `Adding to your Library` | Applied |
| Import note | `Nothing appears in the Library until verification passes.` | `Nothing is added to your Library until the copy has been checked.` | Applied |
| Footer | `0 KB used by local audio assets` | `0 KB of audio stored in this browser` | Applied |
| YouTube progress | `successful acquisitions are reused on this server` | `videos this server has already fetched are reused` | Applied |
| YouTube intro | `The authorized server fetches and deduplicates the source. Choose where separation runs.` | `Your server fetches the audio and reuses anything it already has. Choose where the stems are made.` | Applied |
| YouTube intro | `The saved deployment key was rejected, or YouTube acquisition is disabled.` | `The saved deployment key was rejected, or this server has YouTube fetching turned off.` | Applied |
| YouTube intro | `Configure this server and its session-only deployment key in Settings.` | `Add the server address and its deployment key in Settings.` | Applied |
| Error | `Imported successfully; temporary result cleanup will retry by retention policy.` | `Imported. The server still holds a temporary copy and will delete it on its own schedule.` | Applied |
| Error | `YouTube acquisition cancelled. Any source already verified and imported into your Library is retained.` | `YouTube fetch cancelled. Anything already imported into your Library is kept.` | Applied |
| Category tabs | `Originals` / `Separated` / `Performances` | — | Left alone: these are the app's nouns and are used consistently across Library, Settings and Studio. Renaming one means renaming all three, which is a bigger decision than a copy pass. |

"Staging" and "content-addressed" describe how the importer guarantees the copy
is byte-identical, which is a good property nobody watching a progress bar asked
about. The guarantee survives; the vocabulary does not.

## Studio → separation sheet

| Where | Current | Proposed | Status |
| --- | --- | --- | --- |
| Subtitle | `Choose where the verified four-stem result comes from.` | `Choose where the four stems are made.` | Applied |
| Running note | `The operation publishes all four verified stems atomically. Cancelling leaves the current Library item unchanged.` | `All four stems are added together or not at all. Cancelling leaves this song exactly as it is.` | Applied |
| Local route | `Benchmarked and ready at measured RTF 0.75.` | `Measured and ready — about 3 minutes for a 4-minute song.` | Applied |
| Package route | `Import a canonical manifest plus vocals, drums, bass, and other files generated elsewhere.` | `Import vocals, drums, bass and other files made elsewhere, along with the manifest that describes them.` | Applied |
| Cancel | `Cancelled. Server cleanup was requested.` | `Cancelled. The server was asked to delete its copy of your audio.` | Applied |
| Footer | `An installed model runs after a quick WebGPU check. The optional device test measures performance and is remembered for 30 days.` | `An installed model runs after a quick graphics check. The optional speed test is remembered for 30 days.` | Applied |
| Local route | `No WebGPU adapter here, so this runs on the processor.` | — | Left alone: a user who hits this needs a term they can search, and "WebGPU" is the term. The sentence already says what it means for them. |

"Atomically" is the promise this sheet most needs to make — a half-separated song
would be worse than none — and it was made in a word most readers skip.

## Studio → chords

| Where | Current | Proposed | Status |
| --- | --- | --- | --- |
| Timeline note | `Detected chords stay aligned to source time. Click any segment to seek; editing saves a separate chart.` | `Detected chords stay in time with the song. Click any chord to jump there; editing saves a separate chart.` | Applied |
| Practice | `95% beat-grid reliability` | — | Left alone: "beat grid" is a term musicians meet in every DAW, and the row it labels is the tempo control. |

## Left alone, deliberately, across the app

- **Error sentences** (`errorText.ts`, `stageLabel.ts`, and the per-surface
  dictionaries in Settings and Library). These are already the best copy in the
  app: each one says what failed, what was left untouched, and what to do. The
  audit changed none of them.
- **"Verified" as a modifier.** It appears on packages, copies, backups and
  models. It earns its place where it describes a check the user might otherwise
  not know happened, and was cut only where it modified a noun the user had no
  reason to doubt ("the verified four-stem result").
- **The storage banner.** `This browser can reclaim Atarang's storage. Songs,
  stems and recorded takes live on this device only, and are deleted without
  warning when space runs low.` Nothing to improve.

## Known gap, not addressed here

The app ships MIT-licensed vendored code (Signalsmith Stretch) and a BSD-2
model, and the licence texts live in `src/vendor/` — which is not part of the
build output, so nothing reaches the user. There is no `LICENSE` or
`THIRD_PARTY_LICENSES` in the repository either, which is why the About section
links only to the repository. Attribution is a distribution obligation rather
than a copy question, so it is recorded here rather than guessed at.
