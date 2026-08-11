import { openDB, type DBSchema } from "idb";
import type { BeatGridV1, ChordAnalysisV1, LyricsDocumentV1, ModelArtifactManifestV1, PerformanceManifestV1, PracticeStateV1, SeparationManifestV1, StemKind, UserChartV1 } from "@atarang/contracts";

export interface StoredRecord { id: string; schemaVersion: number; createdAt: string; updatedAt: string }
export interface OriginalRecord extends StoredRecord {
  title: string;
  artist: string;
  sourceFileName: string;
  sourceMediaType: string;
  byteLength: number;
  durationUs: number;
  contentSha256: string;
  blobId: string;
}
export interface BlobRecord extends StoredRecord { sha256: string; byteLength: number; mediaType: string; opfsPath: string; referenceCount: number }
export interface OperationRecord extends StoredRecord {
  status: "staging" | "committed" | "failed";
  kind: "import" | "separation" | "recording" | "export" | "restore";
  originalId: string;
  errorCode?: string;
}
export interface WaveformLevel { framesPerBucket: number; min: Float32Array; max: Float32Array; rms: Float32Array }
export interface WaveformRecord extends StoredRecord { originalId: string; algorithmVersion: "atarang-waveform/1"; sampleRate: number; channels: number; durationFrames: number; levels: WaveformLevel[] }
export interface SeparationRecord extends StoredRecord { originalId:string; manifest:SeparationManifestV1; bindings:Record<StemKind,string> }
export interface BeatGridRecord extends StoredRecord {originalId:string;document:BeatGridV1}
export interface ChordAnalysisRecord extends StoredRecord {originalId:string;document:ChordAnalysisV1}
export interface PerformanceRecord extends StoredRecord {originalId:string;revision:number;manifest:PerformanceManifestV1}
export interface QuarantineRecord extends StoredRecord {kind:"blob"|"record"|"operation";recordId:string;code:string;recoverable:boolean}
export interface ModelRecord extends StoredRecord{manifest:ModelArtifactManifestV1;status:"ready";bindings:Record<string,string>}
export interface CapabilityRecord extends StoredRecord{modelArtifactId:string;ortVersion:string;browserMajor:string;os:string;adapterVendor:string;adapterArchitecture:string;driverDescription:string;backend:"webgpu"|"wasm"|"none";status:"candidate"|"qualified"|"slow"|"unavailable";reason:string;rtf?:number;peakMemoryBytes?:number;correctnessPassed:boolean;expiresAt:string}

export interface AtarangDatabase extends DBSchema {
  originals: { key: string; value: OriginalRecord };
  blobs: { key: string; value: BlobRecord };
  separations: { key: string; value: SeparationRecord };
  practice: { key: string; value: StoredRecord & { originalId: string; revision: number; document: PracticeStateV1 } };
  lyrics: { key:string;value:StoredRecord & {originalId:string;revision:number;document:LyricsDocumentV1} };
  charts: { key:string;value:StoredRecord & {originalId:string;revision:number;document:UserChartV1} };
  beats: {key:string;value:BeatGridRecord};
  chordAnalyses:{key:string;value:ChordAnalysisRecord};
  performances:{key:string;value:PerformanceRecord};
  quarantine:{key:string;value:QuarantineRecord};
  models:{key:string;value:ModelRecord};
  capabilities:{key:string;value:CapabilityRecord};
  settings: { key: string; value: StoredRecord & { value: unknown } };
  operations: { key: string; value: OperationRecord };
  waveforms: { key: string; value: WaveformRecord };
}

export const database = openDB<AtarangDatabase>("atarang", 10, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("originals")) db.createObjectStore("originals", { keyPath: "id" });
    if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
    if (!db.objectStoreNames.contains("separations")) db.createObjectStore("separations", { keyPath: "id" });
    if (!db.objectStoreNames.contains("practice")) db.createObjectStore("practice", { keyPath: "id" });
    if (!db.objectStoreNames.contains("lyrics")) db.createObjectStore("lyrics", { keyPath: "id" });
    if (!db.objectStoreNames.contains("charts")) db.createObjectStore("charts", { keyPath: "id" });
    if (!db.objectStoreNames.contains("beats")) db.createObjectStore("beats", { keyPath: "id" });
    if (!db.objectStoreNames.contains("chordAnalyses")) db.createObjectStore("chordAnalyses", { keyPath: "id" });
    if (!db.objectStoreNames.contains("performances")) db.createObjectStore("performances", { keyPath: "id" });
    if (!db.objectStoreNames.contains("quarantine")) db.createObjectStore("quarantine", { keyPath: "id" });
    if (!db.objectStoreNames.contains("models")) db.createObjectStore("models", { keyPath: "id" });
    if (!db.objectStoreNames.contains("capabilities")) db.createObjectStore("capabilities", { keyPath: "id" });
    if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
    if (!db.objectStoreNames.contains("operations")) db.createObjectStore("operations", { keyPath: "id" });
    if (!db.objectStoreNames.contains("waveforms")) db.createObjectStore("waveforms", { keyPath: "id" });
  },
});
