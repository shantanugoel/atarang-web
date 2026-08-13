import {assertSeparationManifest,STEM_KINDS,type SeparationManifestV1,type StemKind} from "@atarang/contracts";
import {runtimeAssets} from "../../generated/runtime-assets";
import type {BlobRecord,OperationRecord,OriginalRecord,SeparationRecord} from "../../storage/database";
import {uuidV7} from "../../storage/ids";
import {withSongMutationLease} from "../../storage/mutationLease";
import {failImportOperation,publishSeparation,startImportOperation} from "../../storage/repositories";

export type SeparationImportProgress={phase:"preflight"|"writing"|"publishing";completedBytes:number;totalBytes:number};
interface WorkerResult{type:"separation/complete";requestId:string;results:{kind:StemKind;sha256:string;blobId:string;opfsPath:string;byteLength:number;mediaType:string}[]}

async function importSeparationPackageUnlocked(original:OriginalRecord,files:FileList|File[],onProgress:(progress:SeparationImportProgress)=>void){
  const list=Array.from(files);const manifestFile=list.find(file=>/\.json$/i.test(file.name));if(!manifestFile)throw new Error("invalid_manifest");
  // Both failures here are "this file is not a manifest" as far as a user is
  // concerned. Left alone they escape as a JSON parser complaint or as Ajv's
  // schema prose, neither of which is about a file the user wrote; the cause
  // is kept for devtools.
  let manifest:SeparationManifestV1;
  try{const parsed:unknown=JSON.parse(await manifestFile.text());assertSeparationManifest(parsed);manifest=parsed}
  catch(error){throw new Error("invalid_manifest",{cause:error})}
  if(manifest.original.originalId!==original.id||manifest.original.contentSha256!==original.contentSha256)throw new Error("invalid_manifest");
  const stemFiles=STEM_KINDS.map(kind=>{const file=list.find(candidate=>new RegExp(`^${kind}(?:[._-]|$)`,`i`).test(candidate.name));if(!file)throw new Error(`missing_${kind}`);return{kind,file}});
  const totalBytes=stemFiles.reduce((sum,item)=>sum+item.file.size,0);onProgress({phase:"preflight",completedBytes:0,totalBytes});const estimate=await navigator.storage.estimate();const available=(estimate.quota??0)-(estimate.usage??0);const needed=totalBytes*2+Math.max(1_073_741_824,totalBytes*.2);if(estimate.quota&&available<needed)throw new Error("quota_exceeded");
  const now=new Date().toISOString();const operationId=uuidV7();const requestId=uuidV7();const operation:OperationRecord={id:operationId,schemaVersion:1,createdAt:now,updatedAt:now,status:"staging",kind:"separation",originalId:original.id};await startImportOperation(operation);
  try{const items=stemFiles.map(({kind,file})=>{const stem=manifest.stems.find(candidate=>candidate.kind===kind)!;const variant=stem.variants.find(candidate=>candidate.byteLength===file.size)??stem.variants[0]!;return{kind,file,sha256:variant.sha256,byteLength:variant.byteLength,sampleRate:stem.sampleRate,channels:stem.channels,durationFrames:stem.durationFrames}});
    const response=await new Promise<WorkerResult>((resolve,reject)=>{const worker=new Worker(runtimeAssets.ioWorker,{type:"module",name:"atarang-separation-import"});worker.onmessage=({data})=>{if(data.requestId!==requestId)return;if(data.type==="separation/progress")onProgress({phase:"writing",completedBytes:data.completedBytes,totalBytes:data.totalBytes});if(data.type==="separation/complete"){worker.terminate();resolve(data)}if(data.type==="separation/error"){worker.terminate();reject(new Error(data.code))}};worker.onerror=()=>{worker.terminate();reject(new Error("storage_unavailable"))};worker.postMessage({type:"separation/import",requestId,songId:original.id,generation:1,operationId,items})});
    onProgress({phase:"publishing",completedBytes:totalBytes,totalBytes});const committedAt=new Date().toISOString();const blobs:BlobRecord[]=response.results.map(item=>({id:item.blobId,schemaVersion:1,createdAt:committedAt,updatedAt:committedAt,sha256:item.sha256,byteLength:item.byteLength,mediaType:item.mediaType,opfsPath:item.opfsPath,referenceCount:1}));const bindings=Object.fromEntries(response.results.map(item=>[item.kind,item.blobId])) as Record<StemKind,string>;const record:SeparationRecord={id:uuidV7(),originalId:original.id,schemaVersion:1,createdAt:committedAt,updatedAt:committedAt,manifest,bindings};await publishSeparation(record,blobs,operation);return record;
  }catch(error){await failImportOperation(operationId,error instanceof Error?error.message:"storage_unavailable");throw error}
}

export function importSeparationPackage(original:OriginalRecord,files:FileList|File[],onProgress:(progress:SeparationImportProgress)=>void){return withSongMutationLease(original.id,()=>importSeparationPackageUnlocked(original,files,onProgress))}
