import type {SeparationManifestV1,StemKind} from "@atarang/contracts";
import type {OriginalRecord} from "../../storage/database";
import {fileForOpfsPath} from "../../storage/opfs";
import {getBlob} from "../../storage/repositories";
import {uuidV7} from "../../storage/ids";
import {IncrementalSha256} from "../../storage/sha256";

export interface CloudConfiguration{origin:string;deploymentKey:string}
export interface CloudProgress{stage:string;progress:number;uploadedBytes:number;totalBytes:number}
interface ErrorEnvelope{error?:{code?:string}}

const CONFIG_KEY="atarang.cloud.configuration";
export function getCloudConfiguration():CloudConfiguration|null{try{const value=JSON.parse(sessionStorage.getItem(CONFIG_KEY)??"null") as Partial<CloudConfiguration>|null;if(!value?.origin||!value.deploymentKey)return null;return{origin:new URL(value.origin).origin,deploymentKey:value.deploymentKey}}catch{return null}}
export function setCloudConfiguration(value:CloudConfiguration|null){if(value)sessionStorage.setItem(CONFIG_KEY,JSON.stringify({origin:new URL(value.origin).origin,deploymentKey:value.deploymentKey}));else sessionStorage.removeItem(CONFIG_KEY)}

async function checked(response:Response){if(response.ok)return response;let code=response.status===401?"invalid_deployment_key":`http_${response.status}`;try{const body=await response.json() as ErrorEnvelope;code=response.status===401?"invalid_deployment_key":body.error?.code??code}catch{/* stable fallback */}throw new Error(code)}
async function sha256(blob:Blob){const digest=new IncrementalSha256(),reader=blob.stream().getReader();while(true){const{done,value}=await reader.read();if(done)break;digest.update(value)}return digest.digestHex()}
const wait=(milliseconds:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,milliseconds);signal.addEventListener("abort",()=>{clearTimeout(timer);reject(signal.reason)},{once:true})});

export async function cloudCapabilities(config:CloudConfiguration){return checked(await fetch(`${config.origin}/api/v1/capabilities`,{headers:{Accept:"application/json","X-Atarang-Key":config.deploymentKey}})).then(response=>response.json())}

export async function runCloudSeparation(original:OriginalRecord,config:CloudConfiguration,onProgress:(value:CloudProgress)=>void,signal:AbortSignal){
  const blob=await getBlob(original.blobId);if(!blob)throw new Error("invalid_source");const source=await fileForOpfsPath(blob.opfsPath);const headers:{Authorization:string;Accept:string}={Authorization:"",Accept:"application/json"};
  onProgress({stage:"creating",progress:0,uploadedBytes:0,totalBytes:source.size});
  const created=await checked(await fetch(`${config.origin}/api/v1/jobs`,{method:"POST",headers:{"Content-Type":"application/json","X-Atarang-Key":config.deploymentKey,"Idempotency-Key":uuidV7()},body:JSON.stringify({source:{kind:"upload",size:source.size,sha256:original.contentSha256},modelArtifactId:"atarang-htdemucs-server-1",requestedOutputVariants:["flac"]}),signal})).then(response=>response.json()) as {jobId:string;capabilityToken:string};headers.Authorization=`Bearer ${created.capabilityToken}`;
  signal.addEventListener("abort",()=>{void fetch(`${config.origin}/api/v1/jobs/${created.jobId}/cancel`,{method:"POST",headers}).catch(()=>undefined)},{once:true});
  const upload=await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}/uploads`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({totalBytes:source.size,mediaType:original.sourceMediaType,contentSha256:original.contentSha256}),signal})).then(response=>response.json()) as {uploadId:string;partSize:number};
  let uploadedBytes=0,partCount=0;
  for(let start=0;start<source.size;start+=upload.partSize){const part=source.slice(start,Math.min(source.size,start+upload.partSize));const end=start+part.size-1;await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}/uploads/${upload.uploadId}/parts/${partCount}`,{method:"PUT",headers:{...headers,"Content-Range":`bytes ${start}-${end}/${source.size}`,"X-Content-Sha256":await sha256(part)},body:part,signal}));uploadedBytes+=part.size;partCount++;onProgress({stage:"uploading",progress:uploadedBytes/source.size*.08,uploadedBytes,totalBytes:source.size})}
  await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}/uploads/${upload.uploadId}/complete`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({partCount,contentSha256:original.contentSha256}),signal}));
  let delay=2_000;let job:{state:string;stage:string;progress:number};
  do{await wait(delay,signal);job=await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}`,{headers,signal})).then(response=>response.json());onProgress({stage:job.stage,progress:job.progress,uploadedBytes,totalBytes:source.size});if(["failed","cancelled","expired"].includes(job.state))throw new Error(job.state);delay=Math.min(15_000,Math.round(delay*1.35))}while(job.state!=="ready");
  const result=await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}/result`,{headers,signal})).then(response=>response.json()) as {manifest:SeparationManifestV1;variants:{stem:StemKind;encoding:string;mediaType:string;byteLength:number;sha256:string;downloadPath:string}[]};
  result.manifest.original.originalId=original.id;
  const files:File[]=[new File([JSON.stringify(result.manifest)],"manifest.json",{type:"application/json"})];
  for(const kind of ["vocals","drums","bass","other"] as const){const variant=result.variants.find(value=>value.stem===kind&&value.encoding==="flac");if(!variant)throw new Error("result_integrity_failed");const response=await checked(await fetch(new URL(variant.downloadPath,config.origin),{headers,signal}));const data=await response.blob();if(data.size!==variant.byteLength||await sha256(data)!==variant.sha256)throw new Error("result_integrity_failed");files.push(new File([data],`${kind}.flac`,{type:variant.mediaType}))}
  return{files,purge:async()=>{await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}`,{method:"DELETE",headers}))}};
}

export async function runYouTubeSeparation(
  url:string,
  config:CloudConfiguration,
  onProgress:(value:CloudProgress)=>void,
  signal:AbortSignal,
  importSource:(file:File)=>Promise<OriginalRecord>,
  processingMode:"server"|"browser"="server",
){
  onProgress({stage:"creating",progress:0,uploadedBytes:0,totalBytes:0});
  const created=await checked(await fetch(`${config.origin}/api/v1/jobs`,{method:"POST",headers:{"Content-Type":"application/json","X-Atarang-Key":config.deploymentKey,"Idempotency-Key":uuidV7()},body:JSON.stringify({source:{kind:"youtube",url},processingMode,modelArtifactId:"atarang-htdemucs-server-1",requestedOutputVariants:["flac"]}),signal})).then(response=>response.json()) as {jobId:string;capabilityToken:string};
  const headers={Authorization:`Bearer ${created.capabilityToken}`,Accept:"application/json"};
  signal.addEventListener("abort",()=>{void fetch(`${config.origin}/api/v1/jobs/${created.jobId}/cancel`,{method:"POST",headers}).catch(()=>undefined)},{once:true});
  let delay=1_000;let job:{state:string;stage:string;progress:number;sourceTitle?:string;sourceArtist?:string;mediaType?:string;byteLength?:number};
  do{await wait(delay,signal);job=await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}`,{headers,signal})).then(response=>response.json());onProgress({stage:job.stage,progress:job.progress,uploadedBytes:0,totalBytes:job.byteLength??0});if(["failed","cancelled","expired"].includes(job.state))throw new Error(job.state);delay=Math.min(10_000,Math.round(delay*1.35))}while(job.state!=="ready");
  onProgress({stage:"importing_source",progress:.96,uploadedBytes:0,totalBytes:job.byteLength??0});
  const sourceResponse=await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}/source`,{headers,signal}));
  const sourceBlob=await sourceResponse.blob();
  if(job.byteLength&&sourceBlob.size!==job.byteLength)throw new Error("result_integrity_failed");
  const original=await importSource(new File([sourceBlob],`${job.sourceTitle??"YouTube audio"}.mp3`,{type:job.mediaType??"audio/mpeg"}));
  const purge=async()=>{await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}`,{method:"DELETE",headers}))};
  if(processingMode==="browser")return{original,files:null,purge};
  const result=await checked(await fetch(`${config.origin}/api/v1/jobs/${created.jobId}/result`,{headers,signal})).then(response=>response.json()) as {manifest:SeparationManifestV1;variants:{stem:StemKind;encoding:string;mediaType:string;byteLength:number;sha256:string;downloadPath:string}[]};
  result.manifest.original.originalId=original.id;
  const files:File[]=[new File([JSON.stringify(result.manifest)],"manifest.json",{type:"application/json"})];
  for(const kind of ["vocals","drums","bass","other"] as const){const variant=result.variants.find(value=>value.stem===kind&&value.encoding==="flac");if(!variant)throw new Error("result_integrity_failed");const response=await checked(await fetch(new URL(variant.downloadPath,config.origin),{headers,signal}));const data=await response.blob();if(data.size!==variant.byteLength||await sha256(data)!==variant.sha256)throw new Error("result_integrity_failed");files.push(new File([data],`${kind}.flac`,{type:variant.mediaType}))}
  return{original,files,purge};
}
