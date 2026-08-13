### Chords in lyrics+chords view
   1. The chord shapes in the lyrics+chords view should show current AND next chord
      shapes, not just the current one. (Pin down: behavior at start, at the last chord,
      in repeated sections; and whether this applies to other views too or only this one.)
   2. Do not show the chord bar in the synced lyrics view. (Pin down: which exact view
      this refers to, and what the user sees instead, if anything.)
   3. Are there better models for chord detection? Could we offer a choice of models?
      (Research the options; the requirement should cover what choice the user gets,
      where they make it, per-song vs global, and how accuracy/speed trade-offs are
      communicated to the user. This may need a decision from us — list the decision
      explicitly.)
   4. More levels of chord simplification? (Pin down: what's musically sensible as the
      available levels, and how simplification interacts with capo handling.)

   ### Suspected bugs (write these as bug requirements, not features)
   5. Changing the capo doesn't seem to change any chords.
   6. An imported song stops playing randomly. It still shows in settings and the library
      (eviction status unclear), the waveform shows, but only the count-in plays; moving
      the playhead jumps back to the start; re-separation doesn't fix it; all stems are
      visible but it won't play. (Acceptance criteria should cover: correct playback,
      playhead behavior, and what happens to already-affected songs.)

   ### Settings & copy
   7. Add an "About" section at the top of settings, similar to the ../atarang app.
   8. "Origin usage" in the browser storage section makes no sense to users — replace with
      user-friendly copy. Then audit ALL user-facing copy across the app for clarity and
      consistency, and produce the full list of wording changes (current string, proposed
      string, where it appears).

   ### Build & deployment (requirements for new build-time capabilities)
   9. A build-time mechanism that produces a purely static frontend build working for ALL
      features, including contacting a configured backend for cloud processing (cloud
      separation, YouTube fetching). One deployment target is Cloudflare Workers, but the
      requirement must not assume a specific host. Pin down: how the backend URL is
      configured (build-time vs runtime), and what the user experience is when the backend
      is unreachable (the requirement, not the mechanism).
   10. A build-time option that disables the cloud methods (cloud separation, YouTube
       fetching). Instead of the features disappearing, the UI should explain they're only
       available in self-hosted versions, not the public deployed app, and link to the
       GitHub repo. Pin down: the exact copy for each affected surface (buttons, menus,
       error states) and the required behavior when both this and item 9 apply.
   11. Improve the README drastically while keeping it compact and concise: what the app is,
       screenshots (to be collected), easy-to-scan layout, and very simple deployment steps
       for anyone self-hosting. Produce the outline and the exact list of screenshots with
       where each should appear.
