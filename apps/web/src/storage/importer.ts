import { runtimeAssets } from "../generated/runtime-assets";
import type { BlobRecord, OperationRecord, OriginalRecord } from "./database";
import { uuidV7 } from "./ids";
import { failImportOperation, publishImport, putSetting, staleStagingOperations, startImportOperation } from "./repositories";

export type ImportProgress = { phase: "preflight" | "writing" | "verifying" | "publishing"; completedBytes: number; totalBytes: number };
interface WorkerSuccess { type: "import/complete"; requestId: string; operationId: string; sha256: string; blobId: string; opfsPath: string; byteLength: number; mediaType: string }
interface WorkerFailure { type: "import/error"; requestId: string; operationId: string; code: string; message: string }
interface WorkerProgress { type: "import/progress"; requestId: string; operationId: string; phase: "writing" | "verifying"; completedBytes: number; totalBytes: number }

function titleFromFileName(name: string) { return name.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

// Filenames usually carry the artist too: "Artist - Title (Official Video)".
// Bracketed promo suffixes are noise on either side, and a last " - " splits
// the pair; anything else keeps the old whole-name title with no artist. The
// lyrics search prefills from both, so this is the difference between useful
// LRCLIB matches out of the box and a dialog the user has to retype.
function metadataFromFileName(name: string): { title: string; artist: string } {
  const stem = name.replace(/\.[^.]+$/, "");
  const cleaned = stem.replace(/[(\[][^)\]]*[)\]]/g, " ").replace(/\s+/g, " ").trim();
  const split = cleaned.lastIndexOf(" - ");
  if (split > 0) return { title: cleaned.slice(split + 3).trim(), artist: cleaned.slice(0, split).trim() };
  return { title: titleFromFileName(stem), artist: "" };
}

async function probeDurationUs(file: File) {
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => { URL.revokeObjectURL(url); audio.removeAttribute("src"); audio.load(); };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => { const durationUs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1_000_000) : 0; cleanup(); resolve(durationUs); };
    audio.onerror = () => { cleanup(); reject(new Error("unsupported_format")); };
    audio.src = url;
  });
}

async function storagePreflight(file: File) {
  const estimate = await navigator.storage.estimate();
  const needed = file.size * 2 + Math.max(1_073_741_824, file.size * .2);
  const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
  if (estimate.quota && available < needed) throw new Error("quota_exceeded");
}

export async function importLocalFile(file: File, onProgress: (progress: ImportProgress) => void) {
  if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aac|flac|ogg|opus|webm)$/i.test(file.name)) throw new Error("unsupported_format");
  if (file.size > 1_073_741_824) throw new Error("media_too_large");
  onProgress({ phase: "preflight", completedBytes: 0, totalBytes: file.size });
  await storagePreflight(file);
  const durationUs = await probeDurationUs(file);
  if (durationUs > 20 * 60 * 1_000_000) throw new Error("media_too_large");

  const now = new Date().toISOString();
  const originalId = uuidV7();
  const operationId = uuidV7();
  const requestId = uuidV7();
  const operation: OperationRecord = { id: operationId, schemaVersion: 1, createdAt: now, updatedAt: now, status: "staging", kind: "import", originalId };
  await startImportOperation(operation);

  try {
    const result = await new Promise<WorkerSuccess>((resolve, reject) => {
      const worker = new Worker(runtimeAssets.ioWorker, { type: "module", name: "atarang-io" });
      worker.onmessage = ({ data }: MessageEvent<WorkerSuccess | WorkerFailure | WorkerProgress>) => {
        if (data.requestId !== requestId) return;
        if (data.type === "import/progress") onProgress({ phase: data.phase, completedBytes: data.completedBytes, totalBytes: data.totalBytes });
        if (data.type === "import/complete") { worker.terminate(); resolve(data); }
        if (data.type === "import/error") { worker.terminate(); reject(new Error(data.code)); }
      };
      worker.onerror = () => { worker.terminate(); reject(new Error("storage_unavailable")); };
      worker.postMessage({ type: "import/file", requestId, songId: originalId, generation: 1, operationId, file });
    });
    onProgress({ phase: "publishing", completedBytes: file.size, totalBytes: file.size });
    const committedAt = new Date().toISOString();
    const metadata = metadataFromFileName(file.name);
    const blob: BlobRecord = { id: result.blobId, schemaVersion: 1, createdAt: committedAt, updatedAt: committedAt, sha256: result.sha256, byteLength: result.byteLength, mediaType: result.mediaType, opfsPath: result.opfsPath, referenceCount: 1 };
    const original: OriginalRecord = { id: originalId, schemaVersion: 1, createdAt: committedAt, updatedAt: committedAt, title: metadata.title, artist: metadata.artist || "Local import", sourceFileName: file.name, sourceMediaType: result.mediaType, byteLength: file.size, durationUs, contentSha256: result.sha256, blobId: result.blobId };
    await publishImport(original, blob, operation);
    if (navigator.storage.persist) {
      try { await putSetting("storage.persistence", { granted: await navigator.storage.persist(), checkedAt: new Date().toISOString() }); } catch { /* Persistence is advisory; the committed import remains valid. */ }
    }
    return original;
  } catch (error) {
    const code = error instanceof Error ? error.message : "storage_unavailable";
    await failImportOperation(operationId, code);
    throw error;
  }
}

export async function recoverIncompleteImports() {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const stale = await staleStagingOperations(cutoff);
  if (!stale.length) return;
  const worker = new Worker(runtimeAssets.ioWorker, { type: "module", name: "atarang-io-recovery" });
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 5_000);
    worker.onmessage = ({ data }) => { if (data?.type === "cleanup/complete") { window.clearTimeout(timeout); resolve(); } };
    worker.postMessage({ type: "cleanup/staging", operationIds: stale.map((operation) => operation.id) });
  });
  worker.terminate();
  await Promise.all(stale.map((operation) => failImportOperation(operation.id, "interrupted")));
}
