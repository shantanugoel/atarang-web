import { useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowClockwise,
  DownloadSimple,
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
}: {
  originalId?: string | undefined;
  currentTimeUs?: number;
  seekTo?: ((seconds: number) => void) | undefined;
  compact?: boolean;
}) {
  const analysis = useChordAnalysis(originalId);
  if (!analysis?.segments.length) return null;
  const active = Math.max(
    0,
    analysis.segments.findIndex(
      (segment) =>
        segment.startTimeUs <= currentTimeUs &&
        currentTimeUs < segment.endTimeUs,
    ),
  );
  const current = analysis.segments[active] ?? analysis.segments[0]!,
    next = analysis.segments
      .slice(active + 1)
      .find((segment) => segment.chord !== current.chord);
  return (
    <section
      className={`${styles.analysisRail} ${compact ? styles.compactRail : ""}`}
      aria-label="Detected chord timeline"
    >
      <header>
        <div>
          <small>NOW</small>
          <strong>{current.chord}</strong>
          <span>{Math.round(current.confidence * 100)}% confidence</span>
        </div>
        {next && (
          <div>
            <small>NEXT</small>
            <b>{next.chord}</b>
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
      <div className={styles.chordTimeline}>
        {analysis.segments.map((segment, index) => (
          <button
            key={`${segment.startTimeUs}-${index}`}
            className={index === active ? styles.currentChord : ""}
            style={{
              flexGrow: Math.max(1, segment.endTimeUs - segment.startTimeUs),
            }}
            onClick={() => seekTo?.(segment.startTimeUs / 1_000_000)}
            title={`${segment.chord} · ${Math.round(segment.confidence * 100)}%`}
          >
            <b>{segment.chord}</b>
            <small>
              {Math.floor(segment.startTimeUs / 60_000_000)}:
              {String(
                Math.floor(segment.startTimeUs / 1_000_000) % 60,
              ).padStart(2, "0")}
            </small>
          </button>
        ))}
      </div>
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
    selectedId = useStudioStore((state) => state.chartId),
    setSelectedId = useStudioStore((state) => state.setChartId),
    [pasting, setPasting] = useState(false),
    [paste, setPaste] = useState(""),
    [issues, setIssues] = useState<string[]>([]),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const chart =
    charts?.find((value) => value.chartId === selectedId) ?? charts?.[0];
  const rendered = useMemo(
    () =>
      chart?.lines.map((line) => ({
        ...line,
        segments: line.segments.map((segment) => ({
          ...segment,
          chord: segment.chord
            ? transposeChord(
                segment.chord,
                chart.transposeSemitones,
                chart.simplify,
              )
            : undefined,
        })),
      })),
    [chart],
  );
  const unique = useMemo(
    () =>
      Array.from(
        new Set(
          rendered?.flatMap((line) =>
            line.segments.flatMap((segment) =>
              segment.chord ? [segment.chord] : [],
            ),
          ) ?? [],
        ),
      ).slice(0, 4),
    [rendered],
  );
  const addText = (text: string) => {
    if (!originalId) return;
    // Nothing is saved until the text is worth saving. Adding the chart first
    // and complaining afterwards is how `{title:` became a lyric line — and,
    // because a chart replaces the detected timeline, an unfixable one.
    const found = chordProIssues(text);
    if (found.length) { setIssues(found); setPaste(text); setPasting(true); return; }
    const value = save(parseChordPro(text, originalId, uuidV7(), songTitle));
    setSelectedId(value.chartId);
    setPasting(false);
    setPaste("");
    setIssues([]);
  };
  const importFile = async (file?: File) => {
    // A bad file lands in the same editor as bad pasted text, with the same
    // errors against it, because repairing it needs the same surface.
    if (file) addText(await file.text());
    if (input.current) input.current.value = "";
  };
  // Closing keeps the text. Someone who pasted a long chart and wants the panel
  // out of the way has not asked to lose it, and reopening puts it back.
  // Focus goes back to whichever control opened the panel — every view has one,
  // and without this the removed button leaves focus on the body.
  const closePaste = () => { setPasting(false); setIssues([]); trigger.current?.focus(); };
  const chooseFile = (event: MouseEvent<HTMLButtonElement>) => { trigger.current = event.currentTarget; input.current?.click(); };
  const importButton = (
    <button onClick={chooseFile}>
      <UploadSimple />
      Import ChordPro
    </button>
  );
  const pasteTrigger = (
    <button
      aria-expanded={pasting}
      onClick={(event) => { trigger.current = event.currentTarget; if (pasting) closePaste(); else setPasting(true); }}
    >
      <Plus />
      Paste chart
    </button>
  );
  const pastePanel = pasting && (
    <section
      className={styles.paste}
      // Escape belongs to the innermost thing that can close, so it stops here
      // rather than travelling on to whatever else may be listening.
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closePaste(); } }}
    >
      <textarea
        autoFocus
        value={paste}
        onChange={(event) => { setPaste(event.target.value); setIssues([]); }}
        placeholder={"{title: Song}\n[Am]Lyrics with [F]chords"}
        aria-label="Paste ChordPro chart"
        aria-invalid={issues.length > 0}
      />
      {issues.length > 0 && (
        <ul className={styles.issues} role="alert">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      <div className={styles.pasteActions}>
        <button disabled={!paste.trim()} onClick={() => addText(paste)}>
          Add chart
        </button>
        <button onClick={closePaste}>Cancel</button>
      </div>
    </section>
  );
  const update = (change: Partial<UserChartV1>) =>
    chart && save({ ...chart, ...change });
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
  if (!chart && analysis?.segments.length)
    return (
      <div className={styles.detected} role="tabpanel">
        <AnalysisChordRail
          originalId={originalId}
          currentTimeUs={currentTimeUs}
          seekTo={seekTo}
        />
        <div className={styles.detectedActions}>
          <p>
            Detected chords stay aligned to source time. Click any segment to
            seek; low-confidence answers are shown, not hidden.
          </p>
          <button
            onClick={() =>
              addText(
                `{title: ${songTitle ?? "Detected chords"}}\n${analysis.segments
                  .map(
                    (segment) =>
                      `[${segment.chord}]${Math.floor(
                        segment.startTimeUs / 60_000_000,
                      )
                        .toString()
                        .padStart(2, "0")}:${Math.floor(
                        (segment.startTimeUs / 1_000_000) % 60,
                      )
                        .toString()
                        .padStart(2, "0")}`,
                  )
                  .join("\n")}`,
              )
            }
          >
            <Plus />
            Create editable chart
          </button>
          {importButton}
          {pasteTrigger}
        </div>
        {pastePanel}
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
  if (!chart) {
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
        {pastePanel}
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
    <div className={styles.chart} role="tabpanel">
      {/* This view has an Import button too, so it needs the repair editor a
          rejected file opens — otherwise importing a bad chart here does
          nothing at all, visibly. */}
      {pastePanel}
      <div className={styles.toolbar}>
        <select
          aria-label="Selected chord chart"
          value={chart.chartId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {charts.map((item) => (
            <option key={item.chartId} value={item.chartId}>
              {item.title}
            </option>
          ))}
        </select>
        <button onClick={chooseFile}>
          <UploadSimple />
          Import
        </button>
        <button onClick={download}>
          <DownloadSimple />
          Export
        </button>
        <span>Transpose</span>
        <button
          aria-label="Transpose down"
          onClick={() =>
            update({
              transposeSemitones: Math.max(-12, chart.transposeSemitones - 1),
            })
          }
        >
          −
        </button>
        <output>
          {chart.transposeSemitones > 0
            ? `+${chart.transposeSemitones}`
            : chart.transposeSemitones}
        </output>
        <button
          aria-label="Transpose up"
          onClick={() =>
            update({
              transposeSemitones: Math.min(12, chart.transposeSemitones + 1),
            })
          }
        >
          +
        </button>
        <button
          aria-pressed={chart.simplify}
          onClick={() => update({ simplify: !chart.simplify })}
        >
          Simplify
        </button>
        <button
          className={styles.delete}
          aria-label="Remove selected chart"
          onClick={() => void remove(chart.chartId)}
        >
          <Trash />
        </button>
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept=".cho,.chordpro,.pro,text/plain"
          aria-label="Choose ChordPro chart"
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
      </div>
      <header>
        <div>
          <h2>{chart.title}</h2>
          <p>{chart.artist || "User chart"}</p>
        </div>
        <label>
          Capo{" "}
          <button
            aria-label="Decrease capo"
            onClick={() => update({ capo: Math.max(0, chart.capo - 1) })}
          >
            −
          </button>
          <output>{chart.capo}</output>
          <button
            aria-label="Increase capo"
            onClick={() => update({ capo: Math.min(12, chart.capo + 1) })}
          >
            +
          </button>
        </label>
      </header>
      {unique.length > 0 && (
        <div className={styles.diagrams}>
          {unique.map((chord) => (
            <ChordDiagram chord={chord} userChords={userChords??[]} key={chord} />
          ))}
        </div>
      )}
      <div className={styles.chartLines}>
        {rendered?.map((line) => (
          <section key={line.id}>
            {line.section && <h3>{line.section}</h3>}
            <p>
              {line.segments.map((segment, index) => (
                <span key={index}>
                  {segment.chord && <b>{segment.chord}</b>}
                  <i>{segment.text || " "}</i>
                </span>
              ))}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
