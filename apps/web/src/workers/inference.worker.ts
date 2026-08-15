import * as ort from "onnxruntime-web/webgpu";
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import type { ModelArtifactManifestV1, StemKind } from "@atarang/contracts";
import {
  classifyDemucsQualification,
  combineDemucsBranches,
  DEMUCS_MODEL_STEMS,
  DEMUCS_SAMPLE_RATE,
  DEMUCS_SEGMENT_FRAMES,
  DEMUCS_STRIDE_FRAMES,
  prepareDemucsInput,
  RollingStemOverlapAdd,
  type DemucsBackend,
  type StereoStem,
} from "../features/separation/demucsDsp";
import { ortMjsUrl, ortWasmUrl } from "../generated/ort-assets";
import { IncrementalSha256 } from "../storage/sha256";

type SyncHandle = {
  write(data: BufferSource, options?: { at?: number }): number;
  read(data: BufferSource, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
};
interface DownloadMessage { type: "model/download"; requestId: string; manifest: ModelArtifactManifestV1 }
interface CancelMessage { type: "model/cancel" | "separation/cancel"; requestId: string }
interface ProbeMessage { type: "capability/probe"; requestId: string; modelArtifactId: string; constrainedMemory?: boolean }
interface QualificationMessage {
  type: "capability/qualify";
  requestId: string;
  modelArtifactId: string;
  constrainedMemory?: boolean;
  model: { manifest: ModelArtifactManifestV1; bindings: Record<string, string> };
}
interface LocalSeparationMessage {
  type: "separation/local";
  requestId: string;
  songId: string;
  generation: number;
  operationId: string;
  sourceOpfsPath: string;
  totalFrames: number;
  constrainedMemory?: boolean;
  model: { manifest: ModelArtifactManifestV1; bindings: Record<string, string> };
}

const CPU_NODES = [
  "/ReduceMean", "/Sub", "/Pow", "/ReduceMean_1", "/Clip", "/Sqrt", "/Add", "/Div",
  "/ReduceMean_2", "/Sub_1", "/Pow_1", "/ReduceMean_3", "/Clip_1", "/Sqrt_1", "/Add_1", "/Div_1",
] as const;
const controllers = new Map<string, AbortController>();
const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const directory = async (root: FileSystemDirectoryHandle, parts: string[]) => {
  let value = root;
  for (const part of parts) value = await value.getDirectoryHandle(part, { create: true });
  return value;
};
const syncHandle = async (file: FileSystemFileHandle) => await (file as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();

async function fileAtPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error("invalid_source");
  let value = await navigator.storage.getDirectory();
  for (const part of parts) value = await value.getDirectoryHandle(part);
  return (await value.getFileHandle(name)).getFile();
}

// Model weights live in OPFS, which the browser may evict when storage is not
// persistent, while the record saying they are installed lives in IndexedDB and
// survives. Name that case instead of leaking a raw DOMException.
async function modelFileAtPath(path: string) {
  try { return await fileAtPath(path); }
  catch (error) { throw error instanceof DOMException && error.name === "NotFoundError" ? new Error("model_integrity_failed") : error; }
}

async function copyFile(source: File, destination: FileSystemFileHandle) {
  const target = await syncHandle(destination);
  target.truncate(0);
  let offset = 0;
  try {
    for (let position = 0; position < source.size; position += 1_048_576) {
      const chunk = new Uint8Array(await source.slice(position, Math.min(source.size, position + 1_048_576)).arrayBuffer());
      const written = target.write(chunk, { at: offset });
      if (written !== chunk.byteLength) throw new Error("storage_unavailable");
      offset += written;
    }
    target.flush();
  } finally {
    target.close();
  }
}

async function download(data: DownloadMessage) {
  const controller = new AbortController();
  controllers.set(data.requestId, controller);
  const root = await navigator.storage.getDirectory();
  const staging = await directory(root, ["staging", data.requestId, "model"]);
  const bindings: Record<string, string> = {};
  let completedBytes = 0;
  try {
    for (const piece of data.manifest.pieces) {
      const url = new URL(piece.url, self.location.origin);
      if (url.origin !== self.location.origin || !url.pathname.startsWith("/models/")) throw new Error("model_source_not_allowed");
      const response = await fetch(url, { signal: controller.signal, credentials: "same-origin" });
      if (!response.ok || !response.body) throw new Error("model_download_failed");
      const stagingFile = await staging.getFileHandle(piece.name, { create: true });
      const handle = await syncHandle(stagingFile);
      const hash = new IncrementalSha256();
      const reader = response.body.getReader();
      handle.truncate(0);
      let position = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          hash.update(value);
          if (handle.write(value, { at: position }) !== value.byteLength) throw new Error("storage_unavailable");
          position += value.byteLength;
          completedBytes += value.byteLength;
          self.postMessage({ type: "model/progress", requestId: data.requestId, completedBytes, totalBytes: data.manifest.totalBytes, piece: piece.order });
        }
      } finally {
        handle.flush();
        handle.close();
        reader.releaseLock();
      }
      if (position !== piece.byteLength || hash.digestHex() !== piece.sha256) throw new Error("model_integrity_failed");
    }
    const target = await directory(root, ["models", data.manifest.modelArtifactId]);
    for (const piece of data.manifest.pieces) {
      const source = await (await staging.getFileHandle(piece.name)).getFile();
      const destination = await target.getFileHandle(piece.name, { create: true });
      await copyFile(source, destination);
      bindings[piece.name] = `/models/${data.manifest.modelArtifactId}/${piece.name}`;
    }
    await (await root.getDirectoryHandle("staging")).removeEntry(data.requestId, { recursive: true });
    self.postMessage({ type: "model/complete", requestId: data.requestId, bindings });
  } finally {
    controllers.delete(data.requestId);
  }
}

// One rule, read by the probe that tells the reader what is about to happen and
// by the load that then does it. Split in two, the sheet went on promising
// WebGPU on a device where the worker had already decided against it.
const backendFor = (constrainedMemory: boolean | undefined, adapter: unknown): DemucsBackend =>
  constrainedMemory || !adapter ? "wasm" : "webgpu";

async function probe(data: ProbeMessage) {
  // No adapter is not a dead end: the same graph runs on the WASM execution
  // provider. It is slower, which is a warning, not a refusal.
  const adapter = await webgpuAdapter();
  const backend = backendFor(data.constrainedMemory, adapter);
  const info = adapter?.info ?? {};
  self.postMessage({
    type: "capability/result",
    requestId: data.requestId,
    modelArtifactId: data.modelArtifactId,
    backend,
    reason: backend === "webgpu" ? "model_correctness_probe_required" : "cpu_fallback_available",
    adapterVendor: info.vendor ?? "unknown",
    adapterArchitecture: info.architecture ?? "unknown",
    driverDescription: info.description ?? "",
    correctnessPassed: false,
  });
}

type ModelExecutionMessage = LocalSeparationMessage | QualificationMessage;

// Above this, a piece is worth building and releasing around its own run rather
// than holding for the whole song. Ten pieces are over it and hold 124 of the
// model's 126 MB; the other eleven are rounding error and stay put.
const RESIDENT_PIECE_BYTES = 4_194_304;

async function createSession(piece: ModelArtifactManifestV1["pieces"][number], bindings: Record<string, string>, backend: DemucsBackend, constrainedMemory: boolean) {
  const binding = bindings[piece.name];
  if (!binding) throw new Error("model_integrity_failed");
  const model = new Uint8Array(await (await modelFileAtPath(binding)).arrayBuffer());
  const executionProviders: ort.InferenceSession.ExecutionProviderConfig[] = backend === "wasm"
    ? ["wasm"]
    : piece.order === 0 ? [{ name: "webgpu", forceCpuNodeNames: CPU_NODES }] : ["webgpu"];
  return ort.InferenceSession.create(model, {
    executionProviders,
    graphOptimizationLevel: "all",
    // Handing tensors between pieces as GPU buffers is what keeps the chain off
    // the bus. On the CPU path there is no buffer to hand over, and where the
    // GPU shares the process's memory it is the wrong trade: the U-Net skips
    // stay pinned from the encoder to the decoder, which is what put iOS over
    // its limit halfway through the first segment.
    ...(backend === "webgpu" && !constrainedMemory ? { preferredOutputLocation: "gpu-buffer" as const } : {}),
    enableCpuMemArena: false,
    enableMemPattern: false,
  });
}

async function webgpuAdapter() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(options?: unknown): Promise<unknown> } }).gpu;
  if (!gpu) return null;
  try { return await gpu.requestAdapter({ powerPreference: "high-performance" }) as null | { info?: { vendor?: string; architecture?: string; description?: string } }; }
  catch { return null; }
}

async function loadSessions(message: ModelExecutionMessage, signal: AbortSignal) {
  // An adapter reporting itself ready is not the same as the graph surviving on
  // it. iOS advertises one and then loses the tab partway through the first
  // segment — with the skips unpinned and the weights cycled out, so not for
  // want of room we control. The CPU path has carried Firefox and adapterless
  // Safari all along; it is slow, and slow beats a tab that disappears.
  const backend = backendFor(message.constrainedMemory, await webgpuAdapter());
  // Not ORT's proxy worker — that is gated on `document` and does nothing from
  // in here. Pointing `mjs` at the staged glue is what unblocks threading:
  // left to the copy inlined in this bundle, Emscripten hands each pthread this
  // worker's own URL to load, so the pool never finishes starting and the first
  // InferenceSession.create hangs past the 90s watchdog. Loaded from its own
  // URL the glue resolves itself and the threads come up.
  ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.origin).href, mjs: new URL(ortMjsUrl, self.location.origin).href };
  // WebGPU does its work on the GPU and stays on one thread. The CPU path is the
  // only local option on Safari, on Firefox and on machines without an adapter,
  // so it takes what is left after two cores are reserved for the browser.
  // Measured on ten cores: RTF 2.47 at one thread, 0.85 at four, 0.63 at eight.
  // The cap is there because the gain flattens while the contention does not.
  ort.env.wasm.numThreads = backend === "wasm" ? Math.min(8, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 2)) : 1;
  ort.env.webgpu.powerPreference = "high-performance";
  // The pieces run strictly in order, one at a time, so holding all twenty-one
  // sessions holds 126 MB of weights that nothing is reading. On a discrete GPU
  // that is memory the process is not charged for and building them once is the
  // right trade. Where the GPU shares the process's memory it is what is left
  // over the limit once the pinned skips are gone, so the ten large pieces are
  // built and released around their own run and only the eleven small ones —
  // under 3 MB together, and pure overhead to rebuild — stay resident.
  //
  // Load-bearing: this is only safe while outputs live in host memory, which is
  // the same condition. Releasing a session whose outputs are still GPU buffers
  // would free them underneath the pieces that consume them.
  // ponytail: one threshold rather than per-piece tuning. Revisit if the model
  // is re-exported with a different split.
  // Not backend-specific: the wasm heap is one allocation that grows and never
  // gives anything back, so 126 MB of weights held there costs the same as on
  // the GPU. Outputs are in host memory on both paths here, which is what makes
  // releasing a session underneath its own outputs safe.
  const cycleLargePieces = Boolean(message.constrainedMemory);
  const sessions: (ort.InferenceSession | null)[] = [];
  const reportLoading = (completed: number) => {
    const ratio = completed / message.model.manifest.pieces.length;
    if (message.type === "capability/qualify") {
      self.postMessage({ type: "capability/progress", requestId: message.requestId, progress: 0.01 + 0.09 * ratio });
    } else {
      self.postMessage({ type: "separation/progress", requestId: message.requestId, stage: "loading_model", progress: 0.03 + 0.07 * ratio });
    }
  };
  try {
    for (const piece of message.model.manifest.pieces) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      reportLoading(piece.order);
      sessions.push(cycleLargePieces && piece.byteLength > RESIDENT_PIECE_BYTES
        ? null
        : await createSession(piece, message.model.bindings, backend, Boolean(message.constrainedMemory)));
      reportLoading(piece.order + 1);
    }
    return { sessions, backend };
  } catch (error) {
    await Promise.allSettled(sessions.map((session) => session?.release()));
    throw error;
  }
}

async function runChain(message: ModelExecutionMessage, sessions: (ort.InferenceSession | null)[], backend: DemucsBackend, left: Float32Array, right: Float32Array, signal: AbortSignal, segmentIndex: number, segmentCount: number) {
  const prepared = prepareDemucsInput(left, right);
  const values = new Map<string, ort.Tensor>([
    ["mix", new ort.Tensor("float32", prepared.mix, [1, 2, DEMUCS_SEGMENT_FRAMES])],
    ["mag", new ort.Tensor("float32", prepared.mag, [1, 4, 2_048, 336])],
  ]);
  const remainingUses = new Map<string, number>();
  for (const piece of message.model.manifest.pieces) for (const input of piece.inputs) remainingUses.set(input, (remainingUses.get(input) ?? 0) + 1);
  const finalNames = new Set(Object.values(message.model.manifest.graphs.outputs));
  const device = backend === "webgpu" ? await ort.env.webgpu.device as { queue: { onSubmittedWorkDone(): Promise<void> } } : null;
  try {
    for (const piece of message.model.manifest.pieces) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const feeds: Record<string, ort.Tensor> = {};
      for (const input of piece.inputs) {
        const tensor = values.get(input);
        if (!tensor) throw new Error("model_integrity_failed");
        feeds[input] = tensor;
      }
      // loadSessions left a hole for the large pieces when it is not holding
      // them, so this is where they are built — and released again below, once
      // the queue has drained and their outputs are read out.
      const resident = sessions[piece.order];
      const session = resident ?? await createSession(piece, message.model.bindings, backend, Boolean(message.constrainedMemory));
      try {
        const result = await session.run(feeds);
        for (const output of piece.outputs) {
          const tensor = result[output];
          if (!tensor) throw new Error("model_integrity_failed");
          values.set(output, tensor);
        }
        // A session output the split does not name is nobody's input, so nothing
        // below ever disposes it. On the GPU path that is a buffer held until the
        // session is released, once per piece per segment. Identity rather than
        // name, so an output returned under two keys is never disposed while the
        // copy that was kept is still in use.
        const kept = new Set(piece.outputs.map((output) => result[output]));
        for (const tensor of Object.values(result)) if (!kept.has(tensor)) tensor.dispose();
        for (const input of piece.inputs) {
          const remaining = (remainingUses.get(input) ?? 1) - 1;
          remainingUses.set(input, remaining);
          if (remaining === 0 && !finalNames.has(input)) {
            values.get(input)?.dispose();
            values.delete(input);
          }
        }
        await device?.queue.onSubmittedWorkDone();
      } finally {
        if (!resident) await session.release();
      }
      await delay(2);
      const completedPieces = segmentIndex * sessions.length + piece.order + 1;
      self.postMessage({ type: "separation/progress", requestId: message.requestId, stage: "separating", progress: 0.1 + 0.78 * completedPieces / (segmentCount * sessions.length) });
    }
    const freqTensor = values.get(message.model.manifest.graphs.outputs.freq);
    const timeTensor = values.get(message.model.manifest.graphs.outputs.time);
    if (!freqTensor || !timeTensor) throw new Error("model_integrity_failed");
    const [freq, time] = await Promise.all([freqTensor.getData(true), timeTensor.getData(true)]);
    if (!(freq instanceof Float32Array) || !(time instanceof Float32Array) || freq.length !== 4 * 4 * 2_048 * 336 || time.length !== 4 * 2 * DEMUCS_SEGMENT_FRAMES) throw new Error("model_integrity_failed");
    return combineDemucsBranches(freq, time);
  } finally {
    for (const tensor of new Set(values.values())) tensor.dispose();
  }
}

function syntheticSample(frame: number, channel: number) {
  const time = frame / DEMUCS_SAMPLE_RATE;
  const pulse = frame % 22_050 < 120 ? 0.15 * Math.exp(-(frame % 22_050) / 25) : 0;
  return 0.18 * Math.sin(2 * Math.PI * (channel ? 329.63 : 220) * time) + 0.09 * Math.sin(2 * Math.PI * 110 * time) + pulse;
}

async function qualify(message: QualificationMessage) {
  if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") throw new Error("cross_origin_isolation_required");
  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  const sessions: (ort.InferenceSession | null)[] = [];
  const totalFrames = DEMUCS_SAMPLE_RATE * 30;
  const segmentCount = Math.ceil(Math.max(1, totalFrames - DEMUCS_SEGMENT_FRAMES) / DEMUCS_STRIDE_FRAMES) + 1;
  const started = performance.now();
  let emittedFrame = 0;
  let dot = 0;
  let inputEnergy = 0;
  let outputEnergy = 0;
  let finite = true;
  try {
    const loaded = await loadSessions(message, controller.signal);
    sessions.push(...loaded.sessions);
    self.postMessage({ type: "capability/progress", requestId: message.requestId, progress: 0.1 });
    const overlap = new RollingStemOverlapAdd();
    let segmentIndex = 0;
    const inspect = (chunks: Float32Array[]) => {
      const frames = chunks[0]!.length / 2;
      for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < 2; channel++) {
          const source = syntheticSample(emittedFrame + frame, channel);
          let sum = 0;
          for (const chunk of chunks) sum += chunk[frame * 2 + channel]!;
          finite &&= Number.isFinite(sum);
          dot += source * sum;
          inputEnergy += source * source;
          outputEnergy += sum * sum;
        }
      }
      emittedFrame += frames;
    };
    for (let start = 0; start < totalFrames; start += DEMUCS_STRIDE_FRAMES) {
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const length = Math.min(DEMUCS_SEGMENT_FRAMES, totalFrames - start);
      const left = new Float32Array(DEMUCS_SEGMENT_FRAMES);
      const right = new Float32Array(DEMUCS_SEGMENT_FRAMES);
      for (let frame = 0; frame < length; frame++) {
        left[frame] = syntheticSample(start + frame, 0);
        right[frame] = syntheticSample(start + frame, 1);
      }
      const stems = await runChain(message, sessions, loaded.backend, left, right, controller.signal, segmentIndex, segmentCount);
      const flushed = overlap.add(start, stems, length, totalFrames);
      if (flushed) inspect(flushed);
      segmentIndex++;
      self.postMessage({ type: "capability/progress", requestId: message.requestId, progress: 0.1 + 0.85 * segmentIndex / segmentCount });
    }
    inspect(overlap.finish(totalFrames));
    const elapsedSeconds = (performance.now() - started) / 1_000;
    const rtf = elapsedSeconds / 30;
    const energyRatio = outputEnergy / Math.max(1e-12, inputEnergy);
    const mixtureCorrelation = dot / Math.sqrt(Math.max(1e-12, inputEnergy * outputEnergy));
    const { correctnessPassed, status, reason } = classifyDemucsQualification({ finite, emittedFrames: emittedFrame, expectedFrames: totalFrames, energyRatio, mixtureCorrelation, rtf, backend: loaded.backend });
    const info = loaded.backend === "webgpu"
      ? (await ort.env.webgpu.device as { adapterInfo?: { vendor?: string; architecture?: string; description?: string } }).adapterInfo ?? {}
      : {};
    const peakMemoryBytes = message.model.manifest.totalBytes + DEMUCS_SEGMENT_FRAMES * 9 * 4 + 4 * 2_048 * 336 * 4 * 2;
    self.postMessage({ type: "capability/result", requestId: message.requestId, modelArtifactId: message.modelArtifactId, backend: loaded.backend, status, reason, adapterVendor: info.vendor ?? "unknown", adapterArchitecture: info.architecture ?? "unknown", driverDescription: info.description ?? "", correctnessPassed, rtf, peakMemoryBytes, mixtureCorrelation, energyRatio });
  } finally {
    await Promise.allSettled(sessions.map((session) => session?.release()));
    controllers.delete(message.requestId);
  }
}

async function decodeSegment(track: Awaited<ReturnType<Input["getPrimaryAudioTrack"]>>, startFrame: number, targetFrames: number) {
  if (!track) throw new Error("unsupported_format");
  const sourceRate = await track.getSampleRate();
  const channels = await track.getNumberOfChannels();
  const startSeconds = startFrame / DEMUCS_SAMPLE_RATE;
  const endSeconds = (startFrame + targetFrames) / DEMUCS_SAMPLE_RATE;
  const sourceBase = Math.max(0, Math.floor(startSeconds * sourceRate) - 2);
  const sourceEnd = Math.ceil(endSeconds * sourceRate) + 2;
  const sourceLeft = new Float32Array(sourceEnd - sourceBase);
  const sourceRight = new Float32Array(sourceEnd - sourceBase);
  const sink = new AudioSampleSink(track);
  for await (const sample of sink.samples(startSeconds, endSeconds)) {
    const left = new Float32Array(sample.numberOfFrames);
    const right = new Float32Array(sample.numberOfFrames);
    sample.copyTo(left, { format: "f32-planar", planeIndex: 0 });
    if (channels > 1) sample.copyTo(right, { format: "f32-planar", planeIndex: 1 });
    else right.set(left);
    const offset = Math.round(sample.timestamp * sourceRate) - sourceBase;
    const first = Math.max(0, -offset);
    const available = Math.min(sample.numberOfFrames - first, sourceLeft.length - Math.max(0, offset));
    if (available > 0) {
      sourceLeft.set(left.subarray(first, first + available), Math.max(0, offset));
      sourceRight.set(right.subarray(first, first + available), Math.max(0, offset));
    }
    sample.close();
  }
  const left = new Float32Array(DEMUCS_SEGMENT_FRAMES);
  const right = new Float32Array(DEMUCS_SEGMENT_FRAMES);
  for (let frame = 0; frame < targetFrames; frame++) {
    const sourcePosition = ((startFrame + frame) * sourceRate) / DEMUCS_SAMPLE_RATE - sourceBase;
    const index = Math.floor(sourcePosition);
    const fraction = sourcePosition - index;
    const left0 = sourceLeft[index] ?? 0;
    const left1 = sourceLeft[index + 1] ?? left0;
    const right0 = sourceRight[index] ?? 0;
    const right1 = sourceRight[index + 1] ?? right0;
    left[frame] = left0 + (left1 - left0) * fraction;
    right[frame] = right0 + (right1 - right0) * fraction;
  }
  return { left, right };
}

function wavHeader(frames: number) {
  const bytes = frames * 2 * 4;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, DEMUCS_SAMPLE_RATE, true); view.setUint32(28, DEMUCS_SAMPLE_RATE * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true); text(36, "data"); view.setUint32(40, bytes, true);
  return new Uint8Array(buffer);
}

class WavSink {
  readonly hash = new IncrementalSha256();
  readonly handle: SyncHandle;
  offset = 0;
  constructor(handle: SyncHandle, totalFrames: number) {
    this.handle = handle;
    handle.truncate(0);
    this.writeBytes(wavHeader(totalFrames));
  }
  write(interleaved: Float32Array) {
    if (!littleEndian) throw new Error("unsupported_platform");
    if (!interleaved.every(Number.isFinite)) throw new Error("local_capability_failed");
    this.writeBytes(new Uint8Array(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength));
  }
  writeBytes(bytes: Uint8Array) {
    const owned = bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : new Uint8Array(bytes);
    if (this.handle.write(owned, { at: this.offset }) !== owned.byteLength) throw new Error("storage_unavailable");
    this.hash.update(bytes);
    this.offset += bytes.byteLength;
  }
  close() { this.handle.flush(); this.handle.close(); }
}

async function separateLocal(message: LocalSeparationMessage) {
  if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") throw new Error("cross_origin_isolation_required");
  if (!Number.isSafeInteger(message.totalFrames) || message.totalFrames <= 0 || message.totalFrames > DEMUCS_SAMPLE_RATE * 20 * 60) throw new Error("media_too_large");
  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  const signal = controller.signal;
  const root = await navigator.storage.getDirectory();
  const stagingRoot = await directory(root, ["staging"]);
  const operation = await stagingRoot.getDirectoryHandle(message.operationId, { create: true });
  const sessions: (ort.InferenceSession | null)[] = [];
  const sinks = new Map<(typeof DEMUCS_MODEL_STEMS)[number], WavSink>();
  let input: Input | undefined;
  try {
    for (const kind of DEMUCS_MODEL_STEMS) sinks.set(kind, new WavSink(await syncHandle(await operation.getFileHandle(`${kind}.wav`, { create: true })), message.totalFrames));
    const loaded = await loadSessions(message, signal);
    sessions.push(...loaded.sessions);
    const source = await fileAtPath(message.sourceOpfsPath);
    input = new Input({ source: new BlobSource(source, { maxCacheSize: 8 * 1024 * 1024 }), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error("unsupported_format");
    const overlap = new RollingStemOverlapAdd();
    const segmentCount = Math.ceil(Math.max(1, message.totalFrames - DEMUCS_SEGMENT_FRAMES) / DEMUCS_STRIDE_FRAMES) + 1;
    let segmentIndex = 0;
    for (let start = 0; start < message.totalFrames; start += DEMUCS_STRIDE_FRAMES) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const length = Math.min(DEMUCS_SEGMENT_FRAMES, message.totalFrames - start);
      const decoded = await decodeSegment(track, start, length);
      const stems = await runChain(message, sessions, loaded.backend, decoded.left, decoded.right, signal, segmentIndex, segmentCount);
      const flushed = overlap.add(start, stems, length, message.totalFrames);
      if (flushed) for (let stem = 0; stem < DEMUCS_MODEL_STEMS.length; stem++) sinks.get(DEMUCS_MODEL_STEMS[stem]!)!.write(flushed[stem]!);
      segmentIndex++;
    }
    const final = overlap.finish(message.totalFrames);
    for (let stem = 0; stem < DEMUCS_MODEL_STEMS.length; stem++) sinks.get(DEMUCS_MODEL_STEMS[stem]!)!.write(final[stem]!);
    self.postMessage({ type: "separation/progress", requestId: message.requestId, stage: "packaging", progress: 0.92 });
    for (const sink of sinks.values()) sink.close();
    const results: { kind: StemKind; sha256: string; blobId: string; opfsPath: string; byteLength: number; mediaType: string }[] = [];
    for (const kind of DEMUCS_MODEL_STEMS) {
      const sink = sinks.get(kind)!;
      const sha256 = sink.hash.digestHex();
      const staged = await (await operation.getFileHandle(`${kind}.wav`)).getFile();
      const expectedBytes = 44 + message.totalFrames * 8;
      if (staged.size !== expectedBytes || sink.offset !== expectedBytes) throw new Error("result_integrity_failed");
      const destinationDirectory = await directory(root, ["blobs", "sha256", sha256.slice(0, 2)]);
      const destination = await destinationDirectory.getFileHandle(sha256, { create: true });
      const existing = await destination.getFile();
      if (existing.size !== expectedBytes) await copyFile(staged, destination);
      if ((await destination.getFile()).size !== expectedBytes) throw new Error("result_integrity_failed");
      results.push({ kind, sha256, blobId: `sha256:${sha256}`, opfsPath: `/blobs/sha256/${sha256.slice(0, 2)}/${sha256}`, byteLength: expectedBytes, mediaType: "audio/wav" });
    }
    await stagingRoot.removeEntry(message.operationId, { recursive: true });
    self.postMessage({ type: "separation/complete", requestId: message.requestId, songId: message.songId, generation: message.generation, results, peakWorkingSampleSlots: DEMUCS_SEGMENT_FRAMES * 9 });
  } catch (error) {
    for (const sink of sinks.values()) { try { sink.close(); } catch { /* Already closed. */ } }
    try { await stagingRoot.removeEntry(message.operationId, { recursive: true }); } catch { /* Startup GC retries. */ }
    throw error;
  } finally {
    input?.dispose();
    await Promise.allSettled(sessions.map((session) => session?.release()));
    controllers.delete(message.requestId);
  }
}

type WorkerMessage = DownloadMessage | CancelMessage | ProbeMessage | QualificationMessage | LocalSeparationMessage;
self.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
  if (data.type === "model/cancel" || data.type === "separation/cancel") {
    controllers.get(data.requestId)?.abort();
    return;
  }
  const operation = data.type === "model/download" ? download(data) : data.type === "capability/probe" ? probe(data) : data.type === "capability/qualify" ? qualify(data) : data.type === "separation/local" ? separateLocal(data) : Promise.resolve();
  void operation.catch((error) => self.postMessage({
    type: data.type === "model/download" ? "model/error" : data.type === "capability/probe" || data.type === "capability/qualify" ? "capability/error" : "separation/error",
    requestId: data.requestId,
    code: error instanceof DOMException && error.name === "AbortError" ? "cancelled" : error instanceof Error ? error.message : "internal_error",
  }));
};

export {};
