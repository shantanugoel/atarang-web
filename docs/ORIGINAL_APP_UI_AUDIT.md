# Original app UI parity audit

Reviewed against the Swift sources and product screenshots in `../atarang` on 2026-08-11.

## Addressed in this pass

- Continuous bipolar waveform rendering with pointer drag/click seeking, keyboard seeking, playhead, beats, and a visible clear-loop action.
- Five-channel mixer presentation with a Master output fader and full-height draggable slider tracks.
- LRCLIB title/artist search, ranked result list, synced/plain indication, preview-before-replace, and search-again after lyrics exist.
- Detected chord now/next state, confidence, source-time timeline, seeking from chord segments, and a compact synchronized rail above lyrics.
- Separate Originals, Separated, and Performances Library categories, with recorded takes related back to their originals.
- Bundled demo Library entry with an Add & Separate workflow.
- Neutral initial loop state and responsive Studio/Library polish.

## Existing web features retained

- Independent speed and pitch, repetitions, pause, count-in, metronome, beat analysis, LRC import/export and timing, ChordPro charts, takes, local/cloud separation, practice persistence, and keyboard transport shortcuts.

## Follow-up parity work

These are larger workflows present in the original app, not small missing affordances:

- Full-screen sing-along mode and explicit follow/resume-follow behavior while manually scrolling lyrics.
- Lyric gestures: hold a line to loop it and drag across lines to create an A–B selection.
- Chord bar/ribbon view switcher, beat-counted “next chord”, long-press correction, detected-vs-simplified reveal, and complete curated guitar-shape vocabulary.
- Mixer presets (Learn, Guide, Play Along), pan controls, live meters, and missing-target explanations.
- Performance preview, reference/take comparison, non-destructive mix editing, export, and removal from the Library category.
- Saved-section creation from lyric section labels, loop snapping to reliable bars, tempo ramps, and tap-tempo/subdivision controls.
- Explicit lyrics source/provisional status and a Remove Lyrics action.
- Multi-select Library deletion, per-category storage totals, inline preview, and independent removal of originals, separations, analyses, and irreplaceable performances.

These should be implemented as dedicated feature slices with storage/audio tests; they should not be represented as inert controls.
