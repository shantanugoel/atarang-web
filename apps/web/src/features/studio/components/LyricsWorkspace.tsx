import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CaretLeft,
  CaretRight,
  Check,
  CornersIn,
  CornersOut,
  DownloadSimple,
  MagnifyingGlass,
  MusicNotesSimple,
  PencilSimple,
  Plus,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useSearchParams } from "react-router";
import type { LyricsDocumentV1 } from "@atarang/contracts";
import { StudioTab, useStudioStore } from "../studioStore";
import { activeLyricLine, exportLrc, lyricLoopRange, parseLrc } from "../../lyrics/lrc";
import { useLyrics } from "../../lyrics/useLyrics";
import { ChordWorkspace } from "./ChordWorkspace";
import { TakesWorkspace } from "./TakesWorkspace";
import styles from "./LyricsWorkspace.module.css";
import { DEMO_TRACK } from "../useDemoAudio";
import { uuidV7 } from "../../../storage/ids";
import { searchLyricsCandidates, type LrclibResult } from "../../lyrics/lrclib";
import { parseChordLine } from "../../chords/chords";
import { usePlaybackSession } from "../PlaybackSession";

const TABS: StudioTab[] = ["lyrics", "chords", "sheet", "takes"];
const TAB_LABELS:Record<StudioTab,string>={lyrics:"Synced lyrics",chords:"Chords",sheet:"Plain lyrics",takes:"Takes"};

const formatTime = (timeUs?: number) =>
  timeUs === undefined
    ? "--:--.--"
    : `${Math.floor(timeUs / 60_000_000)
        .toString()
        .padStart(
          2,
          "0",
        )}:${((timeUs % 60_000_000) / 1_000_000).toFixed(2).padStart(5, "0")}`;

export function LyricsWorkspace({
  originalId,
  songTitle,
  artistName,
  durationUs,
  currentTimeUs = 0,
  seekTo,
}: {
  originalId?: string | undefined;
  songTitle?: string | undefined;
  artistName?: string | undefined;
  durationUs?: number | undefined;
  currentTimeUs?: number | undefined;
  seekTo?: ((seconds: number) => void) | undefined;
}) {
  const tab = useStudioStore((state) => state.tab),
    setTab = useStudioStore((state) => state.setTab),
    following = useStudioStore((state) => state.lyricsFollowing),
    setFollowing = useStudioStore((state) => state.setLyricsFollowing),
    setLoop = useStudioStore((state) => state.setLoop),
    singScale = useStudioStore((state) => state.singScale),
    adjust = useStudioStore((state) => state.adjust),
    { document, save } = useLyrics(originalId);
  const {playback}=usePlaybackSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const singAlong = searchParams.get("sing") === "1";
  const [editing, setEditing] = useState(false);
  const [lookupStatus, setLookupStatus] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTitle, setSearchTitle] = useState(songTitle ?? "");
  const [searchArtist, setSearchArtist] = useState(artistName ?? "");
  const [matches, setMatches] = useState<LrclibResult[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<LrclibResult>();
  const input = useRef<HTMLInputElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);
  const autoScrollUntil = useRef(0);
  const gesture = useRef<{ start: number; end: number; timer?: ReturnType<typeof setTimeout>; looped: boolean } | undefined>(undefined);
  const suppressClickUntil = useRef(0);
  const active = document ? activeLyricLine(document, currentTimeUs) : -1;
  useEffect(() => {
    if (!editing && following && active >= 0) {
      autoScrollUntil.current = performance.now() + 600;
      activeLine.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [active, editing, following]);
  useEffect(() => () => { if (gesture.current?.timer) clearTimeout(gesture.current.timer); }, []);
  const toggleSingAlong = () => {
    const next = new URLSearchParams(searchParams);
    if (singAlong) next.delete("sing");
    else { next.set("sing", "1"); setFollowing(true); }
    setSearchParams(next);
  };
  const loopLines = (from: number, to: number) => {
    if (!document || !durationUs) return;
    const range = lyricLoopRange(document.lines, from, to, document.offsetUs, durationUs);
    if (range) setLoop(range[0], range[1], durationUs);
  };
  const finishGesture = () => {
    const current = gesture.current;
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    if (current.looped || current.start !== current.end) {
      loopLines(current.start, current.end);
      suppressClickUntil.current = performance.now() + 300;
    }
    gesture.current = undefined;
  };
  const create = () => {
    if (!originalId) return;
    save({
      schema: "atarang.lyrics/1",
      originalId,
      revision: 0,
      offsetUs: 0,
      lines: [
        { id: `${originalId}:manual:0`, text: "", source: "manual", words: [] },
      ],
      updatedAt: new Date().toISOString(),
    });
    setEditing(true);
  };
  const importFile = async (file?: File) => {
    if (!file || !originalId) return;
    save(parseLrc(await file.text(), originalId));
    setEditing(false);
    if (input.current) input.current.value = "";
  };
  const update = (change: (value: LyricsDocumentV1) => LyricsDocumentV1) => {
    if (document) save(change(document));
  };
  const setTime = (index: number) =>
    update((value) => {
      const lines = value.lines.map((line) => ({
          ...line,
          words: [...line.words],
        })),
        line = lines[index]!,
        minimum = index > 0 ? (lines[index - 1]!.startTimeUs ?? 0) : 0,
        start = Math.max(minimum, Math.round(currentTimeUs));
      line.startTimeUs = start;
      line.endTimeUs = Math.max(
        start + 500_000,
        lines.slice(index + 1).find((item) => item.startTimeUs !== undefined)
          ?.startTimeUs ?? start + 5_000_000,
      );
      line.source = "manual";
      if (index > 0 && lines[index - 1]!.startTimeUs !== undefined) {
        const previous = lines[index - 1]!;
        previous.endTimeUs = start;
        previous.words = previous.words
          .filter((word) => word.startTimeUs < start)
          .map((word) => ({
            ...word,
            endTimeUs: Math.min(word.endTimeUs, start),
          }));
      }
      return { ...value, lines };
    });
  const download = () => {
    if (!document) return;
    const url = URL.createObjectURL(
        new Blob([exportLrc(document)], { type: "text/plain" }),
      ),
      anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `${songTitle ?? "lyrics"}.lrc`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const openSearch = () => {
    setSearchTitle(songTitle ?? "");
    setSearchArtist(artistName ?? "");
    setMatches([]);
    setSelectedMatch(undefined);
    setLookupStatus("");
    setSearchOpen(true);
  };
  const lookup = async () => {
    if (!originalId || !searchTitle.trim()) return;
    setLookupStatus("Searching LRCLIB…");
    setMatches([]);
    try {
      const found = await searchLyricsCandidates({
        trackName: searchTitle,
        ...(searchArtist.trim() ? { artistName: searchArtist.trim() } : {}),
        ...(durationUs ? { durationSeconds: durationUs / 1_000_000 } : {}),
      });
      setMatches(found);
      setLookupStatus(
        found.length
          ? `${found.length} match${found.length === 1 ? "" : "es"}. Preview one before replacing your lyrics.`
          : "No matches. Try a shorter title or remove the artist.",
      );
    } catch (error) {
      setLookupStatus(
        error instanceof Error && error.message === "lyrics_rate_limited"
          ? "LRCLIB is busy. Try again shortly."
          : "LRCLIB lookup failed. You can still import an LRC file.",
      );
    }
  };
  const useMatch = () => {
    if (!originalId || !selectedMatch) return;
    const body = selectedMatch.syncedLyrics?.trim();
    if (body) save(parseLrc(body, originalId));
    else {
      const lines = (selectedMatch.plainLyrics ?? "")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((text, index) => ({
          id: `${originalId}:lrclib:${index}`,
          text,
          source: "lrc" as const,
          words: [],
        }));
      save({
        schema: "atarang.lyrics/1",
        originalId,
        revision: 0,
        offsetUs: 0,
        lines,
        updatedAt: new Date().toISOString(),
      });
    }
    setSearchOpen(false);
    setSelectedMatch(undefined);
  };
  return (
    <section className={styles.workspace} aria-label="Song editor">
      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Practice content"
        // The row declared the roles but bound no keys, so the one interaction
        // every tab widget has — arrows move between tabs — did nothing, and
        // all four sat in the tab order a keyboard user has to walk through.
        onKeyDown={(event) => {
          const index = TABS.indexOf(tab),
            next = event.key === "ArrowRight" ? (index + 1) % TABS.length
              : event.key === "ArrowLeft" ? (index - 1 + TABS.length) % TABS.length
              : event.key === "Home" ? 0
              : event.key === "End" ? TABS.length - 1
              : -1;
          if (next < 0) return;
          event.preventDefault();
          setTab(TABS[next]!);
          event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus();
        }}
      >
        {TABS.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            // Roving: Tab reaches the row once and then leaves it, rather than
            // stopping on every view on the way to the content.
            tabIndex={tab === item ? 0 : -1}
            onClick={() => setTab(item)}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>
      {tab === "lyrics" && !originalId && <DemoLyrics />}
      {tab === "lyrics" && originalId && document === undefined && (
        <div className={styles.analysisEmpty} role="status">
          Opening lyrics…
        </div>
      )}
      {tab === "lyrics" && originalId && document === null && (
        <div className={styles.analysisEmpty} role="tabpanel">
          <MusicNotesSimple weight="thin" />
          <strong>{songTitle} is ready to play</strong>
          <p>
            Search LRCLIB and choose from every matching version, import an LRC
            file, or write lyrics manually.
          </p>
          <div className={styles.emptyActions}>
            <button onClick={openSearch}>
              <MagnifyingGlass />
              Search online lyrics
            </button>
            <button onClick={() => input.current?.click()}>
              <UploadSimple />
              Import LRC
            </button>
            <button onClick={create}>
              <PencilSimple />
              Write lyrics
            </button>
          </div>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept=".lrc,text/plain"
            aria-label="Choose LRC lyrics"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      )}
      {tab === "lyrics" && document && (
        <div
          className={`${styles.lyrics} ${singAlong ? styles.singAlong : ""}`}
          style={singAlong ? {"--sing-scale":singScale} as CSSProperties : undefined}
          role="tabpanel"
          onScroll={() => { if (following && performance.now() > autoScrollUntil.current) setFollowing(false); }}
          onWheel={() => setFollowing(false)}
          onTouchMove={() => setFollowing(false)}
          onPointerUpCapture={finishGesture}
          onPointerCancelCapture={finishGesture}
        >
          <div className={`${styles.editorToolbar} ${singAlong ? styles.singToolbar : ""}`}>
            {singAlong ? (
              <>
                <strong>{songTitle}</strong>
                {!following && <button onClick={() => setFollowing(true)}>Resume follow</button>}
                <button aria-label="Rewind 10 seconds" onClick={()=>seekTo?.(Math.max(0,currentTimeUs/1_000_000-10))}>−10s</button>
                <button disabled={!playback.ready} onClick={()=>void playback.toggle()}>{playback.playing?"Pause":"Play"}</button>
                <button aria-label="Forward 10 seconds" onClick={()=>seekTo?.(Math.min((durationUs??currentTimeUs)/1_000_000,currentTimeUs/1_000_000+10))}>+10s</button>
                <button aria-label="Decrease sing-along text size" onClick={()=>adjust("singScale",-1)}>A−</button>
                <button aria-label="Increase sing-along text size" onClick={()=>adjust("singScale",1)}>A+</button>
                <button onClick={toggleSingAlong}><CornersIn /> Exit sing-along</button>
              </>
            ) : <>
            <button
              onClick={() => setEditing((value) => !value)}
              aria-pressed={editing}
            >
              <PencilSimple />
              {editing ? "Done" : "Edit"}
            </button>
            <button onClick={openSearch}>
              <MagnifyingGlass />
              Search again
            </button>
            <button onClick={() => input.current?.click()}>
              <UploadSimple />
              Import LRC
            </button>
            <button onClick={download}>
              <DownloadSimple />
              Export LRC
            </button>
            <button onClick={toggleSingAlong} disabled={editing}>
              <CornersOut />
              Sing along
            </button>
            {!editing && !following && <button onClick={() => setFollowing(true)}>Resume follow</button>}
            <span>Offset {document.offsetUs / 1000} ms</span>
            <button
              aria-label="Decrease lyric offset"
              onClick={() =>
                update((value) => ({
                  ...value,
                  offsetUs: value.offsetUs - 100_000,
                }))
              }
            >
              −
            </button>
            <button
              aria-label="Increase lyric offset"
              onClick={() =>
                update((value) => ({
                  ...value,
                  offsetUs: value.offsetUs + 100_000,
                }))
              }
            >
              +
            </button>
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept=".lrc,text/plain"
              aria-label="Choose LRC lyrics"
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
            </>}
          </div>
          {editing && !singAlong
            ? document.lines.map((line, index) => (
                <div className={styles.editLine} key={line.id}>
                  <button
                    onClick={() => setTime(index)}
                    aria-label={`Set line ${index + 1} time at playhead`}
                  >
                    {formatTime(line.startTimeUs)}
                  </button>
                  <textarea
                    rows={1}
                    value={line.text}
                    aria-label={`Lyric line ${index + 1}`}
                    onChange={(event) =>
                      update((value) => ({
                        ...value,
                        lines: value.lines.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                text: event.target.value,
                                source: "manual",
                                words: [],
                              }
                            : item,
                        ),
                      }))
                    }
                  />
                </div>
              ))
            : document.lines.map((line, index) => (
                <button
                  className={`${styles.timedLine} ${active === index ? styles.active : ""}`}
                  key={line.id}
                  ref={active === index ? activeLine : undefined}
                  data-line-index={index}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || line.startTimeUs === undefined) return;
                    const current: NonNullable<typeof gesture.current> = { start: index, end: index, looped: false };
                    current.timer = setTimeout(() => { current.looped = true; loopLines(index, index); }, 500);
                    gesture.current = current;
                  }}
                  onPointerEnter={() => { if (gesture.current) gesture.current.end = index; }}
                  onPointerMove={(event) => {
                    const target = globalThis.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-line-index]");
                    if (gesture.current && target) gesture.current.end = Number(target.dataset.lineIndex);
                  }}
                  onClick={() => {
                    if (performance.now() < suppressClickUntil.current) return;
                    if (line.startTimeUs !== undefined) seekTo?.((line.startTimeUs + document.offsetUs) / 1_000_000);
                  }}
                >
                  {active === index && (
                    <CaretRight
                      className={styles.caret}
                      weight="fill"
                      aria-hidden
                    />
                  )}
                  <time>{formatTime(line.startTimeUs)}</time>
                  <p>
                    {line.words.length
                      ? line.words.map((word, wordIndex) => (
                          <span
                            className={
                              currentTimeUs - document.offsetUs >=
                                word.startTimeUs &&
                              currentTimeUs - document.offsetUs < word.endTimeUs
                                ? styles.activeWord
                                : ""
                            }
                            key={wordIndex}
                          >
                            {word.text}
                          </span>
                        ))
                      : singAlong
                        ? parseChordLine(line.text).map((segment,segmentIndex)=><span className={styles.singSegment} key={segmentIndex}>{segment.chord&&<b>{segment.chord}</b>}<i>{segment.text}</i></span>)
                        : line.text}
                  </p>
                </button>
              ))}
          {editing && !singAlong && (
            <button
              className={styles.addLine}
              onClick={() =>
                update((value) => ({
                  ...value,
                  lines: [
                    ...value.lines,
                    {
                      id: `${value.originalId}:manual:${uuidV7()}`,
                      text: "",
                      source: "manual",
                      words: [],
                    },
                  ],
                }))
              }
            >
              <Plus />
              Add line
            </button>
          )}
        </div>
      )}
      {tab === "chords" && (
        <ChordWorkspace
          originalId={originalId}
          songTitle={songTitle}
          currentTimeUs={currentTimeUs}
          seekTo={seekTo}
        />
      )}
      {tab === "sheet" && (
        <div className={styles.emptyPanel} role="tabpanel">
          <strong>{songTitle ?? "Midnight Run"}</strong>
          <small>Untimed lyrics for reading or printing. Use Synced lyrics to follow playback and edit timing.</small>
          {document?.lines.map((line) => (
            <p className={styles.sheetLine} key={line.id}>
              {line.text}
            </p>
          )) ?? <p>Import lyrics to build a practice sheet.</p>}
        </div>
      )}
      {tab === "takes" &&
        (originalId ? (
          <TakesWorkspace originalId={originalId} />
        ) : (
          <TakesWorkspace />
        ))}
      {searchOpen && (
        <div
          className={styles.lookupBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Search LRCLIB"
        >
          <section className={styles.lookupSheet}>
            <header>
              <button
                aria-label={
                  selectedMatch ? "Back to results" : "Close lyrics search"
                }
                onClick={() =>
                  selectedMatch
                    ? setSelectedMatch(undefined)
                    : setSearchOpen(false)
                }
              >
                {selectedMatch ? <CaretLeft /> : <X />}
              </button>
              <div>
                <strong>
                  {selectedMatch ? "Preview lyrics" : "Online lyrics"}
                </strong>
                <span>
                  {selectedMatch
                    ? `${selectedMatch.trackName} — ${selectedMatch.artistName}`
                    : "Search LRCLIB and choose a version"}
                </span>
              </div>
              {selectedMatch && (
                <button className={styles.useLyrics} onClick={useMatch}>
                  <Check />
                  Use these
                </button>
              )}
            </header>
            {selectedMatch ? (
              <div className={styles.preview}>
                {(selectedMatch.syncedLyrics ?? selectedMatch.plainLyrics ?? "")
                  .split(/\r?\n/)
                  .filter(Boolean)
                  .slice(0, 120)
                  .map((line, index) => (
                    <p key={index}>
                      <time>{line.match(/^\[([^\]]+)\]/)?.[1] ?? "—"}</time>
                      <span>{line.replace(/^\[[^\]]+\]/, "")}</span>
                    </p>
                  ))}
              </div>
            ) : (
              <>
                <form
                  className={styles.lookupForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void lookup();
                  }}
                >
                  <label>
                    Song title
                    <input
                      value={searchTitle}
                      onChange={(event) => setSearchTitle(event.target.value)}
                      autoFocus
                    />
                  </label>
                  <label>
                    Artist <small>optional</small>
                    <input
                      value={searchArtist}
                      onChange={(event) => setSearchArtist(event.target.value)}
                    />
                  </label>
                  <button
                    disabled={
                      !searchTitle.trim() ||
                      lookupStatus === "Searching LRCLIB…"
                    }
                  >
                    <MagnifyingGlass />
                    {lookupStatus === "Searching LRCLIB…"
                      ? "Searching…"
                      : "Search LRCLIB"}
                  </button>
                </form>
                {lookupStatus && (
                  <p className={styles.lookupStatus} role="status">
                    {lookupStatus}
                  </p>
                )}
                <div className={styles.matches}>
                  {matches.map((match) => (
                    <button
                      key={match.id}
                      onClick={() => setSelectedMatch(match)}
                    >
                      <div>
                        <strong>{match.trackName}</strong>
                        {match.syncedLyrics?.trim() && <b>Synced</b>}
                      </div>
                      <span>
                        {match.artistName}
                        {match.albumName ? ` · ${match.albumName}` : ""} ·{" "}
                        {formatTime(match.duration * 1_000_000)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function DemoLyrics() {
  return (
    <div className={styles.analysisEmpty} role="tabpanel">
      <MusicNotesSimple weight="thin" />
      <strong>Playable CC0 demonstration</strong>
      <p>
        “{DEMO_TRACK.title}” by {DEMO_TRACK.artist} is bundled under{" "}
        {DEMO_TRACK.license}. Use the transport below to play and seek the real
        audio.
      </p>
      <a href={DEMO_TRACK.source} target="_blank" rel="noreferrer">
        Source and license
      </a>
    </div>
  );
}
