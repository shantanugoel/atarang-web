import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { assertModelArtifactManifest, type ModelArtifactManifestV1 } from "@atarang/contracts";
import { runtimeAssets } from "../../generated/runtime-assets";
import type { CapabilityRecord, ModelRecord } from "../../storage/database";
import { opfsPathsExist } from "../../storage/opfs";
import { listCapabilities, listModels, putCapability, putModel } from "../../storage/repositories";
import { uuidV7 } from "../../storage/ids";
import { withLocalInferenceLease } from "./inferenceLease";

type Progress = { completedBytes: number; totalBytes: number; piece: number };
type QualificationState = { qualifying: boolean; progress: number; capability: CapabilityRecord | null; error: string };

let qualificationState: QualificationState = { qualifying: false, progress: 0, capability: null, error: "" };
let qualificationWorker: { worker: Worker; requestId: string; cancel(): void } | null = null;
const qualificationListeners = new Set<() => void>();
const qualificationSnapshot = () => qualificationState;
const subscribeQualification = (listener: () => void) => { qualificationListeners.add(listener); return () => qualificationListeners.delete(listener); };
const updateQualification = (next: Partial<QualificationState>) => {
  qualificationState = { ...qualificationState, ...next };
  qualificationListeners.forEach((listener) => listener());
};

const platform = () => {
  const chromium = navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/);
  const firefox = navigator.userAgent.match(/Firefox\/(\d+)/);
  const safari = navigator.userAgent.match(/Version\/(\d+).*Safari/);
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } };
  return { browserMajor: chromium ? `chromium-${chromium[1]}` : firefox ? `firefox-${firefox[1]}` : safari ? `safari-${safari[1]}` : "unknown", os: agent.userAgentData?.platform ?? navigator.platform ?? "unknown" };
};

export function useModelManager() {
  const [manifest, setManifest] = useState<ModelArtifactManifestV1 | null>(null);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [storedCapability, setStoredCapability] = useState<CapabilityRecord | null>(null);
  const [error, setError] = useState("");
  const workerRef = useRef<{ worker: Worker; requestId: string } | null>(null);
  const qualification = useSyncExternalStore(subscribeQualification, qualificationSnapshot, qualificationSnapshot);
  const refresh = useCallback(() => void Promise.all([listModels(), listCapabilities()]).then(async ([nextModels, capabilities]) => {
    // The record lives in IndexedDB, the weights live in OPFS, and only the
    // weights are evictable. Believing the record alone reports a model as
    // installed long after the browser reclaimed it.
    const installed = await Promise.all(nextModels.map((model) => opfsPathsExist(Object.values(model.bindings))));
    setModels(nextModels.filter((_, index) => installed[index]));
    setStoredCapability(capabilities.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null);
  }), []);
  useEffect(() => {
    refresh();
    const controller = new AbortController();
    void fetch("/models/htdemucs-web-onnx/manifest.json", { signal:controller.signal })
      .then(async response => {
        // A host that does not publish the weights answers with its SPA shell
        // or a 404. Both mean "not installed here", not "the manifest is bad".
        if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("built_in_model_unavailable");
        return await response.json() as unknown;
      })
      .then(value => {
        assertModelArtifactManifest(value);
        setManifest(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError("built_in_model_unavailable");
      });
    return () => controller.abort();
  }, [refresh]);

  const importManifest = useCallback(async (file: File) => {
    const value: unknown = JSON.parse(await file.text());
    assertModelArtifactManifest(value);
    setManifest(value);
    setError("");
    return value;
  }, []);

  const download = useCallback(async () => {
    if (!manifest) return;
    setError("");
    const estimate = await navigator.storage.estimate();
    const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
    const needed = manifest.totalBytes * 2 + Math.max(1_073_741_824, manifest.totalBytes * 0.2);
    if (estimate.quota && available < needed) { setError("quota_exceeded"); return; }
    const worker = new Worker(runtimeAssets.inferenceWorker, { type: "module", name: "atarang-model-download" });
    const requestId = uuidV7();
    workerRef.current = { worker, requestId };
    setProgress({ completedBytes: 0, totalBytes: manifest.totalBytes, piece: 0 });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.requestId !== requestId) return;
        if (data.type === "model/progress") setProgress({ completedBytes: data.completedBytes, totalBytes: data.totalBytes, piece: data.piece });
        if (data.type === "model/complete") {
          const now = new Date().toISOString();
          void putModel({ id: manifest.modelArtifactId, schemaVersion: 1, createdAt: manifest.createdAt, updatedAt: now, status: "ready", manifest, bindings: data.bindings }).then(() => { refresh(); resolve(); });
        }
        if (data.type === "model/error") reject(new Error(data.code));
      };
      worker.onerror = () => reject(new Error("model_download_failed"));
      worker.postMessage({ type: "model/download", requestId, manifest });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "model_download_failed")).finally(() => {
      worker.terminate();
      workerRef.current = null;
      setProgress(null);
    });
  }, [manifest, refresh]);

  const cancel = useCallback(() => {
    const current = workerRef.current;
    if (current) current.worker.postMessage({ type: "model/cancel", requestId: current.requestId });
    else if (qualificationWorker) qualificationWorker.cancel();
  }, []);

  const probe = useCallback(async (modelArtifactId: string) => {
    if (qualificationWorker) return;
    setError("");
    const model = models.find((candidate) => candidate.id === modelArtifactId);
    if (!model) { setError("model_integrity_failed"); return; }
    const worker = new Worker(runtimeAssets.inferenceWorker, { type: "module", name: "atarang-capability-probe" });
    const requestId = uuidV7();
    updateQualification({ qualifying: true, progress: 0, error: "" });
    try {
      const result = await withLocalInferenceLease(() => new Promise<any>((resolve, reject) => {
        let settled = false;
        let watchdog = window.setTimeout(() => finish(reject, new Error("local_worker_stalled")), 90_000);
        const finish = (callback: (value: any) => void, value: any) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(watchdog);
          callback(value);
        };
        const progress = () => {
          if (settled) return;
          window.clearTimeout(watchdog);
          watchdog = window.setTimeout(() => finish(reject, new Error("local_worker_stalled")), 90_000);
        };
        qualificationWorker = { worker, requestId, cancel: () => {
          worker.postMessage({ type: "model/cancel", requestId });
          finish(reject, new DOMException("Cancelled", "AbortError"));
        } };
        worker.onmessage = ({ data }) => {
          if (data.requestId !== requestId) return;
          progress();
          if (data.type === "capability/progress") updateQualification({ progress: data.progress });
          if (data.type === "capability/result") finish(resolve, data);
          if (data.type === "capability/error") finish(reject, new Error(data.code));
        };
        worker.onerror = () => finish(reject, new Error("local_capability_failed"));
        worker.postMessage({ type: "capability/qualify", requestId, modelArtifactId, model: { manifest: model.manifest, bindings: model.bindings } });
      }));
      const now = new Date();
      const identity = platform();
      const id = [modelArtifactId, "1.27.0", identity.browserMajor, identity.os, result.adapterVendor, result.adapterArchitecture, result.driverDescription].join(":");
      const record: CapabilityRecord = { id, schemaVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), modelArtifactId, ortVersion: "1.27.0", ...identity, adapterVendor: result.adapterVendor, adapterArchitecture: result.adapterArchitecture, driverDescription: result.driverDescription, backend: result.backend, status: result.status, reason: result.reason, rtf: result.rtf, peakMemoryBytes: result.peakMemoryBytes, correctnessPassed: result.correctnessPassed, expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString() };
      await putCapability(record);
      updateQualification({ capability: record, progress: 1 });
      return record;
    } catch (reason) {
      updateQualification({ error: reason instanceof DOMException && reason.name === "AbortError" ? "cancelled" : reason instanceof Error ? reason.message : "local_capability_failed" });
    } finally {
      worker.terminate();
      qualificationWorker = null;
      updateQualification({ qualifying: false });
    }
  }, [models]);

  return { manifest, models, progress, qualifying: qualification.qualifying, qualificationProgress: qualification.progress, capability: qualification.capability ?? storedCapability, error: error || qualification.error, importManifest, download, cancel, probe };
}
