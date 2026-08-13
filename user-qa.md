# Atarang User-Perspective QA Report

Date tested: 13 August 2026  
Test target: local Atarang web app at `http://localhost:4173`  
Approach: black-box testing only. The application source code was not read or inspected. Cloud separation was excluded as requested because CUDA was unavailable.

## Re-verification pass

Date re-verified: 13 August 2026, against the app built from `36eaf4c`, five commits after the original pass (`7a80b4a..36eaf4c`: sing-along lyric gestures, library management, recording playback, chord voicing library, stem pan and meters).

Method for this pass differs from the original: the running preview build was exercised as before, **and** the source was read to confirm each finding's cause and to distinguish "not reproduced today" from "actually fixed". The Green Day MP3 used originally was not available, so the bundled **Backbeat** demo was imported instead and the long-title Library case was reproduced by substituting a long title into the rendered row. Cloud and local separation were again not executed.

Every finding below now carries a **Re-verified** line. Summary of what moved:

- **Fixed:** none outright. Two findings are partly fixed — issue 11 (sing-along now has an explicit exit and a Resume follow control) and issue 9 (Simplify and Capo now reachable on mobile).
- **Rewritten:** four descriptions. Issue 20 is the substantive change: its central claim was wrong, because analysis does not block the app, and its severity drops High → Medium. Issues 3, 9, and 11 were reworded to match surfaces rebuilt since the original pass — the Library table, the chart toolbar, and sing-along — narrowing each finding to the part that still reproduces.
- **Regression found:** one. Sing-along no longer shows any chord information at all, where the original pass found a small chord strip; the change landed in the sing-along gestures commit (issue 11).
- **Unchanged and re-reproduced:** issues 1, 2, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23.
- Screenshots in this report are all from the original pass. Those for issues 3 and 9 no longer match the current markup, though the defects they illustrate persist; both are flagged in place. The rest still represent what is on screen today.

## Executive summary

The core experience is promising: importing and playing a local song works, the detected chord changes and seeking are useful, mixer and looping controls are approachable, and the responsive design generally adapts to a phone-sized viewport. The most serious user-facing weaknesses are broken recovery on unknown routes, importing directly into Studio without an explicit processing/separation choice, and the Chords area lacking a coherent set of playback-oriented views.

The main detected-chord presentation is one static horizontal bar. The **NOW** and **NEXT** labels change as the song plays, but the bar itself does not scroll with time, so users lose useful past/upcoming context. Selecting **Create editable chart** then replaces this with a different static list and is also the gateway to Transpose, Simplify, and Capo. These should be independent concepts: users should choose among multiple chord views, use the same musical transformations in every view, and enter editing only when they want to correct chart content.

## Personas used

- **Power user:** highly technical and musically literate; expects precision, efficient navigation, keyboard support, advanced chord controls, and workflows that preserve context.
- **Complete newbie:** unfamiliar with both audio technology and music terminology; needs obvious labels, guidance, forgiving errors, and clear differences between similar screens.
- **Everyone in between:** casual musicians, learners, singers, and semi-experienced users who need an understandable default experience with optional depth.

## Severity definitions

- **Critical:** blocks the primary experience for nearly everyone, causes data loss, or makes the app broadly unusable. No critical issues were reproduced in this pass.
- **High:** breaks or seriously degrades a major workflow, has no clear recovery, or creates a strong risk of user abandonment.
- **Medium:** causes significant confusion, makes a feature incomplete, or forces an avoidable workaround, but the main workflow remains possible.
- **Low:** a polish, consistency, or discoverability defect with limited workflow impact.

## Test coverage and happy paths

The following areas and states were exercised from the rendered UI:

- Library browsing, search, category switching, local audio import, and YouTube-fetch validation and error states.
- Studio playback, seeking, mixer controls, mute/solo interactions, looping, detected chords, editable chart creation, ChordPro paste/import validation, transpose, simplification, capo, diagrams, lyrics, sheet, and sing-along mode.
- Empty or incomplete inputs, malformed input, invalid URL input, rapid repeated interactions, browser refresh, back/forward navigation, unknown routes, keyboard tab navigation, attempted arrow-key tab navigation, and desktop/mobile resizing.
- Desktop and a 390 × 844 mobile viewport.

Happy paths completed:

- **Power user:** imported a full MP3, played and precisely sought within it, used the detected chord timeline, tested mixer and loop controls, created a user chart, and exercised transpose, simplification, capo, diagrams, and chart import/export controls.
- **Complete newbie:** entered through the Library, used the prominent local import action, opened the imported song, started playback, switched among the plainly visible Studio tabs, and entered sing-along mode.
- **Everyone in between:** searched and filtered the Library, opened the bundled demo and imported song, used playback and chord-following tools, and compared Lyrics, Sheet, and Chords presentations.

No data-loss condition or consistently reproducible crash was found. The imported Green Day track remained available after navigation and refresh.

---

# UI/UX issues

## 1. Horizontal chord timeline does not scroll with playback

- **Category & Severity:** UI/UX — **High**. The primary chord-following surface does not visually follow the song.
- **Description:** The detected Chords view is a single horizontal chord bar. During playback, the large **NOW** and **NEXT** labels change, but the bar itself remains static instead of moving through the chart with song time. This limits the visible musical context and makes the bar feel more like a snapshot than a follow-along view. Expected the timeline to scroll continuously with playback, keeping the current chord or playhead in a stable position while upcoming chords move into view.
- **Steps to reproduce:**
  1. Start from Library with the imported Green Day song present.
  2. Open the song and select **Chords**.
  3. Start playback and watch **NOW**, **NEXT**, and the horizontal chord bar.
  4. Let several chord changes pass or seek to a later section.
  5. Observe that **NOW/NEXT** update while the horizontal bar itself does not scroll along with song time.
- **Context:** Studio > Chords, using the imported Green Day MP3 with detected chords. Tested on desktop and mobile.
- **Affected persona(s):** Power user, complete newbie, and everyone in between.
- **Suggested improvement:** Turn this into a true scrolling **Timeline** view. Keep a playhead or the current chord anchored—preferably near the left third or center—while past chords move away and upcoming chords approach. Preserve tap/click-to-seek, visually emphasize the current chord, and allow users to pause automatic following when they manually scroll.
- **Impact:** Fixing this creates an immediately readable rehearsal and performance view with useful look-ahead. Left as-is, users must rely mostly on two changing labels and cannot visually anticipate a longer progression.
- **Re-verified:** Still valid, unchanged. The bar is a fixed-width flex row in which every detected segment is laid out proportionally to its duration, so the whole song is always compressed into one screen width and nothing moves as time passes. On a 46-second demo with two chords this looks deliberate; on a real song with the ~114 events measured in the first pass, each chord collapses to a few pixels. Only the highlight on the active segment changes during playback.

## 2. “Create editable chart” incorrectly combines view selection, customization, and editing

- **Category & Severity:** UI/UX — **High**. A misleading gateway hides useful controls and replaces the current presentation instead of simply changing views.
- **Description:** **Create editable chart** sounds like an authoring action, but selecting it also changes the entire chord presentation and reveals Transpose, Simplify, Capo, Import, and Export. Those transformations are useful during ordinary playback and should not depend on creating a separate chart. The resulting screen also offers no clear way to edit an individual chord, timing, or section. Expected view selection, musical transformations, and content editing to be three separate controls.
- **Steps to reproduce:**
  1. Open an imported song with detected chords.
  2. Go to **Chords**.
  3. Note that Transpose, Simplify, and Capo are not available in the initial horizontal-bar view.
  4. Select **Create editable chart**.
  5. Observe that the view changes and the global musical controls now appear.
  6. Click or tap individual chord rows and look for actual chord, timing, add, remove, and section editing.
- **Context:** Studio > Chords > User chart, desktop and 390 × 844 mobile viewport.
- **Affected persona(s):** All personas. Power users expect flexible transformations; newbies are likely to misunderstand the destructive-sounding label.
- **Suggested improvement:** Replace **Create editable chart** as the presentation gateway with a visible **View** selector. Keep Transpose, Simplify, Capo, and other display/play transformations in a persistent shared toolbar that works in every view. Provide a separate **Edit** action only for correcting chords, timings, lyrics alignment, or sections, with explicit Save and Cancel behavior.
- **Impact:** Fixing it makes every view musically useful and makes editing understandable. Left as-is, users must create a different artifact merely to transpose or simplify, then discover that the “editable” result offers little direct editing.
- **Re-verified:** Still valid, unchanged, and confirmed to be destructive to the current presentation rather than additive. Creating a chart — or importing or pasting one — immediately and permanently replaces the detected timeline for that song; the detected view returns only when every chart for the song is deleted. The resulting chart screen still offers no way to edit a chord, a timing, or a section: the only per-chart controls are chart selection, Import, Export, Transpose, Simplify, Capo, and Delete.

## 3. Mobile Library actions overlap long song titles

- **Category & Severity:** UI/UX — **High**. Core Library actions become hard to read and operate for realistic content.
- **Description:** At a phone-width viewport, the row’s action controls overlap and obscure a long song title. The content hierarchy breaks down and tap targets become visually ambiguous. Expected song metadata and actions to reflow into separate rows without collision.
- **Steps to reproduce:**
  1. Import or display a song with a long title, such as the Green Day test MP3.
  2. Navigate to **Library**.
  3. Resize the viewport to approximately 375–390 pixels wide.
  4. Inspect the song row’s title and its right-side actions.
- **Context:** Library, mobile layout, imported song with a long title.
- **Affected persona(s):** All mobile users, especially complete newbies who rely on visible labels.
- **Suggested improvement:** Reflow actions beneath the song information or use a clearly labelled overflow menu while preserving a generous, unambiguous primary open/play target.
- **Impact:** Fixing it restores confidence and tap accuracy on mobile. Left as-is, users may trigger the wrong action or assume the Library does not properly support phones.
- **Re-verified:** Still valid; the description above was rewritten because the Library has since been rebuilt from cards into a selectable table with categories, bulk actions, and inline preview. The defect survived the rebuild and is now easier to characterise. On mobile the row becomes a two-column grid: song information, then a fixed 96-pixel action column. The title truncates with an ellipsis as intended, but each original row carries five actions (**Open**, preview, **Separate**, remove-analysis, remove), which cannot fit 96 pixels and spill leftward across the truncated title. At 375 pixels the words **Open** and **Separate** rendered directly on top of the title text. The screenshot below is from the original card layout and no longer matches the current markup, but shows the same collision.

![Mobile Library title/action overlap](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/library-mobile-overlap.png)

## 4. Chords has no persistent selector for alternative playback views

- **Category & Severity:** UI/UX — **Medium**. Users lose access to a valuable view and the path back is destructive or obscure.
- **Description:** Chords starts as one static horizontal bar, while **Create editable chart** switches to a separate vertical chart. There is no persistent control that presents these as alternative ways to view the same chord data. Once a user chart exists, there is also no obvious way to return to the detected presentation without deleting it. Expected a stable view selector that never changes or destroys the underlying chord source.
- **Steps to reproduce:**
  1. Open a song with detected chords.
  2. Go to **Chords** and note the horizontal timeline presentation.
  3. Select **Create editable chart**.
  4. Look for a way to return to the detected timeline without deleting the user chart.
- **Context:** Studio > Chords after user-chart creation.
- **Affected persona(s):** Power users and everyone in between; newbies are especially unlikely to infer that deletion restores the previous view.
- **Suggested improvement:** Provide a persistent, plainly labelled selector such as **Timeline**, **Chart**, and **Lyrics + Chords**. Treat detected versus user-corrected chords as a separate source/status choice, not as different views. Remember the user’s selected view per song or globally.
- **Impact:** Fixing it lets users choose the right presentation for listening, practice, or performance without losing work. Left as-is, the app presents related layouts as unrelated workflows and makes deletion feel like navigation.
- **Re-verified:** Still valid, unchanged. The only selector on the chart screen is a dropdown that chooses *which user chart* to show; it never offers the detected timeline as an option. Deleting the last chart remains the only route back, and the app does not warn that deletion is what restores the previous presentation.

## 5. Chord and lyrics presentation modes are implicit rather than selectable

- **Category & Severity:** UI/UX — **Medium**. A key musical customization need is only partially met and difficult to discover.
- **Description:** The Lyrics tab implicitly combines a small detected-chord strip with lyrics, while Chords offers a horizontal timeline or static chart. There is no view where chord names are positioned above the lyric words or syllables at which they change, as in common guitar-tab and lead-sheet experiences such as Ultimate Guitar. Pasted chord syntax such as `[Bm]` remains literal text rather than being rendered above its lyric position. Expected this to be a first-class Chords view, not an incidental variation of the Lyrics tab.
- **Steps to reproduce:**
  1. Open the imported song in Studio.
  2. Compare **Chords**, **Lyrics**, and **Sheet**.
  3. Paste or view lyrics containing inline chord notation such as `[Bm]`.
  4. Look for display controls for lyrics-only, chords-only, or chords aligned above words.
- **Context:** Studio > Chords, Lyrics, and Sheet; desktop and mobile.
- **Affected persona(s):** All personas. Power users need presentation control; newbies need clear purpose and defaults.
- **Suggested improvement:** Add a **Lyrics + Chords** view that renders chords on a separate line above the corresponding lyric words, maintains alignment when text wraps, highlights or scrolls the current lyric/chord during playback, and can switch to lyrics-only or chords-only. Keep Transpose, Simplify, and Capo available here exactly as in the other chord views.
- **Impact:** Fixing it turns several disconnected surfaces into one understandable musical workflow. Left as-is, users must hunt among tabs and still cannot get common rehearsal/performance layouts.
- **Re-verified:** Still valid, unchanged, and re-reproduced directly. A lyric line written as `Walking down the [Bm] boulevard tonight` renders with the literal text `[Bm]` inline, in the Lyrics tab and in sing-along alike. Square-bracket notation is only interpreted in ChordPro charts pasted into the Chords tab, never in lyrics; there is still no view that positions chord names above the words where they change, and no lyrics-only or chords-only switch anywhere.

## 6. Lyrics and Sheet screens have unclear, overlapping purposes

- **Category & Severity:** UI/UX — **Medium**. Two major tabs look related but do not explain their distinction.
- **Description:** Lyrics appears to be timed and editable, while Sheet is a plainer untimed presentation. The UI does not explain this distinction, and inline chord notation can remain as literal text. Expected each tab to state its purpose or for the views to be unified under a single display-mode control.
- **Steps to reproduce:**
  1. Open a song in Studio.
  2. Select **Lyrics** and note its controls and presentation.
  3. Select **Sheet** and compare the same content.
  4. Look for explanatory text, tooltips, or a visible distinction in purpose.
- **Context:** Studio > Lyrics and Studio > Sheet.
- **Affected persona(s):** Complete newbie and casual users most strongly; also power users looking for a predictable workflow.
- **Suggested improvement:** Rename them around their actual purpose, add a one-line explanation, or combine them as modes of one lyrics/chart screen—for example **Synced lyrics**, **Lead sheet**, and **Plain text**.
- **Impact:** Fixing it lowers navigation friction and helps users choose correctly. Left as-is, users repeatedly switch tabs to rediscover what each one means.
- **Re-verified:** Still valid, unchanged. **Sheet** is the song title followed by the same lyric lines as the Lyrics tab with their timings, chord strip, and controls stripped out; it has no controls of its own, no explanatory text, and no relationship to chord data despite the name suggesting a lead sheet. When no lyrics exist it reads “Import lyrics to build a practice sheet,” which is the only hint that it derives from the Lyrics tab. A fourth tab, **Takes**, has since been added alongside them and is clearly distinct, so the ambiguity is specific to Lyrics and Sheet.

![Sheet’s plain presentation](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/sheet-plain-view.png)

## 7. Paste-chart panel cannot be closed or cancelled

- **Category & Severity:** UI/UX — **Medium**. A temporary editing surface becomes a persistent obstruction.
- **Description:** Selecting **Paste chart** opens the ChordPro paste box, but selecting the action again does not toggle it closed, there is no visible close/cancel control, and Escape did not dismiss it. Expected a visible **Cancel** or close action, and preferably Escape support.
- **Steps to reproduce:**
  1. Open a song and select **Chords**.
  2. Select **Paste chart**.
  3. Attempt to close it by selecting **Paste chart** again.
  4. Press Escape.
  5. Look for **Cancel**, close, or collapse controls.
- **Context:** Studio > Chords > Paste chart panel.
- **Affected persona(s):** All personas, especially newbies who may fear losing or altering data.
- **Suggested improvement:** Add a visible **Cancel** or close control, make the trigger toggle the panel, and support Escape when focus is inside the temporary editor.
- **Impact:** Fixing it makes experimentation safe and keeps the Chords screen manageable. Left as-is, users must navigate away or refresh to clear unwanted UI.
- **Re-verified:** Still valid, unchanged. The panel opens with a single **Add chart** button and nothing else; the trigger sets the panel open rather than toggling it, and no Escape handler is bound. Worth noting for contrast: the Separate-song sheet added since the original pass *does* close on Escape and restores focus, so the pattern exists in the codebase and simply has not reached this panel. One additional detail observed this pass: the textarea placeholder displays a literal `\n` — it reads `{title: Song}\n[Am]Lyrics with [F]chords` instead of breaking onto a second line, which misrepresents the format users are being asked to paste.

![Paste chart panel without a close action](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/paste-chart-no-close.png)

## 8. Import and YouTube acquisition actions look like unrelated components

- **Category & Severity:** UI/UX — **Medium**. Two peer entry points have inconsistent hierarchy and layout.
- **Description:** **Fetch from YouTube** and **Import local audio** are alternative ways to add music, but they do not use the same visual container or interaction pattern. The YouTube banner’s earlier alignment problem appears fixed, yet the acquisition choices still do not read as equal, related actions. Expected matching cards side by side on desktop and stacked on mobile.
- **Steps to reproduce:**
  1. Navigate to **Library** on desktop.
  2. Compare **Fetch from YouTube** with **Import local audio**.
  3. Resize to mobile width and compare their stacking, spacing, and visual treatment.
- **Context:** Library empty/add-content area and populated Library.
- **Affected persona(s):** Complete newbie and casual users most strongly; all users are affected by inconsistent hierarchy.
- **Suggested improvement:** Present both as matching acquisition cards with parallel titles, descriptions, controls, feedback, and responsive behavior: side by side on desktop and stacked on mobile.
- **Impact:** Fixing it makes the first-use choice immediate and reduces the impression that one path is secondary or experimental. Left as-is, users may overlook one import method or misunderstand their relationship.
- **Re-verified:** Still valid, and slightly worse on mobile. **Fetch from YouTube** is a full-width bordered section with a heading, explanatory copy, and its own form; **Import audio** is a single button in the page header, structurally unrelated to it. At phone width the import button loses its text label entirely and collapses into an unlabelled `+` square, while the YouTube section keeps its full heading and description — so the two acquisition paths read as even less like peers than on desktop. The screenshot below still represents the desktop arrangement accurately.

![Desktop Library acquisition area](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/library-desktop.png)

## 9. Mobile chart customization toolbar is clipped

- **Category & Severity:** UI/UX — **Medium**. Important controls are partially or completely unavailable on a supported layout.
- **Description:** In the phone-width editable-chart view, transpose controls are unavailable and the delete action is cut off beyond the available width. There is no horizontal-scroll cue or overflow menu. Expected all chart actions to reflow, wrap, or move into a labelled overflow menu.
- **Steps to reproduce:**
  1. Open a song and create an editable chart.
  2. Resize to approximately 375–390 pixels wide.
  3. Inspect the action toolbar above the chart.
  4. Attempt to reach transpose, simplify, capo, and delete controls.
- **Context:** Studio > Chords > User chart, mobile viewport.
- **Affected persona(s):** All mobile users, especially power users who rely on these controls.
- **Suggested improvement:** Wrap controls into multiple rows or group secondary actions under a clearly labelled **Chart options** menu. Keep the primary mode selector and edit action visible.
- **Impact:** Fixing it gives mobile parity with desktop. Left as-is, phone users cannot reliably access the features that justify creating a chart.
- **Re-verified:** Partly fixed, still valid, and the description above was updated. **Simplify** is now fully visible at 375 pixels and **Capo** is reachable in the chart header, so those two parts of the original finding no longer reproduce. Two problems remain, and the transpose one is more serious than “clipped” suggested: the transpose label, readout, and both stepper buttons are deliberately hidden below 760 pixels — a rule that predates the original pass — so transposition is not merely hard to reach on a phone, it is unavailable, with nothing on screen indicating the feature exists. The delete control is still cut off: the toolbar is a non-wrapping row measuring 384 pixels of content in a 375-pixel container with overflow visible, so the overhang neither wraps nor scrolls. The screenshot below predates these changes.

![Clipped mobile editable-chart controls](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/chords-editable-mobile.png)

## 10. Chord diagrams are detached from current playback

- **Category & Severity:** UI/UX — **Medium**. Guidance shown during practice is not contextually relevant.
- **Description:** The user chart displayed four diagrams corresponding to opening chords even while playback was around `01:26`, where the sounding/detected chords were different. Expected diagrams to follow the current chord or a selected chord, or to be clearly labelled as a static chart summary.
- **Steps to reproduce:**
  1. Create or open a user chart with chord diagrams visible.
  2. Start playback.
  3. Seek to a later section around `01:26`.
  4. Compare the diagrams with the current detected chord and chart position.
- **Context:** Studio > Chords > User chart during playback.
- **Affected persona(s):** Newbies and learners most strongly; also performers using diagrams as prompts.
- **Suggested improvement:** Make the primary diagram follow the current chord, show the next chord as an optional secondary diagram, and allow selection of a chart chord to pin its fingering. Clearly indicate when diagrams are pinned.
- **Impact:** Fixing it turns diagrams into useful live guidance. Left as-is, learners may play the wrong shape or conclude the chord analysis is inconsistent.
- **Re-verified:** Still valid, unchanged. The diagram strip is the first four distinct chords found anywhere in the chart, computed once and never consulted against playback position; it is unlabelled, so nothing tells the user it is a summary rather than a cue. A chord-voicing library was added since the original pass, so a user’s own saved voicing now wins over the built-in shape and is marked “Your voicing” — but which four chords are drawn, and when, is unchanged.

## 11. Sing-along mode is not a complete performance view

- **Category & Severity:** UI/UX — **Medium**. The immersive mode enlarges content but omits key context and control.
- **Description:** Sing-along/fullscreen enlarges the lyrics, but shows no chord information at all, continues to show literal inline notation such as `[Bm]`, and provides no in-view transport controls. Expected a purpose-built performance surface with readable chord/lyric hierarchy, minimal transport, and a clear exit affordance.
- **Steps to reproduce:**
  1. Open the song and select **Lyrics**.
  2. Select **Sing along**.
  3. Observe lyrics, chord strip, inline chord notation, playback controls, and exit affordance.
  4. Attempt to pause or seek without leaving the view.
- **Context:** Studio > Lyrics > Sing along/fullscreen.
- **Affected persona(s):** Singers and casual users; power users performing from the app.
- **Suggested improvement:** Provide large synced lyrics with an optional chords-above-words layout, current/next chord emphasis, tap-to-reveal transport, adjustable font size, and a clear **Exit sing along** action.
- **Impact:** Fixing it makes the mode genuinely usable at a music stand or across a room. Left as-is, it is primarily a text enlargement rather than a dependable performance experience.
- **Re-verified:** Partly fixed; the description above was updated. The exit problem is resolved: the mode now presents a header carrying the song title and an explicit **Exit sing-along** button, and a **Resume follow** control appears once the user scrolls away from the tracked line. The rest stands, and the chord part regressed. The compact chord strip is no longer merely small — it is removed entirely in sing-along, so the mode now shows no chords whatsoever. Inline `[Bm]` still renders literally. Sing-along is a fixed full-screen overlay that covers the transport bar, so there is no way to pause, seek, or loop without exiting, and there is still no font-size control.

## 12. Search state persists invisibly across Library category changes

- **Category & Severity:** UI/UX — **Low**. The app can appear to have missing content because an old filter remains active.
- **Description:** A Library search query persists when switching categories. Depending on the layout and focus, the retained constraint is easy to overlook. Expected the app either to clear search on category change or make the active query/filter state unmistakable.
- **Steps to reproduce:**
  1. Go to **Library**.
  2. Enter a search query that filters the visible songs.
  3. Switch to another Library category.
  4. Observe that the prior query continues to affect the result.
- **Context:** Library search and category navigation.
- **Affected persona(s):** Complete newbie and casual users.
- **Suggested improvement:** Show the active query as a persistent filter chip with a one-tap clear action, or reset it when changing categories and announce that behavior.
- **Impact:** Fixing it prevents false empty states. Left as-is, users may believe songs have disappeared or another category is broken.
- **Re-verified:** Still valid, unchanged, and now inconsistent with the app’s own treatment of view state. Since the original pass the selected category has been moved into the URL, so it survives Back and reload — but the search query deliberately has not, and it is also not cleared when the category changes. Selection state *is* cleared on both category and query changes. The result is that the one piece of state that silently filters the list is the one piece with no visible representation anywhere; only the input’s placeholder changes, from “Search originals” to “Search separated”.

## 13. Mobile Settings navigation is clipped

- **Category & Severity:** UI/UX — **Low**. Secondary navigation is less discoverable and harder to operate on narrow screens.
- **Description:** At mobile width, Settings navigation content is clipped rather than reflowing cleanly. Expected all Settings sections to remain visible through wrapping, a compact selector, or clearly scrollable tabs.
- **Steps to reproduce:**
  1. Navigate to **Settings**.
  2. Resize to approximately 390 pixels wide.
  3. Inspect the section navigation and attempt to reach all choices.
- **Context:** Settings, mobile viewport.
- **Affected persona(s):** All mobile users.
- **Suggested improvement:** Use a native compact select, wrapped controls, or an explicitly scrollable tab row with edge cues.
- **Impact:** Fixing it makes configuration dependable on phones. Left as-is, some settings appear unavailable.
- **Re-verified:** Still valid, and marginally worse. A fifth section, **Chords**, has been added since the original pass, so more content competes for the same width. At 375 pixels the navigation shows Storage, Audio, Chords, and a truncated **M**, with Privacy entirely off-screen. The row is technically scrollable horizontally, so the sections are reachable, but there is no scrollbar, fade, or arrow to indicate that — which is precisely why this also appears as issue 23.

## 14. Every tested page uses the generic title “Atarang Studio”

- **Category & Severity:** UI/UX — **Low**. Browser history and tabs do not reflect the current location or song.
- **Description:** Library, Settings, and individual Studio pages use the same browser page title. Expected titles such as “Library — Atarang,” “Settings — Atarang,” or the current song name.
- **Steps to reproduce:**
  1. Open Library, Settings, and a song in Studio in sequence.
  2. Observe the browser tab title or history entries after each navigation.
- **Context:** All tested routes.
- **Affected persona(s):** Power users and anyone using multiple tabs or assistive navigation history.
- **Suggested improvement:** Use route- and song-specific page titles.
- **Impact:** Fixing it improves orientation, history scanning, bookmarking, and multi-tab use. Left as-is, every page is indistinguishable outside the content area.
- **Re-verified:** Still valid, unchanged. The title is set once in the page shell and never updated; nothing in the app writes to it on navigation. Every route — Library, Settings, the demo preview, and each individual song — reports **Atarang Studio**.

---

# Functionality issues

## 15. Local import bypasses the separation/processing choice

- **Category & Severity:** Functionality — **High**. A primary end-to-end flow skips an expected decision point.
- **Description:** Selecting **Import local audio** and choosing the Green Day MP3 opened the imported song directly in Studio. There was no intermediate choice explaining whether to separate stems, analyze only, or continue without separation. Expected import to present the processing options before entering Studio, or to make the chosen automatic behavior explicit and reversible. This rechecks the earlier report and remains broken.
- **Steps to reproduce:**
  1. Start on **Library**.
  2. Select **Import local audio**.
  3. Choose a valid MP3.
  4. Complete the file picker.
  5. Observe that the app navigates directly to the song’s Studio screen.
- **Context:** Library > Import local audio, using the supplied Green Day MP3. Cloud separation itself was not executed because CUDA was unavailable.
- **Affected persona(s):** All personas. Newbies miss guidance; power users lose workflow control.
- **Suggested improvement:** After file selection, show a concise choice: **Open and analyze**, **Separate stems**, or **Open without processing**, with expected time/resource notes and a remembered default for experienced users.
- **Impact:** Fixing it makes the app’s core promise understandable and gives users control over processing time and outputs. Left as-is, users may believe separation happened, is unavailable, or must be found later.
- **Re-verified:** Still valid for the **Import audio** path, but the remaining work is smaller than it was. A **Separate this song** sheet now exists and offers exactly the kind of choice this finding asked for — local on this device, cloud on your server, or a verified package, each with its readiness stated — and it opens automatically when a song is entered with the separation intent set. The Library already uses that route from its per-song **Separate** action and from the demo’s **Add & separate**. Choosing **Import audio** still bypasses it entirely and lands the user in Studio with no choice offered. The fix is now largely a matter of routing local import through the sheet that already exists, plus adding an explicit “open without processing” option and a remembered default.

## 16. Unknown routes expose a developer-facing React Router error page

- **Category & Severity:** Functionality — **High**. A common navigation failure has no user recovery and exposes implementation-oriented messaging.
- **Description:** Visiting an unknown route displays **“Unexpected Application Error!”**, **“404 Not Found”**, **“Hey developer”**, and advice about providing an ErrorBoundary. There is no clear way back to Library or Home. Expected a branded not-found page with recovery actions and no developer instructions.
- **Steps to reproduce:**
  1. Start from any working app page.
  2. Change the URL path to a route that does not exist.
  3. Load the page.
  4. Observe the complete error content and available actions.
- **Context:** Unknown application route in the in-app browser.
- **Affected persona(s):** All personas; especially complete newbies, who may interpret the app as crashed.
- **Suggested improvement:** Show a friendly “Page not found” screen with **Go to Library**, **Go back**, and optional diagnostic detail hidden behind a disclosure.
- **Impact:** Fixing it turns a dead end into a one-click recovery and improves trust. Left as-is, malformed bookmarks and stale links strand users on a developer error page.
- **Re-verified:** Still valid, unchanged, and re-reproduced verbatim. The router defines only the three real routes and declares neither a catch-all nor an error element, so the framework’s built-in developer page is what unknown paths render — white-on-black **Unexpected Application Error!**, **404 Not Found**, “Hey developer 👋”, and advice to supply an `ErrorBoundary`, with no navigation of any kind and none of the app’s own shell. Worth contrasting with the app’s own handling of a *known* route with a missing song, which is already correct: opening a removed song ID gives “Song not found”, a plain explanation, and a **Return to Library** link. That page is the model the not-found route should follow.

![Developer-facing unknown-route error](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/unknown-route-error.png)

## 17. Malformed ChordPro input is accepted without useful validation

- **Category & Severity:** Functionality — **Medium**. Bad input can create confusing or incomplete chart content without telling the user what went wrong.
- **Description:** Pasting malformed content such as `{title:` was accepted without a clear inline error identifying the invalid directive or its location. Expected validation before import, preserving the text for correction and explaining the exact problem.
- **Steps to reproduce:**
  1. Open a song and go to **Chords**.
  2. Select **Paste chart**.
  3. Enter `{title:`.
  4. Submit/import the chart.
  5. Observe the lack of actionable validation feedback.
- **Context:** Studio > Chords > Paste chart, malformed ChordPro input.
- **Affected persona(s):** Power users importing charts and newbies copying text from another source.
- **Suggested improvement:** Validate before replacing the current chart, point to the offending line/directive, show a small valid example, and keep the user’s text intact for repair.
- **Impact:** Fixing it prevents corrupted-looking charts and makes import self-correcting. Left as-is, users cannot distinguish unsupported syntax from a broken importer.
- **Re-verified:** Still valid, unchanged, and re-reproduced exactly. Pasting `{title:` and pressing **Add chart** created a chart titled after the song, whose single lyric line is the literal text `{title:`. The parser recognises a directive only when the whole line matches a complete `{name: value}` form and treats anything else as lyrics, so an unclosed or misspelled directive can never fail — it silently becomes song text. Two consequences make this worse than a cosmetic problem: the paste panel closes and discards the user’s text, so there is nothing left to correct; and, per issue 2, the new chart immediately replaces the detected chord timeline for that song.

## 18. Demo tempo analysis can remain stuck on “Analyzing”

- **Category & Severity:** Functionality — **Medium**. A musical metadata feature never reaches a result or explainable failure for bundled content.
- **Description:** The bundled **Backbeat** demo continued to display **“Analyzing”** for tempo during the test, while the imported Green Day MP3 showed `165 BPM`. Expected the demo to complete, state that tempo is unavailable, or offer a retry after a reasonable timeout.
- **Steps to reproduce:**
  1. Open **Studio** without opening a song, so the bundled **Backbeat** demo preview loads.
  2. Select the **Practice** panel and find the **Tempo** row.
  3. Wait, and navigate among Studio tabs.
  4. Refresh and revisit if needed.
  5. Observe that the tempo remains **“Analyzing”**.
- **Context:** Studio for bundled Backbeat demo; comparison made with imported MP3.
- **Affected persona(s):** All personas, especially musicians expecting tempo-dependent practice tools.
- **Suggested improvement:** Replace indefinite progress with a bounded state: result, **Tempo unavailable**, or **Retry analysis**. Explain if bundled/demo audio does not support analysis.
- **Impact:** Fixing it makes system status trustworthy. Left as-is, users cannot tell slow processing from a permanent failure.
- **Re-verified:** Still valid, unchanged, and the cause is now identified precisely. The condition is not the demo audio and not slowness: it is the **demo preview** route reached by opening Studio without a song. That route plays bundled audio that was never imported into the library, so no analysis job is ever started for it, and the Tempo readout renders “Analyzing” as its fallback whenever no beat grid exists. The state is therefore permanent by construction and would never resolve however long a user waits. Adding the same demo to the library and opening it produces a real BPM, confirming the analysis path itself is healthy. The word “Analyzing” is asserting work that is not happening.

## 19. User-facing errors expose raw parsing and URL-construction messages

- **Category & Severity:** Functionality — **Low**. Validation technically fails but does not help users recover.
- **Description:** Invalid acquisition/input attempts surfaced messages such as **“Unexpected token '<'…”** and **“Failed to construct 'URL': Invalid URL”**. These describe internal parsing or browser API behavior instead of what the user should correct. Expected plain-language guidance tied to the field or action.
- **Steps to reproduce:**
  1. Go to the Library’s YouTube-fetch input.
  2. Submit an invalid or unsupported URL.
  3. Repeat with malformed values where accepted.
  4. Observe the raw error wording.
- **Context:** Library > Fetch from YouTube validation/error states.
- **Affected persona(s):** Complete newbie most strongly; also all users trying to diagnose a failed fetch.
- **Suggested improvement:** State what is valid, for example: “Enter a full YouTube video URL, such as `https://www.youtube.com/watch?v=…`.” For server failures, say the fetch failed and offer retry without exposing response-parser text.
- **Impact:** Fixing it turns errors into recovery instructions. Left as-is, users cannot tell whether the URL, network, source, or app is at fault.
- **Re-verified:** Still valid, unchanged, and present in a second place not noted originally. The YouTube fetch failure path renders the raw exception message directly, so any parser or network error text reaches the user verbatim. The same pattern appears in **Settings > Cloud processing**, where a failed server check reports `Server check failed:` followed by the raw message, and where an unparseable server origin raises the browser’s own “Failed to construct 'URL': Invalid URL”. Both should be fixed together. Note that the app already does this well elsewhere — import failures, model operations, and LRCLIB lookups all map error codes to plain-language sentences — so this is an inconsistency rather than a missing capability.

---

# Performance observations

## 20. Chord detection reports no status of its own, and the Chords tab denies it is running

- **Category & Severity:** Performance — **Medium**, revised down from High in the original pass. Analysis does not block the app; what is missing is honest status while it runs.
- **Description:** While a newly imported song is being analyzed, the Chords tab shows an empty state reading **“No chord chart yet — Run chord detection, import ChordPro, or paste a chart.”** That message denies that anything is in progress and names an action, *Run chord detection*, that the interface does not actually offer anywhere. Chords then appear on their own with no completion signal. The only visible status during this period is **“Analyzing waveform…”** on the transport, which names the waveform, so a user watching the Chords tab has no reason to connect it to the chords they are waiting for. Expected an honest status in the Chords area itself, distinguishing “running”, “finished with no result”, and “failed”.
- **Steps to reproduce:**
  1. Start from Library with a newly imported song that has not completed chord analysis.
  2. Open the song and navigate to **Chords** while analysis is running.
  3. Read the empty state and look for any indication that work is under way, and for the **Run chord detection** action it names.
  4. Wait for chords to appear and observe whether anything marks completion.
- **Context:** Import and Studio workflows while initial chord detection or later re-analysis is in progress. This also applies when detected chords are upgraded after another processing step.
- **Affected persona(s):** All personas. Newbies may conclude the feature failed and start pasting a chart by hand; casual users may abandon the song; power users need control over expensive work.
- **Suggested improvement:** Give the Chords tab its own status. While the job runs, say so there — with a real percentage where progress is measurable, and an honest indeterminate indicator naming the current stage where it is not — instead of an empty state that describes the song as having no chords. Reserve **“No chord chart yet”** for songs whose analysis has genuinely finished without a usable result, and either implement the **Run chord detection** action that text promises or stop naming it. Mark completion, and offer **Cancel** and **Retry** where safe. If automatic analysis is to become optional, add an **Automatically analyze imported songs** preference, defaulting to on.
- **Impact:** Fixing it makes analysis legible and stops the app from reporting a false negative during normal operation. Left as-is, the interface actively misinforms users during the one window in which they are most likely to be watching it.
- **Re-verified:** The original finding’s central claim does not hold and has been rewritten above; the severity is reduced accordingly. Analysis is **already** a non-blocking background job: it runs in a worker, playback starts immediately, Studio tabs and panels stay interactive throughout, and navigating away and back does not restart it. Nothing in the tested scope forced a user to wait. What survives is the status problem, now stated more precisely — the misleading empty state, the absence of any chord-specific progress, and the `Run chord detection` action named in copy but not implemented. One part of the app already does this correctly and is worth copying: the stem re-decode after separation announces itself as **“Re-reading chords from the separated stems… 42%”** with a real percentage. That is exactly the treatment the first analysis pass lacks.

Apart from the status problem above, no consistently reproducible rendering or playback slowdown was found in the tested scope.

The imported track loaded and played, rapid repeated playback interactions did not produce a visible crash, the detected timeline containing approximately 114 chord events remained responsive, and clicking a later chord sought promptly and continued playback. The Backbeat tempo state that remained on **“Analyzing”** is classified as Functionality, and the re-verification pass confirmed it is a permanent state on the demo preview route rather than slow work — see issue 18.

This does not substitute for measurement on low-end phones, a large library, very long audio, or a throttled network. Those environments were not available in this pass.

---

# Accessibility issues

## 21. Studio tabs do not support conventional arrow-key navigation

- **Category & Severity:** Accessibility — **Medium**. Keyboard users cannot operate a tab interface using the expected interaction model.
- **Description:** After focusing a Studio tab, pressing ArrowRight did not move selection to the next tab; **Sheet** remained selected. Expected Left/Right arrows to move among tabs, with a clear focus indicator and the selected tab communicated to assistive technology.
- **Steps to reproduce:**
  1. Open a song in Studio.
  2. Use Tab until a content tab such as **Sheet** receives keyboard focus.
  3. Press ArrowRight.
  4. Observe that focus/selection does not move to the adjacent tab.
- **Context:** Studio’s tab row, keyboard-only interaction.
- **Affected persona(s):** Keyboard-only users, users with motor impairments, screen-reader users, and power users expecting efficient navigation.
- **Suggested improvement:** Implement the conventional tab keyboard model: Left/Right arrows change the active tab, Home/End move to the first/last tab, Tab leaves the tablist, and visible focus is always retained.
- **Impact:** Fixing it provides predictable keyboard access and faster expert navigation. Left as-is, some users must tab through many controls or use a pointer to switch core views.
- **Re-verified:** Still valid, unchanged. The tab row declares the correct roles but binds no key handling at all, and every tab stays in the sequential tab order rather than using a roving tabindex, so neither half of the expected model is present. A fourth tab, **Takes**, has been added since the original pass, lengthening the run of tab stops. The app is not without keyboard support in general — the waveform slider handles arrows for seek and zoom, and the separation sheet handles Escape — which makes the tab row a gap rather than a policy.

## 22. Mixer controls expose duplicate accessible names

- **Category & Severity:** Accessibility — **Medium**. Assistive-technology users cannot reliably distinguish visually separate controls.
- **Description:** The rendered interface exposed duplicate names such as two controls announced as **“Mute Vocals”**. Similar duplication occurred for stem controls. Expected every interactive control to have an unambiguous name that includes its role and context.
- **Steps to reproduce:**
  1. Open a song in Studio and navigate to the mixer/stem controls.
  2. Inspect or traverse the controls through their accessible names.
  3. Note repeated names such as **“Mute Vocals”** for distinct interactive elements.
- **Context:** Studio mixer/stem controls.
- **Affected persona(s):** Screen-reader and voice-control users; also keyboard users when focus styling is subtle.
- **Suggested improvement:** Use unique user-facing names such as **“Mute vocals track”**, **“Solo vocals track”**, and **“Vocals volume”**, while avoiding nested or duplicate interactive targets for one action.
- **Impact:** Fixing it makes the mixer operable without sight and improves voice-command reliability. Left as-is, users may activate the wrong control or be unable to understand which duplicate is focused.
- **Re-verified:** Still valid, unchanged, and the duplication is now pinpointed. Each stem channel carries two separate controls that both toggle mute: a compact **M** button, named `Mute Vocals` unconditionally, and a speaker icon whose name alternates between `Mute Vocals` and `Unmute Vocals` with state. Whenever the stem is unmuted — the default for all four — both controls announce as `Mute Vocals`, giving four duplicate pairs. The alternating name is also a second problem in itself, since a control that renames itself on activation is hard to target by voice. Pan sliders and level meters, added since the original pass, are correctly and uniquely named.

## 23. Clipped mobile controls create accessibility barriers beyond visual polish

- **Category & Severity:** Accessibility — **Medium**. Controls that are off-screen without an obvious scrolling mechanism are effectively unavailable to some users.
- **Description:** The editable Chords toolbar and mobile Settings navigation contain clipped actions. This is especially problematic for zoom users, users with reduced dexterity, and anyone relying on switch or keyboard navigation, because there is no visible cue that more controls exist. Expected reflow at narrow widths and browser zoom.
- **Steps to reproduce:**
  1. Open a user chart or Settings.
  2. Set the viewport to approximately 390 pixels wide or increase browser zoom.
  3. Navigate through visible controls and inspect the edges of the toolbar/navigation.
  4. Observe partially visible or hidden actions without a clear overflow affordance.
- **Context:** Studio > Chords > User chart and Settings, narrow viewport.
- **Affected persona(s):** Low-vision users, keyboard/switch users, users with motor impairments, and all mobile users.
- **Suggested improvement:** Reflow controls without loss at narrow widths and high zoom; use a labelled overflow menu only for secondary actions, and keep focus from moving invisibly off-screen.
- **Impact:** Fixing it preserves feature access under zoom and on small devices. Left as-is, actions can be present in theory but unreachable in practice.
- **Re-verified:** Still valid, unchanged, and now shown to have two distinct failure modes rather than one. In Settings the navigation does scroll horizontally, so the hidden sections are reachable by someone who guesses to try — the defect is the missing affordance. In the chart toolbar the overflow does not scroll at all, so the clipped delete control is genuinely unreachable at phone width, and the transpose controls are hidden outright (see issue 9). The second case is the more serious of the two and should not be treated as the same polish item.

---

# Reference-issue verification

Statuses below are as of the re-verification pass; where the pass changed a status or its reasoning, the note says so.

| Previously reported issue | Current status | Verification result |
|---|---|---|
| Import opens Studio instead of allowing separation first | **Still broken** | Local import still navigates straight to Studio. A separation choice sheet now exists and is used by the Library’s own **Separate** action, but the import path does not route through it. See issue 15. |
| “Fetch from YouTube” banner is misaligned in Library | **Fixed** | Re-confirmed aligned on desktop and at phone width. |
| YouTube fetch and local import do not match as peer boxes | **Still broken** | YouTube is a full section with heading and copy; import is a header button that loses its label entirely on mobile. |
| Paste chart has no way to close | **Still broken** | No close/cancel control; the trigger does not toggle it closed and no Escape handler is bound. |
| After separation, Chords has no detect option; detected chords appear only after refresh | **Partially verified; refresh requirement not reproduced** | Detected chords appear without refresh, and the post-separation re-decode now announces itself with a live percentage. The full post-separation path still could not be run, as separation was again not executed. |
| Difference between Sheet and Lyrics is confusing | **Still broken** | Sheet remains an unexplained plain rendering of the Lyrics content. |
| No simplification, capo, or similar chord options | **Partially fixed** | Transpose, Simplify, Capo, and diagrams remain available only after creating a user chart. On mobile, Simplify and Capo are now reachable, but transpose is hidden outright and delete is clipped. |
| Need lyrics-only, chords-only, and chords-above-words views | **Partially addressed** | Unchanged: Lyrics carries a compact detected chord strip, but there is still no view system, no lyrics-only/chords-only switch, and no chords-above-words layout. |

---

# Recommended Chords experience

The Chords screen should have one persistent **View** control, one shared set of musical options, and a separate **Edit** action. Changing views should only change presentation; it should not create, delete, or replace chord data.

## Proposed views

| View | Primary use | Expected playback behavior |
|---|---|---|
| **Timeline** | Following and anticipating chord changes while listening or playing | A horizontal strip scrolls continuously with song time. The current chord/playhead stays anchored, upcoming chords move into view, the active chord is emphasized, and selecting a chord seeks playback. Manual scrolling temporarily pauses auto-follow and offers a clear **Resume following** action. |
| **Chart** | Seeing a larger song structure for practice, navigation, or printing | Multiple chord rows or sections remain visible; the current chord is highlighted; the chart auto-scrolls by default; selecting a chord seeks playback. Users can disable auto-scroll without leaving the view. |
| **Lyrics + Chords** | Singing or playing from a familiar lead-sheet/tab presentation | Chords render on a line above the corresponding lyric words or syllables, similar to Ultimate Guitar. The current lyric/chord pair is highlighted and the page scrolls with playback without destroying chord-to-word alignment when lines wrap. |

Optional **Lyrics only** and **Chords only** switches can live inside **Lyrics + Chords** rather than becoming more top-level screens.

## Controls shared by every view

- Transpose up/down.
- Simplify on/off, with a clear indication when substitutions are being shown.
- Capo setting and the relationship between displayed shapes and sounding key.
- Chord-diagram visibility and instrument, where supported.
- Text/chord size and display density.
- Auto-follow on/off and **Resume following** after manual scrolling.
- Detected versus user-corrected chord source/status, where both exist.

Changing any of these should update the same song consistently in **Timeline**, **Chart**, and **Lyrics + Chords**. A user should not have to select **Create editable chart** merely to transpose, simplify, or add a capo.

## Editing is an action, not a view

Replace **Create editable chart** with a separate **Edit** action. Editing should open within the currently selected view where practical and allow correction of individual chords, timings, sections, and chord-to-lyric alignment. It should have explicit **Save** and **Cancel** actions. Exiting edit mode returns to the same view and playback position.

The original detected analysis should remain available even after corrections are saved, so users can compare or revert without deleting the chart. The selected presentation, chord source, and musical transformations are independent choices.

Screenshots of the contrast:

![Current static horizontal Chords view on desktop](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/chords-detected-play-desktop.png)

![Static editable chart on desktop](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/chords-editable-static-desktop.png)

![Current static horizontal Chords view on mobile](/Users/shantanugoel/.codex/visualizations/2026/08/13/019ffb2e-6d4b-7881-904a-ad8723a0b89a/chords-detected-mobile.png)

---

# Prioritized implementation phases

This order follows the method used in `AUDIT.md`: each phase produces a coherent user-visible improvement, respects dependencies, and names the exact findings it addresses. Engineering effort is intentionally not estimated from this black-box QA pass.

## Phase 1 — unblock the core flow and restore trust

1. **Issue 20 · Chord detection reports no status of its own, and the Chords tab denies it is running** — analysis is already a background task, so the remaining work is status: replace the misleading “No chord chart yet” empty state with a real running/finished/failed state in the Chords tab, mark completion, add cancel/retry, and either implement or remove the **Run chord detection** action the copy already promises. The stem re-decode’s live percentage is the pattern to copy.
2. **Issue 15 · Local import bypasses the separation/processing choice** — let users decide whether to open, analyze chords, or separate stems rather than silently committing them to one path.
3. **Issue 18 · Demo tempo analysis can remain stuck on “Analyzing”** — every analysis job needs a bounded success, unavailable, failure, or retry state.
4. **Issue 16 · Unknown routes expose a developer-facing React Router error page** — replace the dead end with a branded recovery route.
5. **Issue 19 · User-facing errors expose raw parsing and URL-construction messages** — turn internal errors into actionable field-level guidance.
6. **Issue 17 · Malformed ChordPro input is accepted without useful validation** — protect existing work and let users repair invalid pasted charts.
7. **Issue 7 · Paste-chart panel cannot be closed or cancelled** — make the temporary workflow safely dismissible before expanding chart editing.
8. **Issue 21 · Studio tabs do not support conventional arrow-key navigation** — establish predictable keyboard access to every Studio view.
9. **Issue 22 · Mixer controls expose duplicate accessible names** — remove ambiguity for screen-reader and voice-control users.

**Phase outcome:** importing and analysis no longer mystify the user; failures recover cleanly; the main Studio navigation is operable with keyboard and assistive technology.

## Phase 2 — make Chords a coherent playback and practice workspace

10. **Issue 2 · “Create editable chart” incorrectly combines view selection, customization, and editing** — establish the foundation: one view selector, shared Transpose/Simplify/Capo controls, and a separate temporary Edit state.
11. **Issue 4 · Chords has no persistent selector for alternative playback views** — add **Timeline**, **Chart**, and **Lyrics + Chords** as non-destructive views of the same chord data.
12. **Issue 1 · Horizontal chord timeline does not scroll with playback** — make Timeline genuinely follow song time with useful look-ahead and a manual-scroll/**Resume following** interaction.
13. **Issue 5 · Chord and lyrics presentation modes are implicit rather than selectable** — add the Ultimate Guitar-style view with chords aligned above lyric words, plus lyrics-only and chords-only options.
14. **Issue 6 · Lyrics and Sheet screens have unclear, overlapping purposes** — fold these into the clarified view model or rename and explain their distinct purposes.
15. **Issue 10 · Chord diagrams are detached from current playback** — make diagrams follow the current or selected chord consistently in every relevant view.
16. **Issue 11 · Sing-along mode is not a complete performance view** — build it on the Lyrics + Chords follow behavior rather than maintaining another disconnected presentation.
17. **Issue 9 · Mobile chart customization toolbar is clipped** — ensure the new shared chord controls work at phone widths when the view model is introduced.

**Phase outcome:** users can move freely among a scrolling timeline, a full chart, and chords above lyrics; all views share musical transformations; editing no longer replaces playback.

## Phase 3 — responsive parity and product consistency

18. **Issue 3 · Mobile Library actions overlap long song titles** — restore a clear song/action hierarchy on narrow screens.
19. **Issue 23 · Clipped mobile controls create accessibility barriers beyond visual polish** — verify reflow at narrow widths and high zoom across Chords and Settings, not just at one phone size.
20. **Issue 13 · Mobile Settings navigation is clipped** — make every settings section reachable with an obvious compact navigation pattern.
21. **Issue 8 · Import and YouTube acquisition actions look like unrelated components** — present both acquisition methods as matching responsive choices.
22. **Issue 12 · Search state persists invisibly across Library category changes** — make active filtering visible or reset it predictably.
23. **Issue 14 · Every tested page uses the generic title “Atarang Studio”** — add route- and song-specific titles for orientation, history, and multi-tab use.

**Phase outcome:** the redesigned workflows retain full functionality on mobile and under zoom, while Library, Settings, navigation history, and acquisition patterns feel like one product.

## Ordering notes

**Issue 20 before Issues 1–5.** Weaker than originally stated, now that analysis is confirmed not to block the page — but still the right order. Each new Chords view needs a defined answer for “chords are not here yet”, and issue 20 is where that answer gets defined; building three views first means writing that empty state three times.

**Issue 17 and issue 2 are the same defect seen twice.** Malformed pasted input replaces the detected timeline irreversibly precisely because chart creation is the view gateway. Separating view from content (issue 2) removes most of issue 17’s consequence, so validation can be built against the already-separated model rather than retrofitted twice.

**Issue 15 is now mostly wiring.** The separation choice sheet exists and works; local import simply does not route through it. This is smaller than the original pass implied and can move early in Phase 1 cheaply.

**Issue 2 before Issues 1, 4, and 5.** View, transformation, source, and editing state need to be separated conceptually before building individual views; otherwise each new view risks acquiring its own incompatible controls.

**Issue 5 before Issue 11.** Sing-along should reuse the chords-above-lyrics alignment and follow behavior, not become a fourth independent rendering model.

**Accessibility and responsive behavior are phase acceptance criteria.** Issues 9, 21, 22, and 23 are named explicitly, but keyboard access, accessible names, focus visibility, reflow, and zoom support should be checked as each related workflow is delivered rather than deferred to a final cleanup pass.
