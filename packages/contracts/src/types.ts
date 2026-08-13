export const STEM_KINDS = ["vocals", "drums", "bass", "other"] as const;
export type StemKind = (typeof STEM_KINDS)[number];

export interface OriginalV1 {
  schema: "atarang.original/1";
  originalId: string;
  contentSha256: string;
  sourceMediaType: string;
  sampleRate: number;
  channels: 1 | 2;
  durationFrames: number;
  createdAt: string;
}

/** A saved passage: a loop the player named so they can come back to it. */
export interface PracticeSectionV1 { id: string; name: string; startTimeUs: number; endTimeUs: number }

export interface PracticeStateV1 {
  schema: "atarang.practice/1";
  originalId: string;
  revision: number;
  sourceTimeUs: number;
  target: StemKind;
  loop: { enabled: boolean; startTimeUs: number; endTimeUs: number };
  speed: number;
  pitchSemitones: number;
  repetitions: number;
  pauseSeconds: number;
  countIn: 0 | 2 | 4;
  metronome: boolean;
  stemGainDb: Record<StemKind, number>;
  /** Optional for practice documents saved before per-stem panning shipped. */
  stemPan?: Record<StemKind, number>;
  // Optional so a practice document written before sections and the speed ramp
  // still reads, which is what keeps one release of rollback available.
  sections?: PracticeSectionV1[];
  /** Percent added to the speed each time a loop repetition completes, up to 1×. 0 is off. */
  speedRampPercent?: number;
  updatedAt: string;
}

export interface LyricWordV1 { text:string;startTimeUs:number;endTimeUs:number }
export interface LyricLineV1 { id:string;text:string;startTimeUs?:number;endTimeUs?:number;source:"manual"|"lrc";confidence?:number;words:LyricWordV1[] }
export interface LyricsDocumentV1 { schema:"atarang.lyrics/1";originalId:string;revision:number;offsetUs:number;lines:LyricLineV1[];updatedAt:string }
export interface ChartSegmentV1 { chord?:string;text:string }
export interface ChartLineV1 { id:string;section?:string;segments:ChartSegmentV1[] }
export interface UserChartV1 { schema:"atarang.chart/1";chartId:string;originalId:string;revision:number;title:string;artist:string;declaredKey?:string;transposeSemitones:number;capo:number;simplify:boolean;lines:ChartLineV1[];updatedAt:string }
export interface UserChordV1 {schema:"atarang.user-chord/1";chordId:string;revision:number;symbol:string;frets:(number|null)[];barreFret?:number;updatedAt:string}
export interface BeatV1 {timeUs:number;beatInBar:1|2|3|4;downbeat:boolean}
export type BeatAlgorithmV1="atarang-spectral-flux/1"|"atarang-beat-dp/1";
export const BEAT_ALGORITHMS:readonly BeatAlgorithmV1[]=["atarang-spectral-flux/1","atarang-beat-dp/1"];
/** What a fresh analysis writes. Anything else is a grid from an older detector, kept until it is recomputed. */
export const CURRENT_BEAT_ALGORITHM:BeatAlgorithmV1="atarang-beat-dp/1";
export interface BeatGridV1 {schema:"atarang.beats/1";originalId:string;revision:number;algorithmVersion:BeatAlgorithmV1;bpm:number;reliability:number;reliable:boolean;userEdited:boolean;beats:BeatV1[];updatedAt:string}
export interface ChordSegmentV1{startTimeUs:number;endTimeUs:number;chord:string;confidence:number}
/** Which evidence the chords were decoded from. Stems exclude vocals and drums. */
export type ChordAlgorithmV1="atarang-chroma/2"|"atarang-chroma/2-stems"|"atarang-chroma/3"|"atarang-chroma/3-stems"|"atarang-crema/1";
export const CHORD_ALGORITHMS:readonly ChordAlgorithmV1[]=["atarang-chroma/2","atarang-chroma/2-stems","atarang-chroma/3","atarang-chroma/3-stems","atarang-crema/1"];
// What a fresh analysis writes. Anything older is readable but is recomputed on
// open, which is how a tuning fix reaches a library that already exists.
/** The learned front end supersedes the stem re-decode: it reads the mixture without needing the drums and the vocal out of the way. */
export const CURRENT_CHORD_ALGORITHMS:readonly ChordAlgorithmV1[]=["atarang-chroma/3","atarang-chroma/3-stems","atarang-crema/1"];
export interface ChordAnalysisV1{schema:"atarang.chords/1";originalId:string;revision:number;algorithmVersion:ChordAlgorithmV1;key:string|null;confidence:number;segments:ChordSegmentV1[];updatedAt:string}
export interface CorrectionLayerV1{schema:"atarang.corrections/1";originalId:string;analysisKind:"beats"|"chords"|"lyrics";generatedRevision:number;revision:number;operations:Record<string,unknown>[];updatedAt:string}
export interface PerformanceAssetV1 {blobId:string;sha256:string;byteLength:number;mediaType:"audio/wav"}
export interface PerformanceManifestV1 {schema:"atarang.performance/1";performanceId:string;originalId:string;revision:number;startedAt:string;endedAt:string;sampleRate:number;channels:2;durationFrames:number;mic:PerformanceAssetV1;backing:PerformanceAssetV1;inputOffsetUs:number;deviceSettings:{sampleRate?:number;channelCount?:number;echoCancellation?:boolean;noiseSuppression?:boolean;autoGainControl?:boolean};edit:{trimStartUs:number;trimEndUs:number;fadeInUs:number;fadeOutUs:number;micGain?:number;backingGain?:number};updatedAt:string}
export interface ModelPieceV1{name:string;url:string;order:number;byteLength:number;sha256:string;inputs:string[];outputs:string[]}
export interface ModelArtifactManifestV1{schema:"atarang.model/1";modelArtifactId:string;modelId:"htdemucs-web-onnx";artifactVersion:string;artifactSha256:string;ortVersion:"1.27.0";totalBytes:number;pieces:ModelPieceV1[];graphs:{inputs:["mix","mag"];outputs:{freq:string;time:string};stftOutsideGraph:true};upstream:"monteslu/htdemucs-web-onnx";license:"MIT";createdAt:string}

export function practiceStateErrors(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["practice state must be an object"];
  const state = value as Partial<PracticeStateV1>;
  const errors: string[] = [];
  if (state.schema !== "atarang.practice/1") errors.push("schema must be atarang.practice/1");
  if (!state.originalId || !UUID.test(state.originalId)) errors.push("originalId must be a UUID");
  if (!Number.isSafeInteger(state.revision) || state.revision! < 0) errors.push("revision must be a non-negative integer");
  if (!Number.isSafeInteger(state.sourceTimeUs) || state.sourceTimeUs! < 0) errors.push("sourceTimeUs must be a non-negative integer");
  if (!STEM_KINDS.includes(state.target as StemKind)) errors.push("target is invalid");
  if (!state.loop || typeof state.loop.enabled !== "boolean" || !Number.isSafeInteger(state.loop.startTimeUs) || !Number.isSafeInteger(state.loop.endTimeUs) || state.loop.startTimeUs < 0 || state.loop.endTimeUs - state.loop.startTimeUs < 500_000) errors.push("loop boundaries must be at least 0.5 seconds apart");
  if (typeof state.speed !== "number" || state.speed < .5 || state.speed > 1) errors.push("speed must be between 0.5 and 1");
  if (!Number.isInteger(state.pitchSemitones) || state.pitchSemitones! < -12 || state.pitchSemitones! > 12) errors.push("pitchSemitones must be an integer between -12 and 12");
  if (!Number.isInteger(state.repetitions) || state.repetitions! < 1 || state.repetitions! > 999) errors.push("repetitions must be between 1 and 999");
  if (typeof state.pauseSeconds !== "number" || state.pauseSeconds < 0 || state.pauseSeconds > 10) errors.push("pauseSeconds must be between 0 and 10");
  if (![0, 2, 4].includes(state.countIn as number)) errors.push("countIn must be 0, 2, or 4");
  if (typeof state.metronome !== "boolean") errors.push("metronome must be boolean");
  if (!state.stemGainDb || STEM_KINDS.some((kind) => typeof state.stemGainDb?.[kind] !== "number" || state.stemGainDb[kind] < -60 || state.stemGainDb[kind] > 10)) errors.push("stemGainDb is invalid");
  if (state.stemPan !== undefined && STEM_KINDS.some((kind) => typeof state.stemPan?.[kind] !== "number" || state.stemPan[kind] < -1 || state.stemPan[kind] > 1)) errors.push("stemPan is invalid");
  if (state.sections !== undefined && (!Array.isArray(state.sections) || state.sections.some((section) => !section?.id || typeof section.name !== "string" || !section.name.trim() || !Number.isSafeInteger(section.startTimeUs) || !Number.isSafeInteger(section.endTimeUs) || section.startTimeUs < 0 || section.endTimeUs - section.startTimeUs < 500_000))) errors.push("sections must be named passages at least 0.5 seconds long");
  if (state.speedRampPercent !== undefined && (typeof state.speedRampPercent !== "number" || state.speedRampPercent < 0 || state.speedRampPercent > 25)) errors.push("speedRampPercent must be between 0 and 25");
  if (!state.updatedAt || Number.isNaN(Date.parse(state.updatedAt))) errors.push("updatedAt must be an ISO date-time");
  return errors;
}

export function assertPracticeState(value: unknown): asserts value is PracticeStateV1 {
  const errors = practiceStateErrors(value);
  if (errors.length) throw new Error(`invalid_practice_state: ${errors.join("; ")}`);
}

export function lyricsDocumentErrors(value:unknown):string[]{
  if(!value||typeof value!=="object")return["lyrics document must be an object"];
  const document=value as Partial<LyricsDocumentV1>,errors:string[]=[];
  if(document.schema!=="atarang.lyrics/1")errors.push("schema must be atarang.lyrics/1");
  if(!document.originalId||!UUID.test(document.originalId))errors.push("originalId must be a UUID");
  if(!Number.isSafeInteger(document.revision)||document.revision!<0)errors.push("revision must be a non-negative integer");
  if(!Number.isSafeInteger(document.offsetUs))errors.push("offsetUs must be integer microseconds");
  if(!Array.isArray(document.lines))errors.push("lines must be an array");
  else document.lines.forEach((line,index)=>{if(!line.id||typeof line.text!=="string"||!["manual","lrc"].includes(line.source))errors.push(`line ${index} is invalid`);if(line.startTimeUs!==undefined&&(!Number.isSafeInteger(line.startTimeUs)||line.startTimeUs<0))errors.push(`line ${index} start is invalid`);if(line.endTimeUs!==undefined&&(!Number.isSafeInteger(line.endTimeUs)||line.endTimeUs<0||(line.startTimeUs!==undefined&&line.endTimeUs<line.startTimeUs)))errors.push(`line ${index} end is invalid`);if(!Array.isArray(line.words)||line.words.some(word=>typeof word.text!=="string"||!Number.isSafeInteger(word.startTimeUs)||!Number.isSafeInteger(word.endTimeUs)||word.endTimeUs<word.startTimeUs||(line.startTimeUs!==undefined&&word.startTimeUs<line.startTimeUs)||(line.endTimeUs!==undefined&&word.endTimeUs>line.endTimeUs)))errors.push(`line ${index} words are invalid`)});
  if(!document.updatedAt||Number.isNaN(Date.parse(document.updatedAt)))errors.push("updatedAt must be an ISO date-time");
  return errors;
}
export function assertLyricsDocument(value:unknown):asserts value is LyricsDocumentV1{const errors=lyricsDocumentErrors(value);if(errors.length)throw new Error(`invalid_lyrics: ${errors.join("; ")}`)}

export function userChartErrors(value:unknown):string[]{if(!value||typeof value!=="object")return["chart must be an object"];const chart=value as Partial<UserChartV1>,errors:string[]=[];if(chart.schema!=="atarang.chart/1")errors.push("schema must be atarang.chart/1");if(!chart.chartId||!UUID.test(chart.chartId))errors.push("chartId must be a UUID");if(!chart.originalId||!UUID.test(chart.originalId))errors.push("originalId must be a UUID");if(!Number.isSafeInteger(chart.revision)||chart.revision!<0)errors.push("revision is invalid");if(typeof chart.title!=="string"||typeof chart.artist!=="string")errors.push("chart metadata is invalid");if(!Number.isInteger(chart.transposeSemitones)||chart.transposeSemitones! < -12||chart.transposeSemitones!>12)errors.push("transposeSemitones is invalid");if(!Number.isInteger(chart.capo)||chart.capo!<0||chart.capo!>12)errors.push("capo is invalid");if(typeof chart.simplify!=="boolean")errors.push("simplify must be boolean");if(!Array.isArray(chart.lines)||chart.lines.some(line=>!line.id||!Array.isArray(line.segments)||line.segments.some(segment=>typeof segment.text!=="string"||(segment.chord!==undefined&&typeof segment.chord!=="string"))))errors.push("chart lines are invalid");if(!chart.updatedAt||Number.isNaN(Date.parse(chart.updatedAt)))errors.push("updatedAt must be an ISO date-time");return errors}
export function assertUserChart(value:unknown):asserts value is UserChartV1{const errors=userChartErrors(value);if(errors.length)throw new Error(`invalid_chart: ${errors.join("; ")}`)}
export function userChordErrors(value:unknown):string[]{if(!value||typeof value!=="object")return["user chord must be an object"];const chord=value as Partial<UserChordV1>,errors:string[]=[];if(chord.schema!=="atarang.user-chord/1"||!chord.chordId||!UUID.test(chord.chordId))errors.push("user chord identity is invalid");if(!Number.isSafeInteger(chord.revision)||chord.revision!<0||typeof chord.symbol!=="string"||!CHORD_SYMBOL.test(chord.symbol.trim()))errors.push("user chord metadata is invalid");if(!Array.isArray(chord.frets)||chord.frets.length!==6||chord.frets.every(fret=>fret===null)||chord.frets.some(fret=>fret!==null&&(!Number.isInteger(fret)||fret<0||fret>24)))errors.push("user chord frets are invalid");const fretted=chord.frets?.filter((fret):fret is number=>typeof fret==="number"&&fret>0)??[];if(chord.barreFret!==undefined&&(!Number.isInteger(chord.barreFret)||chord.barreFret<1||chord.barreFret>20||fretted.some(fret=>fret<chord.barreFret!||fret>chord.barreFret!+4)))errors.push("user chord barre is invalid");if(chord.barreFret===undefined&&fretted.some(fret=>fret>5))errors.push("a high-position chord needs a barre fret");if(!chord.updatedAt||Number.isNaN(Date.parse(chord.updatedAt)))errors.push("updatedAt must be an ISO date-time");return errors}
export function assertUserChord(value:unknown):asserts value is UserChordV1{const errors=userChordErrors(value);if(errors.length)throw new Error(`invalid_user_chord: ${errors.join("; ")}`)}
export function beatGridErrors(value:unknown):string[]{if(!value||typeof value!=="object")return["beat grid must be an object"];const grid=value as Partial<BeatGridV1>,errors:string[]=[];if(grid.schema!=="atarang.beats/1"||!BEAT_ALGORITHMS.includes(grid.algorithmVersion as BeatAlgorithmV1))errors.push("beat schema or algorithm is invalid");if(!grid.originalId||!UUID.test(grid.originalId))errors.push("originalId must be a UUID");if(!Number.isInteger(grid.revision)||grid.revision!<0)errors.push("revision is invalid");if(typeof grid.bpm!=="number"||grid.bpm<30||grid.bpm>300)errors.push("bpm must be between 30 and 300");if(typeof grid.reliability!=="number"||grid.reliability<0||grid.reliability>1||typeof grid.reliable!=="boolean"||typeof grid.userEdited!=="boolean")errors.push("reliability is invalid");if(!Array.isArray(grid.beats)||grid.beats.some((beat,index,beats)=>!Number.isSafeInteger(beat.timeUs)||beat.timeUs<0||![1,2,3,4].includes(beat.beatInBar)||beat.downbeat!==(beat.beatInBar===1)||(index>0&&beat.beatInBar!==beats[index-1]!.beatInBar%4+1)))errors.push("beats are invalid");if(!grid.updatedAt||Number.isNaN(Date.parse(grid.updatedAt)))errors.push("updatedAt must be an ISO date-time");return errors}
export function assertBeatGrid(value:unknown):asserts value is BeatGridV1{const errors=beatGridErrors(value);if(errors.length)throw new Error(`invalid_beat_grid: ${errors.join("; ")}`)}
export function chordAnalysisErrors(value:unknown):string[]{if(!value||typeof value!=="object")return["chord analysis must be an object"];const analysis=value as Partial<ChordAnalysisV1>,errors:string[]=[];if(analysis.schema!=="atarang.chords/1"||!CHORD_ALGORITHMS.includes(analysis.algorithmVersion as ChordAlgorithmV1))errors.push("chord schema or algorithm is invalid");if(!analysis.originalId||!UUID.test(analysis.originalId))errors.push("originalId must be a UUID");if(!Number.isSafeInteger(analysis.revision)||analysis.revision!<0||typeof analysis.confidence!=="number"||analysis.confidence<0||analysis.confidence>1)errors.push("chord metadata is invalid");if(!Array.isArray(analysis.segments)||analysis.segments.some((segment,index)=>!Number.isSafeInteger(segment.startTimeUs)||!Number.isSafeInteger(segment.endTimeUs)||segment.startTimeUs<0||segment.endTimeUs<=segment.startTimeUs||typeof segment.chord!=="string"||typeof segment.confidence!=="number"||segment.confidence<0||segment.confidence>1||(index>0&&segment.startTimeUs<analysis.segments![index-1]!.endTimeUs)))errors.push("chord segments are invalid");if(!analysis.updatedAt||Number.isNaN(Date.parse(analysis.updatedAt)))errors.push("updatedAt must be an ISO date-time");return errors}
export function assertChordAnalysis(value:unknown):asserts value is ChordAnalysisV1{const errors=chordAnalysisErrors(value);if(errors.length)throw new Error(`invalid_chord_analysis: ${errors.join("; ")}`)}
export function performanceManifestErrors(value:unknown):string[]{if(!value||typeof value!=="object")return["performance must be an object"];const take=value as Partial<PerformanceManifestV1>,errors:string[]=[];if(take.schema!=="atarang.performance/1")errors.push("schema must be atarang.performance/1");if(!take.performanceId||!UUID.test(take.performanceId)||!take.originalId||!UUID.test(take.originalId))errors.push("performance IDs are invalid");if(!Number.isSafeInteger(take.revision)||take.revision!<0)errors.push("revision is invalid");if(!take.startedAt||!take.endedAt||Number.isNaN(Date.parse(take.startedAt))||Number.isNaN(Date.parse(take.endedAt))||Date.parse(take.endedAt)<Date.parse(take.startedAt))errors.push("recording interval is invalid");if(!Number.isInteger(take.sampleRate)||take.sampleRate!<8000||take.sampleRate!>192000||take.channels!==2||!Number.isSafeInteger(take.durationFrames)||take.durationFrames!<=0)errors.push("audio geometry is invalid");for(const name of ["mic","backing"] as const){const asset=take[name];if(!asset||!asset.blobId?.startsWith("sha256:")||!SHA.test(asset.sha256??"")||asset.blobId!==`sha256:${asset.sha256}`||!Number.isSafeInteger(asset.byteLength)||asset.byteLength!<=44||asset.mediaType!=="audio/wav")errors.push(`${name} asset is invalid`)}if(!Number.isSafeInteger(take.inputOffsetUs)||Math.abs(take.inputOffsetUs!)>2_000_000)errors.push("input offset is invalid");if(!take.edit||![take.edit.trimStartUs,take.edit.trimEndUs,take.edit.fadeInUs,take.edit.fadeOutUs].every(Number.isSafeInteger)||take.edit.trimStartUs<0||take.edit.trimEndUs<=take.edit.trimStartUs||take.edit.trimEndUs>Math.round((take.durationFrames??0)/(take.sampleRate??1)*1_000_000)||take.edit.fadeInUs<0||take.edit.fadeOutUs<0||[take.edit.micGain,take.edit.backingGain].some(gain=>gain!==undefined&&(!Number.isFinite(gain)||gain<0||gain>2)))errors.push("edit metadata is invalid");if(!take.updatedAt||Number.isNaN(Date.parse(take.updatedAt)))errors.push("updatedAt must be an ISO date-time");return errors}
export function assertPerformanceManifest(value:unknown):asserts value is PerformanceManifestV1{const errors=performanceManifestErrors(value);if(errors.length)throw new Error(`invalid_performance: ${errors.join("; ")}`)}
export function modelArtifactManifestErrors(value:unknown):string[]{if(!value||typeof value!=="object")return["model manifest must be an object"];const manifest=value as Partial<ModelArtifactManifestV1>,errors:string[]=[];if(manifest.schema!=="atarang.model/1"||manifest.modelId!=="htdemucs-web-onnx"||manifest.ortVersion!=="1.27.0"||manifest.upstream!=="monteslu/htdemucs-web-onnx"||manifest.license!=="MIT")errors.push("model identity or provenance is invalid");if(!manifest.modelArtifactId||!UUID.test(manifest.modelArtifactId)||typeof manifest.artifactVersion!=="string"||!manifest.artifactVersion||!SHA.test(manifest.artifactSha256??""))errors.push("artifact identity is invalid");if(!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes!<=0)errors.push("totalBytes is invalid");const produced=new Set(["mix","mag"]);if(!Array.isArray(manifest.pieces)||manifest.pieces.length!==21)errors.push("model requires exactly 21 pieces");else{const names=new Set<string>(),total=manifest.pieces.reduce((sum,piece,index)=>{const graphInvalid=!Array.isArray(piece.inputs)||!piece.inputs.length||piece.inputs.some(input=>!produced.has(input))||!Array.isArray(piece.outputs)||!piece.outputs.length||piece.outputs.some(output=>!output||produced.has(output));if(piece.order!==index||!piece.name||names.has(piece.name)||piece.name.includes("/")||piece.name.includes("..")||!piece.url.startsWith("/models/")||!Number.isSafeInteger(piece.byteLength)||piece.byteLength<=0||!SHA.test(piece.sha256)||graphInvalid)errors.push(`piece ${index} is invalid`);names.add(piece.name);for(const output of piece.outputs??[])produced.add(output);return sum+(piece.byteLength||0)},0);if(total!==manifest.totalBytes)errors.push("piece sizes do not equal totalBytes")}if(!manifest.graphs||manifest.graphs.stftOutsideGraph!==true||manifest.graphs.inputs?.join(",")!=="mix,mag"||!manifest.graphs.outputs||typeof manifest.graphs.outputs.freq!=="string"||typeof manifest.graphs.outputs.time!=="string"||!produced.has(manifest.graphs.outputs.freq)||!produced.has(manifest.graphs.outputs.time))errors.push("graph contract is invalid");if(!manifest.createdAt||Number.isNaN(Date.parse(manifest.createdAt)))errors.push("createdAt must be an ISO date-time");return errors}
export function assertModelArtifactManifest(value:unknown):asserts value is ModelArtifactManifestV1{const errors=modelArtifactManifestErrors(value);if(errors.length)throw new Error(`invalid_model_manifest: ${errors.join("; ")}`)}

export interface MediaVariantV1 { encoding: "flac" | "pcm-f32le-wav"; mediaType: string; byteLength: number; sha256: string }
export interface SeparationStemV1 { kind: StemKind; blobId: string; sampleRate: number; channels: 2; durationFrames: number; variants: MediaVariantV1[] }
export interface SeparationManifestV1 {
  schema: "atarang.separation/1";
  separationId: string;
  original: { originalId:string; contentSha256:string; sourceMediaType:string; sampleRate:number; channels:1|2; durationFrames:number };
  model: { modelId:"htdemucs-4stem"; artifactVersion:string; artifactSha256:string; upstream:"facebookresearch/demucs htdemucs"; license:"MIT" };
  pipeline: { implementation:"browser-ort-web"|"server-pytorch"; implementationVersion:string; decodeVersion:string; preprocessVersion:string; segmentFrames:number; overlapFrames:number; shifts:number; postprocessVersion:string };
  stems: [SeparationStemV1,SeparationStemV1,SeparationStemV1,SeparationStemV1];
  provenance: { mode:"local"|"cloud"; createdAt:string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const CHORD_SYMBOL=/^[A-Ga-g][#b♯♭]?[^/]*(?:\/[A-Ga-g][#b♯♭]?)?$/;
export function separationManifestErrors(value: unknown): string[] {
  const errors:string[]=[]; const manifest=value as Partial<SeparationManifestV1>;
  if (!value || typeof value!=="object") return ["manifest must be an object"];
  if (manifest.schema!=="atarang.separation/1") errors.push("schema must be atarang.separation/1");
  if (!manifest.separationId || !UUID.test(manifest.separationId)) errors.push("separationId must be a UUID");
  if (!manifest.original || !UUID.test(manifest.original.originalId??"")) errors.push("original.originalId must be a UUID");
  if (!SHA.test(manifest.original?.contentSha256??"")) errors.push("original.contentSha256 must be SHA-256");
  if (manifest.model?.modelId!=="htdemucs-4stem") errors.push("model.modelId must be htdemucs-4stem");
  if (!SHA.test(manifest.model?.artifactSha256??"")) errors.push("model.artifactSha256 must be SHA-256");
  if (!['browser-ort-web','server-pytorch'].includes(manifest.pipeline?.implementation??"")) errors.push("pipeline implementation is invalid");
  if (!Array.isArray(manifest.stems) || manifest.stems.length!==4) errors.push("stems must contain exactly four entries");
  else {
    const expected:readonly StemKind[]=STEM_KINDS;
    manifest.stems.forEach((stem,index)=>{
      if (stem.kind!==expected[index]) errors.push(`stem ${index} must be ${expected[index]}`);
      if (!SHA.test(stem.blobId.replace(/^sha256:/,""))) errors.push(`${stem.kind}.blobId must be content-addressed`);
      if (stem.sampleRate!==manifest.original?.sampleRate || stem.channels!==2 || stem.durationFrames!==manifest.original?.durationFrames) errors.push(`${stem.kind} audio geometry differs from original`);
      if (!stem.variants.length) errors.push(`${stem.kind} requires a media variant`);
      stem.variants.forEach((variant)=>{if(!SHA.test(variant.sha256)||!Number.isSafeInteger(variant.byteLength)||variant.byteLength<=0)errors.push(`${stem.kind} variant integrity is invalid`)});
    });
  }
  return errors;
}

export function assertSeparationManifest(value:unknown): asserts value is SeparationManifestV1 { const errors=separationManifestErrors(value); if(errors.length)throw new Error(`invalid_manifest: ${errors.join('; ')}`); }
