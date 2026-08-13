import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowClockwise,
  DownloadSimple,
  PencilSimple,
  Plus,
  SpinnerGap,
  Trash,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import type { UserChartV1,UserChordV1 } from "@atarang/contracts";
import {
  chordProIssues,
  exportChordPro,
  parseChordLine,
  parseChordPro,
  transposeChord,
} from "../../chords/chords";
import { UNRELIABLE_CONFIDENCE } from "../../analysis/chordDetection";
import { bestChordShape } from "../../chords/shapes";
import { useCharts } from "../../chords/useCharts";
import{useUserChords}from"../../chords/useUserChords";
import { usePlaybackSession } from "../PlaybackSession";
import { useStudioStore } from "../studioStore";
import { useChordAnalysis } from "../../chords/useChordAnalysis";
import { useLyrics } from "../../lyrics/useLyrics";
import { activeLyricLine } from "../../lyrics/lrc";
import { uuidV7 } from "../../../storage/ids";
import styles from "./ChordWorkspace.module.css";

const FRET_ROWS = 5;

function ChordDiagram({ chord,userChords }: { chord: string;userChords:readonly UserChordV1[] }) {
  const shape = bestChordShape(chord,userChords);
  if (!shape) return null;
  // Open shapes are drawn from the nut; a barre form is drawn from its own
  // fret, with the position marked, so the box stays five rows tall.
  const base = shape.barreFret ?? 1;
  return (
    <figure className={styles.diagram}>
      <svg viewBox="0 0 92 104" role="img" aria-label={`${chord} guitar chord diagram`}>
        <title>
          {chord}{shape.barreFret ? ` barre at fret ${shape.barreFret}${shape.rootString ? `, root on the ${shape.rootString}` : ""}` : " in open position"}
        </title>
        {!shape.barreFret && <line className={styles.nut} x1="16" y1="18" x2="76" y2="18" />}
        {Array.from({ length: 6 }, (_, index) => (
          <line key={`s${index}`} x1={16 + index * 12} y1="18" x2={16 + index * 12} y2={18 + FRET_ROWS * 14} />
        ))}
        {Array.from({ length: FRET_ROWS + 1 }, (_, index) => (
          <line key={`f${index}`} x1="16" y1={18 + index * 14} x2="76" y2={18 + index * 14} />
        ))}
        {shape.barreFret && <text className={styles.position} x="6" y="30">{shape.barreFret}</text>}
        {shape.frets.map((fret, string) => {
          if (fret === null) return <text key={string} x={16 + string * 12} y="12">×</text>;
          if (fret === 0) return <text key={string} x={16 + string * 12} y="12">○</text>;
          const row = fret - base;
          if (row < 0 || row >= FRET_ROWS) return null;
          return <circle key={string} cx={16 + string * 12} cy={18 + (row + 0.5) * 14} r="4" />;
        })}
      </svg>
      <figcaption>{chord}{shape.userDefined&&<small>Your voicing</small>}</figcaption>
    </figure>
  );
}

export function AnalysisChordRail({
  originalId,
  currentTimeUs = 0,
  seekTo,
  compact = false,
  transposeSemitones = 0,
  simplify = false,
  follow = false,
  onChordSelect,
}: {
  originalId?: string | undefined;
  currentTimeUs?: number;
  seekTo?: ((seconds: number) => void) | undefined;
  compact?: boolean;
  transposeSemitones?: number;
  simplify?: boolean;
  follow?: boolean;
  onChordSelect?: (chord:string)=>void;
}) {
  const analysis = useChordAnalysis(originalId);
  const timeline = useRef<HTMLDivElement>(null);
  const [following,setFollowing] = useState(true);
  const segments = analysis?.segments ?? [];
  useEffect(() => setFollowing(true),[originalId]);
  const active = Math.max(
    0,
    segments.findIndex(
      (segment) =>
        segment.startTimeUs <= currentTimeUs &&
        currentTimeUs < segment.endTimeUs,
    ),
  );
  const shown = (chord: string) => transposeChord(chord, transposeSemitones, simplify),
    current = segments[active],
    next = segments
      .slice(active + 1)
      .find((segment) => segment.chord !== current?.chord);
  useEffect(() => {
    const rail = timeline.current,
      button = rail?.children[active] as HTMLElement | undefined;
    if (!follow || !following || !rail || !button || !current) return;
    const progress = Math.max(0,Math.min(1,(currentTimeUs-current.startTimeUs)/(current.endTimeUs-current.startTimeUs)));
    rail.scrollLeft = button.offsetLeft + button.offsetWidth * progress - rail.clientWidth / 3;
  },[active,current,currentTimeUs,follow,following]);
  if (!analysis || !current) return null;
  return (
    <section
      className={`${styles.analysisRail} ${compact ? styles.compactRail : ""}`}
      aria-label="Detected chord timeline"
    >
      <header>
        <div>
          <small>NOW</small>
          <strong>{shown(current.chord)}</strong>
          <span>{Math.round(current.confidence * 100)}% confidence</span>
        </div>
        {next && (
          <div>
            <small>NEXT</small>
            <b>{shown(next.chord)}</b>
            <span>
              in{" "}
              {Math.max(
                0,
                Math.ceil((next.startTimeUs - currentTimeUs) / 1_000_000),
              )}
              s
            </span>
          </div>
        )}
        <em>
          {analysis.key ? `Key of ${analysis.key}` : "Key unclear"} ·{" "}
          {analysis.segments.length === 1 ? "1 chord" : `${analysis.segments.length} chords`}
        </em>
      </header>
      {/* Printing confident symbols over audio no detector can read is worse
          than printing nothing, because the player verifies by ear either way
          and only one of those outcomes admits it. */}
      {analysis.confidence < UNRELIABLE_CONFIDENCE && (
        <p className={styles.unreliable}>
          <WarningCircle aria-hidden />
          These chords are unreliable for this track — its spectrum is too
          untuned or too noisy to read harmony from. Use them as a starting
          point and correct what you hear.
        </p>
      )}
      <div
        ref={timeline}
        className={styles.chordTimeline}
        onWheel={() => follow && setFollowing(false)}
        onTouchMove={() => follow && setFollowing(false)}
        onPointerDown={(event) => follow && event.target === event.currentTarget && setFollowing(false)}
      >
        {segments.map((segment, index) => (
          <button
            key={`${segment.startTimeUs}-${index}`}
            className={index === active ? styles.currentChord : ""}
            style={{
              flexGrow: Math.max(1, segment.endTimeUs - segment.startTimeUs),
            }}
            onClick={() => { seekTo?.(segment.startTimeUs / 1_000_000); onChordSelect?.(shown(segment.chord)); }}
            title={`${segment.chord} · ${Math.round(segment.confidence * 100)}%`}
          >
            <b>{shown(segment.chord)}</b>
            <small>
              {Math.floor(segment.startTimeUs / 60_000_000)}:
              {String(
                Math.floor(segment.startTimeUs / 1_000_000) % 60,
              ).padStart(2, "0")}
            </small>
          </button>
        ))}
      </div>
      {follow && !following && <button className={styles.resumeFollow} onClick={() => setFollowing(true)}>Resume following</button>}
    </section>
  );
}

export function ChordWorkspace({
  originalId,
  songTitle,
  currentTimeUs = 0,
  seekTo,
}: {
  originalId?: string | undefined;
  songTitle?: string | undefined;
  currentTimeUs?: number;
  seekTo?: ((seconds: number) => void) | undefined;
}) {
  const { charts, save, remove } = useCharts(originalId),
    {waveformStatus,retryAnalysis}=usePlaybackSession(),
    {chords:userChords}=useUserChords(),
    analysis = useChordAnalysis(originalId),
    {document:lyrics}=useLyrics(originalId),
    selectedId = useStudioStore((state) => state.chartId),
    setSelectedId = useStudioStore((state) => state.setChartId),
    view = useStudioStore((state) => state.chordView),
    setView = useStudioStore((state) => state.setChordView),
    setTab = useStudioStore((state) => state.setTab),
    [settings, setSettings] = useState({ transposeSemitones: 0, simplify: false, capo: 0 }),
    [leadMode,setLeadMode] = useState<"both"|"lyrics"|"chords">("both"),
    [selectedChord,setSelectedChord] = useState<string>(),
    [panel, setPanel] = useState<"paste" | "edit" | null>(null),
    [draft, setDraft] = useState(""),
    [issues, setIssues] = useState<string[]>([]),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const chart =
    charts?.find((value) => value.chartId === selectedId) ?? charts?.[0];
  const activeView = view === "timeline" && !analysis?.segments.length && chart ? "chart"
    : view === "chart" && !chart && analysis?.segments.length ? "timeline"
    : view;
  useEffect(() => {
    setSettings({ transposeSemitones: 0, simplify: false, capo: 0 });
    setPanel(null);
    setDraft("");
    setIssues([]);
    setSelectedChord(undefined);
  }, [originalId]);
  useEffect(() => {
    if (chart) setSettings({ transposeSemitones: chart.transposeSemitones, simplify: chart.simplify, capo: chart.capo });
  }, [chart?.chartId]);
  useEffect(()=>setSelectedChord(undefined),[settings.transposeSemitones,settings.simplify]);
  const rendered = useMemo(
    () =>
      chart?.lines.map((line) => ({
        ...line,
        segments: line.segments.map((segment) => ({
          ...segment,
          chord: segment.chord
            ? transposeChord(
                segment.chord,
                settings.transposeSemitones,
                settings.simplify,
              )
            : undefined,
        })),
      })),
    [chart, settings.simplify, settings.transposeSemitones],
  );
  const activeLyrics = lyrics ? activeLyricLine(lyrics,currentTimeUs) : -1;
  const currentSegment = analysis?.segments.find(segment=>segment.startTimeUs<=currentTimeUs&&currentTimeUs<segment.endTimeUs),
    diagramChord = selectedChord ?? (currentSegment ? transposeChord(currentSegment.chord,settings.transposeSemitones,settings.simplify) : rendered?.flatMap(line=>line.segments).find(segment=>segment.chord)?.chord);
  const detectedText = () => `{title: ${songTitle ?? "Detected chords"}}\n${analysis?.segments
    .map((segment) => `[${segment.chord}]${Math.floor(segment.startTimeUs / 60_000_000).toString().padStart(2, "0")}:${Math.floor((segment.startTimeUs / 1_000_000) % 60).toString().padStart(2, "0")}`)
    .join("\n") ?? ""}`;
  const addText = (text: string) => {
    if (!originalId) return;
    const found = chordProIssues(text);
    if (found.length) { setIssues(found); setDraft(text); setPanel("paste"); return; }
    const value = save(parseChordPro(text, originalId, uuidV7(), songTitle));
    setSelectedId(value.chartId);
    setView("chart");
    setPanel(null);
    setDraft("");
    setIssues([]);
  };
  const saveEdit = () => {
    if (!originalId) return;
    const found = chordProIssues(draft);
    if (found.length) { setIssues(found); return; }
    const current = activeView === "chart" ? chart : undefined,
      parsed = parseChordPro(draft, originalId, current?.chartId ?? uuidV7(), songTitle),
      value = save({ ...parsed, revision: current?.revision ?? parsed.revision, ...settings });
    setSelectedId(value.chartId);
    setView("chart");
    setPanel(null);
    setIssues([]);
  };
  const importFile = async (file?: File) => {
    // A bad file lands in the same editor as bad pasted text, with the same
    // errors against it, because repairing it needs the same surface.
    if (file) addText(await file.text());
    if (input.current) input.current.value = "";
  };
  const closePanel = () => { setPanel(null); setIssues([]); globalThis.setTimeout(() => trigger.current?.focus()); };
  const chooseFile = (event: MouseEvent<HTMLButtonElement>) => { trigger.current = event.currentTarget; input.current?.click(); };
  const importButton = (
    <button disabled={panel === "edit"} onClick={chooseFile}>
      <UploadSimple />
      Import ChordPro
    </button>
  );
  const pasteTrigger = (
    <button
      disabled={panel === "edit"}
      aria-expanded={panel === "paste"}
      onClick={(event) => { trigger.current = event.currentTarget; if (panel === "paste") closePanel(); else { setPanel("paste"); setIssues([]); } }}
    >
      <Plus />
      Paste chart
    </button>
  );
  const edit = (event: MouseEvent<HTMLButtonElement>) => {
    trigger.current = event.currentTarget;
    setDraft(activeView === "chart" && chart ? exportChordPro(chart) : detectedText());
    setIssues([]);
    setPanel("edit");
  };
  const editor = panel && (
    <section
      className={styles.paste}
      aria-label={panel === "edit" ? "Edit chord chart" : "Paste chord chart"}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closePanel(); } }}
    >
      <textarea
        autoFocus
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setIssues([]); }}
        placeholder={"{title: Song}\n[Am]Lyrics with [F]chords"}
        aria-label={panel === "edit" ? "Edit ChordPro chart" : "Paste ChordPro chart"}
        aria-invalid={issues.length > 0}
      />
      {issues.length > 0 && (
        <ul className={styles.issues} role="alert">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      <div className={styles.pasteActions}>
        <button disabled={!draft.trim()} onClick={panel === "edit" ? saveEdit : () => addText(draft)}>
          {panel === "edit" ? "Save changes" : "Add chart"}
        </button>
        <button onClick={closePanel}>Cancel</button>
      </div>
    </section>
  );
  const changeSettings = (change: Partial<typeof settings>) => setSettings((value) => {
    const next = { ...value, ...change };
    if (chart) save({ ...chart, ...next });
    return next;
  });
  const download = () => {
    if (!chart) return;
    const url = URL.createObjectURL(
        new Blob([exportChordPro(chart)], { type: "text/plain" }),
      ),
      anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `${chart.title || "chart"}.cho`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (!originalId)
    return (
      <div className={styles.demo} role="tabpanel">
        <strong>Chord timeline</strong>
        <p>Corrections stay separate from generated analysis.</p>
        <div aria-hidden>
          {["Em", "C", "G", "D", "Em", "C", "G", "D"].map((value, index) => (
            <span key={index}>
              {value}
              <small>{index + 1}</small>
            </span>
          ))}
        </div>
      </div>
    );
  if (charts === undefined)
    return (
      <div className={styles.empty} role="status">
        Opening chord charts…
      </div>
    );
  if (!chart && !analysis?.segments.length) {
    // The detection pass writes the chords, so its state is the honest answer
    // to "why is this tab empty". Claiming "no chords yet" while the worker is
    // still reading them is the one moment a user is most likely to be looking.
    const failed = waveformStatus === "error",
      detecting = !failed && (waveformStatus === "analyzing" || analysis === undefined),
      [heading, body] = failed
        ? ["Chord detection failed", "This audio could not be analyzed. Retry, or bring your own chart."]
        : detecting
          ? ["Reading chords from the audio…", "Detection runs in the background — play, mix, or write lyrics while it finishes."]
          : ["No chords found in this track", "Detection finished without a chord it would stand behind. Import ChordPro or paste a chart instead."];
    return (
      <div className={styles.empty} role={detecting ? "status" : "tabpanel"}>
        {detecting && <SpinnerGap className={styles.spin} aria-hidden />}
        <strong>{heading}</strong>
        <p>{body}</p>
        <div>
          {failed && (
            <button onClick={retryAnalysis}>
              <ArrowClockwise />
              Retry chord detection
            </button>
          )}
          {importButton}
          {pasteTrigger}
        </div>
        {editor}
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept=".cho,.chordpro,.pro,text/plain"
          aria-label="Choose ChordPro chart"
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
      </div>
    );
  }
  return (
    <div className={styles.chordWorkspace} role="tabpanel">
      <div className={styles.toolbar}>
        <label>
          View
          <select disabled={panel === "edit"} value={activeView} onChange={(event) => setView(event.target.value as typeof view)}>
            <option value="timeline" disabled={!analysis?.segments.length}>Timeline</option>
            <option value="chart" disabled={!chart}>Chart</option>
            <option value="lyricsChords">Lyrics + Chords</option>
          </select>
        </label>
        <span>Transpose</span>
        <button aria-label="Transpose down" onClick={() => changeSettings({ transposeSemitones: Math.max(-12, settings.transposeSemitones - 1) })}>−</button>
        <output>{settings.transposeSemitones > 0 ? `+${settings.transposeSemitones}` : settings.transposeSemitones}</output>
        <button aria-label="Transpose up" onClick={() => changeSettings({ transposeSemitones: Math.min(12, settings.transposeSemitones + 1) })}>+</button>
        <button aria-pressed={settings.simplify} onClick={() => changeSettings({ simplify: !settings.simplify })}>Simplify</button>
        <label>
          Capo
          <button aria-label="Decrease capo" onClick={() => changeSettings({ capo: Math.max(0, settings.capo - 1) })}>−</button>
          <output>{settings.capo}</output>
          <button aria-label="Increase capo" onClick={() => changeSettings({ capo: Math.min(12, settings.capo + 1) })}>+</button>
        </label>
        <button disabled={panel === "edit"} onClick={edit}><PencilSimple /> Edit</button>
      </div>
      {editor}
      {diagramChord && <div className={styles.diagrams}><span>{selectedChord ? "Selected chord" : currentSegment ? "Following playback" : "First chart chord"}</span><ChordDiagram chord={diagramChord} userChords={userChords??[]} /></div>}
      {activeView === "timeline" && analysis?.segments.length ? (
        <div className={styles.detected}>
          <AnalysisChordRail originalId={originalId} currentTimeUs={currentTimeUs} seekTo={seekTo} transposeSemitones={settings.transposeSemitones} simplify={settings.simplify} follow onChordSelect={setSelectedChord} />
          <div className={styles.detectedActions}>
            <p>Detected chords stay aligned to source time. Click any segment to seek; editing saves a separate chart.</p>
            {importButton}
            {pasteTrigger}
          </div>
        </div>
      ) : activeView === "lyricsChords" ? (
        <div className={styles.leadSheet}>
          <div className={styles.leadModes} aria-label="Lyrics and chords display">
            {(["both","lyrics","chords"] as const).map(mode => <button aria-pressed={leadMode===mode} key={mode} onClick={()=>setLeadMode(mode)}>{mode === "both" ? "Lyrics + chords" : mode === "lyrics" ? "Lyrics only" : "Chords only"}</button>)}
          </div>
          {chart ? <>
              <p>Selected chart · {chart.title}</p>
              {rendered?.map(line => <section key={line.id}>
                {line.section && <h3>{line.section}</h3>}
                <p>{line.segments.map((segment,index) => <button aria-label={segment.chord?`Show ${segment.chord} diagram`:undefined} className={styles.leadSegment} key={index} onClick={()=>segment.chord&&setSelectedChord(segment.chord)}>{leadMode !== "lyrics" && segment.chord && <b>{segment.chord}</b>}{leadMode !== "chords" && <i>{segment.text || " "}</i>}</button>)}</p>
              </section>)}
            </>
            : lyrics === undefined ? <p role="status">Opening lyrics…</p>
            : !lyrics ? <div className={styles.noLyrics}><strong>No lyrics yet</strong><p>Add lyrics first, then return here to practise with both sources together.</p><button onClick={() => setTab("lyrics")}>Add lyrics</button></div>
            : <>
              <AnalysisChordRail originalId={originalId} currentTimeUs={currentTimeUs} seekTo={seekTo} compact transposeSemitones={settings.transposeSemitones} simplify={settings.simplify} />
              {lyrics.lines.map((line,index) => {
                const time = line.startTimeUs === undefined ? undefined : line.startTimeUs + lyrics.offsetUs,
                  segment = time === undefined ? undefined : analysis?.segments.find(item => item.startTimeUs <= time && time < item.endTimeUs),
                  chord = segment ? transposeChord(segment.chord, settings.transposeSemitones, settings.simplify) : undefined,
                  inline = parseChordLine(line.text),
                  hasInline = inline.some(item=>item.chord);
                return <button className={activeLyrics === index ? styles.activeLine : ""} key={line.id} onClick={() => time !== undefined && seekTo?.(time / 1_000_000)}>
                  <span>{inline.map((item,itemIndex)=><span className={styles.leadSegment} key={itemIndex}>
                    {leadMode !== "lyrics" && (item.chord ? <b>{transposeChord(item.chord,settings.transposeSemitones,settings.simplify)}</b> : itemIndex === 0 && !hasInline && chord ? <b>{chord}</b> : null)}
                    {leadMode !== "chords" && <i>{item.text || " "}</i>}
                  </span>)}</span>
                </button>;
              })}
            </>}
        </div>
      ) : chart ? (
      <div className={styles.chart}>
      <div className={styles.chartActions}>
        <select
          aria-label="Selected chord chart"
          disabled={panel === "edit"}
          value={chart.chartId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {charts.map((item) => (
            <option key={item.chartId} value={item.chartId}>
              {item.title}
            </option>
          ))}
        </select>
        <button disabled={panel === "edit"} onClick={chooseFile}>
          <UploadSimple />
          Import
        </button>
        <button disabled={panel === "edit"} onClick={download}>
          <DownloadSimple />
          Export
        </button>
        <button
          className={styles.delete}
          aria-label="Remove selected chart"
          disabled={panel === "edit"}
          onClick={() => { void remove(chart.chartId); setView("timeline"); }}
        >
          <Trash />
        </button>
      </div>
      <header>
        <div>
          <h2>{chart.title}</h2>
          <p>{chart.artist || "User chart"}</p>
        </div>
      </header>
      <div className={styles.chartLines}>
        {rendered?.map((line) => (
          <section key={line.id}>
            {line.section && <h3>{line.section}</h3>}
            <p>
              {line.segments.map((segment, index) => (
                <button aria-label={segment.chord?`Show ${segment.chord} diagram`:undefined} className={styles.chartSegment} key={index} onClick={()=>segment.chord&&setSelectedChord(segment.chord)}>
                  {segment.chord && <b>{segment.chord}</b>}
                  <i>{segment.text || " "}</i>
                </button>
              ))}
            </p>
          </section>
        ))}
      </div>
      </div>
      ) : null}
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".cho,.chordpro,.pro,text/plain"
        aria-label="Choose ChordPro chart"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
    </div>
  );
}
