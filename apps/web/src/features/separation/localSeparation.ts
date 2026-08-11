import { assertSeparationManifest, STEM_KINDS, type SeparationManifestV1, type StemKind } from "@atarang/contracts";
import { runtimeAssets } from "../../generated/runtime-assets";
import type { BlobRecord, CapabilityRecord, ModelRecord, OperationRecord, OriginalRecord, SeparationRecord } from "../../storage/database";
import { uuidV7 } from "../../storage/ids";
import { withSongMutationLease } from "../../storage/mutationLease";
import { failImportOperation, getBlob, listCapabilities, listModels, publishSeparation, startImportOperation } from "../../storage/repositories";

export type LocalSeparationProgress = { stage: "preflight" | "loading_model" | "separating" | "packaging" | "publishing"; progress: number };

interface WorkerComplete {
  type: "separation/complete";
  requestId: string;
  songId: string;
  generation: number;
  peakWorkingSampleSlots: number;
  results: { kind: StemKind; sha256: string; blobId: string; opfsPath: string; byteLength: number; mediaType: string }[];
}

export async function qualifiedLocalRoute() {
  const now = Date.now();
  const [models, capabilities] = await Promise.all([listModels(), listCapabilities()]);
  for (const model of models) {
    const capability = capabilities.find((record) => record.modelArtifactId === model.id && record.correctnessPassed && (record.status === "qualified" || record.status === "slow") && Date.parse(record.expiresAt) > now);
    if (capability) return { model, capability };
  }
  return models[0] ? { model: models[0], capability: null } : null;
}

async function runUnlocked(original: OriginalRecord, model: ModelRecord, capability: CapabilityRecord | null, onProgress: (progress: LocalSeparationProgress) => void, signal?: AbortSignal) {
  if (capability && (!capability.correctnessPassed || !["qualified", "slow"].includes(capability.status) || capability.modelArtifactId !== model.id || Date.parse(capability.expiresAt) <= Date.now())) throw new Error("local_capability_failed");
  if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") throw new Error("cross_origin_isolation_required");
  const source = await getBlob(original.blobId);
  if (!source) throw new Error("invalid_source");
  const durationFrames = Math.round(original.durationUs * 44_100 / 1_000_000);
  const outputBytes = 4 * (44 + durationFrames * 8);
  onProgress({ stage: "preflight", progress: 0 });
  const estimate = await navigator.storage.estimate();
  const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
  const needed = outputBytes * 2 + Math.max(1_073_741_824, outputBytes * 0.2);
  if (estimate.quota && available < needed) throw new Error("quota_exceeded");
  const operationId = uuidV7();
  const requestId = uuidV7();
  const separationId = uuidV7();
  const now = new Date().toISOString();
  const operation: OperationRecord = { id: operationId, originalId: original.id, schemaVersion: 1, createdAt: now, updatedAt: now, status: "staging", kind: "separation" };
  await startImportOperation(operation);
  const worker = new Worker(runtimeAssets.inferenceWorker, { type: "module", name: "atarang-local-separation" });
  const cancel = () => worker.postMessage({ type: "separation/cancel", requestId });
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await new Promise<WorkerComplete>((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.requestId !== requestId) return;
        if (data.type === "separation/progress") onProgress({ stage: data.stage, progress: data.progress });
        if (data.type === "separation/complete") resolve(data);
        if (data.type === "separation/error") reject(new Error(data.code));
      };
      worker.onerror = () => reject(new Error("local_capability_failed"));
      worker.postMessage({ type: "separation/local", requestId, songId: original.id, generation: 1, operationId, sourceOpfsPath: source.opfsPath, totalFrames: durationFrames, model: { manifest: model.manifest, bindings: model.bindings } });
      if (signal?.aborted) cancel();
    });
    if (response.results.length !== 4 || response.peakWorkingSampleSlots !== 343_980 * 9) throw new Error("result_integrity_failed");
    onProgress({ stage: "publishing", progress: 0.98 });
    const committedAt = new Date().toISOString();
    const byKind = new Map(response.results.map((result) => [result.kind, result]));
    const stems = STEM_KINDS.map((kind) => {
      const result = byKind.get(kind);
      if (!result || result.byteLength !== 44 + durationFrames * 8) throw new Error("result_integrity_failed");
      return { kind, blobId: result.blobId, sampleRate: 44_100, channels: 2 as const, durationFrames, variants: [{ encoding: "pcm-f32le-wav" as const, mediaType: "audio/wav", byteLength: result.byteLength, sha256: result.sha256 }] };
    }) as SeparationManifestV1["stems"];
    const manifest: SeparationManifestV1 = {
      schema: "atarang.separation/1",
      separationId,
      original: { originalId: original.id, contentSha256: original.contentSha256, sourceMediaType: original.sourceMediaType, sampleRate: 44_100, channels: 2, durationFrames },
      model: { modelId: "htdemucs-4stem", artifactVersion: model.manifest.artifactVersion, artifactSha256: model.manifest.artifactSha256, upstream: "facebookresearch/demucs htdemucs", license: "MIT" },
      pipeline: { implementation: "browser-ort-web", implementationVersion: "atarang-web/1", decodeVersion: "mediabunny/1.53.0", preprocessVersion: "demucs-web-stft/1", segmentFrames: 343_980, overlapFrames: 85_995, shifts: 1, postprocessVersion: "demucs-web-overlap-add/1" },
      stems,
      provenance: { mode: "local", createdAt: committedAt },
    };
    assertSeparationManifest(manifest);
    const blobs: BlobRecord[] = response.results.map((result) => ({ id: result.blobId, schemaVersion: 1, createdAt: committedAt, updatedAt: committedAt, sha256: result.sha256, byteLength: result.byteLength, mediaType: result.mediaType, opfsPath: result.opfsPath, referenceCount: 1 }));
    const bindings = Object.fromEntries(response.results.map((result) => [result.kind, result.blobId])) as Record<StemKind, string>;
    const record: SeparationRecord = { id: separationId, originalId: original.id, schemaVersion: 1, createdAt: committedAt, updatedAt: committedAt, manifest, bindings };
    await publishSeparation(record, blobs, operation);
    onProgress({ stage: "publishing", progress: 1 });
    return record;
  } catch (error) {
    await failImportOperation(operationId, error instanceof Error ? error.message : "local_capability_failed");
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    worker.terminate();
  }
}

export function runLocalSeparation(original: OriginalRecord, model: ModelRecord, capability: CapabilityRecord | null, onProgress: (progress: LocalSeparationProgress) => void, signal?: AbortSignal) {
  return withSongMutationLease(original.id, () => runUnlocked(original, model, capability, onProgress, signal));
}
