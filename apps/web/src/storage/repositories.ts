import { database, type AtarangDatabase, type BlobRecord, type OperationRecord, type OriginalRecord, type PerformanceRecord, type SeparationRecord, type WaveformRecord } from "./database";
import { removeOpfsPath } from "./opfs";

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("atarang-library");
const listeners = new Set<() => void>();
channel?.addEventListener("message", () => listeners.forEach((listener) => listener()));
const notify = () => { listeners.forEach((listener) => listener()); channel?.postMessage("changed"); };

export function subscribeLibrary(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function listOriginals() { return (await database).getAll("originals").then((records) => records.sort((a,b) => b.createdAt.localeCompare(a.createdAt))); }
export async function getOriginal(id: string) { return (await database).get("originals", id); }
export async function getBlob(id: string) { return (await database).get("blobs", id); }
export async function getWaveform(originalId: string) { return (await database).get("waveforms", originalId); }
export async function putWaveform(record: WaveformRecord) { await (await database).put("waveforms", record); notify(); }
export async function listSeparations() { return (await database).getAll("separations"); }
export async function getSeparationForOriginal(originalId:string) { return (await database).getAll("separations").then(items=>items.find(item=>item.originalId===originalId)); }

export async function publishSeparation(record:SeparationRecord, blobs:BlobRecord[], operation:OperationRecord) {
  const db=await database; const transaction=db.transaction(["separations","blobs","operations"],"readwrite");
  const previous=(await transaction.objectStore("separations").getAll()).filter(value=>value.originalId===record.originalId),deltas=new Map<string,number>(),newBlobs=new Map(blobs.map(blob=>[blob.id,blob]));
  const change=(id:string,value:number)=>deltas.set(id,(deltas.get(id)??0)+value);
  for(const old of previous){for(const id of Object.values(old.bindings))change(id,-1);await transaction.objectStore("separations").delete(old.id)}
  for(const id of Object.values(record.bindings))change(id,1);
  const orphanPaths:string[]=[];
  for(const[id,delta]of deltas){const existing=await transaction.objectStore("blobs").get(id),incoming=newBlobs.get(id),next=(existing?.referenceCount??0)+delta;if(next<=0){if(existing){await transaction.objectStore("blobs").delete(id);orphanPaths.push(existing.opfsPath)}}else if(existing)await transaction.objectStore("blobs").put({...existing,referenceCount:next,updatedAt:record.updatedAt});else if(incoming)await transaction.objectStore("blobs").put({...incoming,referenceCount:next});else throw new Error("result_integrity_failed")}
  await transaction.objectStore("separations").put(record); await transaction.objectStore("operations").put({...operation,status:"committed",updatedAt:record.updatedAt}); await transaction.done;
  for(const path of orphanPaths)try{await removeOpfsPath(path)}catch{/* Unreferenced media is reclaimed by the integrity sweep. */}
  notify();
}

export async function startImportOperation(operation: OperationRecord) {
  await (await database).put("operations", operation);
}

export async function publishImport(original: OriginalRecord, blob: BlobRecord, operation: OperationRecord) {
  const db = await database;
  const transaction = db.transaction(["originals", "blobs", "operations"], "readwrite");
  const existingBlob = await transaction.objectStore("blobs").get(blob.id);
  await transaction.objectStore("blobs").put(existingBlob ? { ...existingBlob, referenceCount: existingBlob.referenceCount + 1, updatedAt: blob.updatedAt } : blob);
  await transaction.objectStore("originals").add(original);
  await transaction.objectStore("operations").put({ ...operation, status: "committed", updatedAt: original.updatedAt });
  await transaction.done;
  notify();
}

export async function failImportOperation(operationId: string, errorCode: string) {
  const db = await database;
  const operation = await db.get("operations", operationId);
  if (operation) await db.put("operations", { ...operation, status: "failed", errorCode, updatedAt: new Date().toISOString() });
}

export async function libraryUsage() {
  const blobs = await (await database).getAll("blobs");
  return blobs.reduce((total, blob) => total + blob.byteLength, 0);
}

export async function removeOriginal(id: string) {
  const db = await database;
  const transaction = db.transaction(["originals", "blobs", "waveforms", "separations", "practice", "lyrics", "charts", "beats"], "readwrite");
  const original = await transaction.objectStore("originals").get(id);
  if (!original) { transaction.abort(); return false; }
  const separations = (await transaction.objectStore("separations").getAll()).filter((record) => record.originalId === id);
  await transaction.objectStore("originals").delete(id);
  await transaction.objectStore("waveforms").delete(id);
  await transaction.objectStore("practice").delete(id);
  await transaction.objectStore("lyrics").delete(id);
  await transaction.objectStore("beats").delete(id);
  const charts=(await transaction.objectStore("charts").getAll()).filter(record=>record.originalId===id);for(const chart of charts)await transaction.objectStore("charts").delete(chart.id);
  for (const separation of separations) await transaction.objectStore("separations").delete(separation.id);
  const references = [original.blobId, ...separations.flatMap((record) => Object.values(record.bindings))];
  const orphanPaths: string[] = [];
  for (const blobId of references) {
    const blob = await transaction.objectStore("blobs").get(blobId);
    if (!blob) continue;
    if (blob.referenceCount > 1) await transaction.objectStore("blobs").put({ ...blob, referenceCount: blob.referenceCount - 1, updatedAt: new Date().toISOString() });
    else { await transaction.objectStore("blobs").delete(blob.id); orphanPaths.push(blob.opfsPath); }
  }
  await transaction.done;
  for (const orphanPath of orphanPaths) { try { await removeOpfsPath(orphanPath); } catch { /* An unreferenced blob is safe and reclaimed by integrity cleanup. */ } }
  notify();
  return true;
}

export async function getSetting(id: string) { return (await database).get("settings", id); }
export async function putSetting(id: string, value: unknown) {
  const db = await database; const existing = await db.get("settings", id); const now = new Date().toISOString();
  await db.put("settings", { id, value, schemaVersion: 1, createdAt: existing?.createdAt ?? now, updatedAt: now });
}

export async function staleStagingOperations(cutoff: string) {
  return (await database).getAll("operations").then((items) => items.filter((item) => item.status === "staging" && item.updatedAt < cutoff));
}

export async function putPractice(record: AtarangDatabase["practice"]["value"]) {
  return (await database).put("practice", record);
}
export async function getPractice(originalId: string) { return (await database).get("practice", originalId); }
export async function getLyrics(originalId:string){return(await database).get("lyrics",originalId)}
export async function putLyrics(record:AtarangDatabase["lyrics"]["value"]){await(await database).put("lyrics",record);notify()}
export async function listCharts(originalId:string){return(await database).getAll("charts").then(records=>records.filter(record=>record.originalId===originalId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))}
export async function putChart(record:AtarangDatabase["charts"]["value"]){await(await database).put("charts",record);notify()}
export async function removeChart(chartId:string){await(await database).delete("charts",chartId);notify()}
export async function getBeatGrid(originalId:string){return(await database).get("beats",originalId)}
export async function putBeatGrid(record:AtarangDatabase["beats"]["value"]){await(await database).put("beats",record);notify()}
export async function getChordAnalysis(originalId:string){return(await database).get("chordAnalyses",originalId)}
export async function putChordAnalysis(record:AtarangDatabase["chordAnalyses"]["value"]){await(await database).put("chordAnalyses",record);notify()}
export async function listPerformances(originalId:string){return(await database).getAll("performances").then(records=>records.filter(record=>record.originalId===originalId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))}
export async function listAllPerformances(){return(await database).getAll("performances").then(records=>records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))}
export async function publishPerformance(record:PerformanceRecord,blobs:BlobRecord[],operation:OperationRecord){const db=await database,transaction=db.transaction(["performances","blobs","operations"],"readwrite");for(const blob of blobs){const existing=await transaction.objectStore("blobs").get(blob.id);await transaction.objectStore("blobs").put(existing?{...existing,referenceCount:existing.referenceCount+1,updatedAt:blob.updatedAt}:blob)}await transaction.objectStore("performances").put(record);await transaction.objectStore("operations").put({...operation,status:"committed",updatedAt:record.updatedAt});await transaction.done;notify()}
export async function putPerformance(record:PerformanceRecord){await(await database).put("performances",record);notify()}
export async function listModels(){return(await database).getAll("models")}
export async function putModel(record:AtarangDatabase["models"]["value"]){await(await database).put("models",record);notify()}
export async function listCapabilities(){return(await database).getAll("capabilities")}
export async function getCapability(id:string){return(await database).get("capabilities",id)}
export async function putCapability(record:AtarangDatabase["capabilities"]["value"]){await(await database).put("capabilities",record);notify()}
