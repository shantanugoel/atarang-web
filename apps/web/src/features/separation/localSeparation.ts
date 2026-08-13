import { assertSeparationManifest, STEM_KINDS, type SeparationManifestV1, type StemKind } from "@atarang/contracts";
import { runtimeAssets } from "../../generated/runtime-assets";
import type { BlobRecord, CapabilityRecord, ModelRecord, OperationRecord, OriginalRecord, SeparationRecord } from "../../storage/database";
import { uuidV7 } from "../../storage/ids";
import { withSongMutationLease } from "../../storage/mutationLease";
import { opfsPathsExist } from "../../storage/opfs";
import { failImportOperation, getBlob, listCapabilities, listModels, publishSeparation, startImportOperation } from "../../storage/repositories";
import { withLocalInferenceLease } from "./inferenceLease";
import { userMessage } from "../../app/errorText";

export type LocalSeparationProgress = { stage: "preflight" | "loading_model" | "separating" | "packaging" | "publishing"; progress: number };

interface WorkerComplete {
  type: "separation/complete";
  requestId: string;
  songId: string;
  generation: number;
  peakWorkingSampleSlots: number;
  results: { kind: StemKind; sha256: string; blobId: string; opfsPath: string; byteLength: number; mediaType: string }[];
}

export interface LocalBrowserSupport { available:boolean;reason:string;backend?:"webgpu"|"wasm" }

export function localSeparationErrorMessage(code:string){
  const messages:Record<string,string>={
    cpu_fallback_available:"This browser has no WebGPU adapter, so separation runs on the processor. It works, but expect several minutes per song.",
    cross_origin_isolation_required:"Browser separation needs secure cross-origin isolation. Reload this site directly or choose Cloud separation.",
    quota_exceeded:"There is not enough browser storage for four lossless stems. Free browser storage or choose Cloud separation.",
    model_integrity_failed:"The installed browser model is incomplete. Reinstall it from Settings before trying again.",
    unsupported_format:"This browser cannot decode the source audio for separation.",
    storage_unavailable:"Browser storage failed while creating stems. Check available space and site-storage permissions.",
    local_capability_failed:"Browser separation stopped because WebGPU inference failed. Try restarting with hardware acceleration enabled, or choose Cloud separation.",
    webgpu_probe_failed:"This browser could not check WebGPU availability. Restart it with hardware acceleration enabled, or choose Cloud separation.",
    webgpu_probe_timeout:"The WebGPU check did not respond. Restart the browser, or choose Cloud separation.",
    storage_preflight_timeout:"The browser storage check did not respond. Reload the page and try again, or choose Cloud separation.",
    operation_store_timeout:"Browser storage did not start the separation operation. Reload the page and try again.",
    local_worker_stalled:"Browser separation stopped because the WebGPU worker made no progress for 90 seconds. Restart the browser or choose Cloud separation.",
    local_inference_busy:"Another browser model test or separation is already running. Cancel it before starting this separation.",
    song_busy_in_another_tab:"This song is already being processed in another tab. Close the other tab or wait for it to finish.",
  };
  return userMessage(code,messages,"Browser separation failed. No stems were published.");
}

export function probeLocalBrowser(modelArtifactId:string):Promise<LocalBrowserSupport>{
  return new Promise(resolve=>{
    if(!crossOriginIsolated||typeof SharedArrayBuffer==="undefined"){resolve({available:false,reason:"cross_origin_isolation_required"});return}
    const worker=new Worker(runtimeAssets.inferenceWorker,{type:"module",name:"atarang-local-support-probe"}),requestId=uuidV7();
    let finished=false;
    const finish=(result:LocalBrowserSupport)=>{if(finished)return;finished=true;clearTimeout(timeout);worker.terminate();resolve(result)};
    const timeout=window.setTimeout(()=>finish({available:false,reason:"webgpu_probe_timeout"}),10_000);
    worker.onmessage=({data})=>{if(data.requestId!==requestId||data.type!=="capability/result")return;finish({available:true,reason:data.reason,backend:data.backend})};
    worker.onerror=()=>finish({available:false,reason:"webgpu_probe_failed"});
    worker.postMessage({type:"capability/probe",requestId,modelArtifactId});
  });
}

export async function qualifiedLocalRoute() {
  const now = Date.now();
  const [stored, capabilities] = await Promise.all([listModels(), listCapabilities()]);
  const present = await Promise.all(stored.map((model) => opfsPathsExist(Object.values(model.bindings))));
  const models = stored.filter((_, index) => present[index]);
  for (const model of models) {
    const capability = capabilities.find((record) => record.modelArtifactId === model.id && record.correctnessPassed && (record.status === "qualified" || record.status === "slow") && Date.parse(record.expiresAt) > now);
    if (capability) return { model, capability };
  }
  return models[0] ? { model: models[0], capability: null } : null;
}

function bounded<T>(operation:Promise<T>,milliseconds:number,code:string,signal?:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(callback:(value:any)=>void,value:any)=>{if(settled)return;settled=true;window.clearTimeout(timeout);signal?.removeEventListener("abort",abort);callback(value)};
    const abort=()=>finish(reject,new DOMException("Cancelled","AbortError"));
    const timeout=window.setTimeout(()=>finish(reject,new Error(code)),milliseconds);
    if(signal?.aborted){abort();return}
    signal?.addEventListener("abort",abort,{once:true});
    operation.then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}

async function runUnlocked(original: OriginalRecord, model: ModelRecord, capability: CapabilityRecord | null, onProgress: (progress: LocalSeparationProgress) => void, signal?: AbortSignal) {
  if (capability && (!capability.correctnessPassed || !["qualified", "slow"].includes(capability.status) || capability.modelArtifactId !== model.id || Date.parse(capability.expiresAt) <= Date.now())) throw new Error("local_capability_failed");
  if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") throw new Error("cross_origin_isolation_required");
  const source = await getBlob(original.blobId);
  if (!source) throw new Error("invalid_source");
  const durationFrames = Math.round(original.durationUs * 44_100 / 1_000_000);
  const outputBytes = 4 * (44 + durationFrames * 8);
  onProgress({ stage: "preflight", progress: 0 });
  const estimate = await bounded(navigator.storage.estimate(),10_000,"storage_preflight_timeout",signal);
  const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
  const needed = outputBytes * 2 + Math.max(1_073_741_824, outputBytes * 0.2);
  if (estimate.quota && available < needed) throw new Error("quota_exceeded");
  onProgress({stage:"preflight",progress:.02});
  const operationId = uuidV7();
  const requestId = uuidV7();
  const separationId = uuidV7();
  const now = new Date().toISOString();
  const operation: OperationRecord = { id: operationId, originalId: original.id, schemaVersion: 1, createdAt: now, updatedAt: now, status: "staging", kind: "separation" };
  await bounded(startImportOperation(operation),10_000,"operation_store_timeout",signal);
  onProgress({stage:"loading_model",progress:.03});
  const worker = new Worker(runtimeAssets.inferenceWorker, { type: "module", name: "atarang-local-separation" });
  const cancel = () => worker.postMessage({ type: "separation/cancel", requestId });
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await new Promise<WorkerComplete>((resolve, reject) => {
      let settled=false;
      let watchdog=window.setTimeout(()=>finish(reject,new Error("local_worker_stalled")),90_000);
      const finish=(callback:(value:any)=>void,value:any)=>{if(settled)return;settled=true;window.clearTimeout(watchdog);signal?.removeEventListener("abort",abort);callback(value)};
      const progress=()=>{if(settled)return;window.clearTimeout(watchdog);watchdog=window.setTimeout(()=>finish(reject,new Error("local_worker_stalled")),90_000)};
      const abort=()=>finish(reject,new DOMException("Cancelled","AbortError"));
      signal?.addEventListener("abort",abort,{once:true});
      worker.onmessage = ({ data }) => {
        if (data.requestId !== requestId) return;
        progress();
        if (data.type === "separation/progress") onProgress({ stage: data.stage, progress: data.progress });
        if (data.type === "separation/complete") finish(resolve,data);
        if (data.type === "separation/error") finish(reject,new Error(data.code));
      };
      worker.onerror = () => finish(reject,new Error("local_capability_failed"));
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
    await bounded(failImportOperation(operationId, error instanceof Error ? error.message : "local_capability_failed"),10_000,"operation_store_timeout").catch(()=>undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    worker.terminate();
  }
}

export function runLocalSeparation(original: OriginalRecord, model: ModelRecord, capability: CapabilityRecord | null, onProgress: (progress: LocalSeparationProgress) => void, signal?: AbortSignal) {
  return withSongMutationLease(original.id, () => withLocalInferenceLease(() => runUnlocked(original, model, capability, onProgress, signal)));
}
