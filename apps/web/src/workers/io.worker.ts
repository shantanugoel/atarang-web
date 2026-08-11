import { IncrementalSha256 } from "../storage/sha256";
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import type { StemKind } from "@atarang/contracts";

interface ImportRequest { type: "import/file"; requestId: string; songId: string; generation: number; operationId: string; file: File }
interface CleanupRequest { type: "cleanup/staging"; operationIds: string[] }
interface SeparationRequest { type:"separation/import";requestId:string;songId:string;generation:number;operationId:string;items:{kind:StemKind;file:File;sha256:string;byteLength:number;sampleRate:number;channels:number;durationFrames:number}[] }
interface PlaybackRequest {type:"playback/stream";requestId:string;songId:string;generation:number;targetSampleRate:number;startTime:number;loop?:{startTime:number;endTime:number};items:{kind:StemKind;opfsPath:string;sab:SharedArrayBuffer;capacityFrames:number}[]}
const CHUNK_SIZE = 4 * 1024 * 1024;

async function directoryPath(root: FileSystemDirectoryHandle, parts: string[], create = true) {
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return directory;
}

async function writeFile(handle: FileSystemFileHandle, source: Blob, onChunk?: (written: number) => void) {
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    let offset = 0;
    while (offset < source.size) {
      const chunk = new Uint8Array(await source.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
      const written = access.write(chunk, { at: offset });
      if (written !== chunk.byteLength) throw new Error("storage_unavailable");
      offset += written;
      onChunk?.(offset);
    }
    access.flush();
  } finally { access.close(); }
}

async function stageAndHash(handle:FileSystemFileHandle,file:File,onChunk:(written:number)=>void){const hash=new IncrementalSha256();const access=await handle.createSyncAccessHandle();try{access.truncate(0);for(let offset=0;offset<file.size;){const chunk=new Uint8Array(await file.slice(offset,offset+CHUNK_SIZE).arrayBuffer());hash.update(chunk);const written=access.write(chunk,{at:offset});if(written!==chunk.byteLength)throw new Error("storage_unavailable");offset+=written;onChunk(offset)}access.flush()}finally{access.close()}return hash.digestHex()}

async function probeAudio(file:File){const input=new Input({source:new BlobSource(file,{maxCacheSize:8*1024*1024}),formats:ALL_FORMATS});try{const track=await input.getPrimaryAudioTrack();if(!track||!(await track.canDecode()))throw new Error("unsupported_format");const sampleRate=await track.getSampleRate();const channels=await track.getNumberOfChannels();let durationFrames=0;const sink=new AudioSampleSink(track);for await(const sample of sink.samples()){durationFrames+=sample.numberOfFrames;sample.close()}return{sampleRate,channels,durationFrames}}finally{input.dispose()}}

const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
class StereoResampler{#sourceRate:number;#targetRate:number;#next=0;#inputStart=0;#previous=[0,0];#outputFrames=0;constructor(sourceRate:number,targetRate:number){this.#sourceRate=sourceRate;this.#targetRate=targetRate}process(left:Float32Array,right:Float32Array){if(!left.length)return new Float32Array();const combinedLeft=new Float32Array(left.length+1),combinedRight=new Float32Array(right.length+1);combinedLeft[0]=this.#inputStart?this.#previous[0]!:left[0]!;combinedRight[0]=this.#inputStart?this.#previous[1]!:right[0]!;combinedLeft.set(left,1);combinedRight.set(right,1);const start=this.#inputStart-1,end=this.#inputStart+left.length-1;const output:number[]=[];while(this.#next<end){const relative=this.#next-start,index=Math.floor(relative),fraction=relative-index;output.push(combinedLeft[index]!+(combinedLeft[index+1]!-combinedLeft[index]!)*fraction,combinedRight[index]!+(combinedRight[index+1]!-combinedRight[index]!)*fraction);this.#next+=this.#sourceRate/this.#targetRate;this.#outputFrames++}this.#inputStart+=left.length;this.#previous=[left[left.length-1]!,right[right.length-1]!];return new Float32Array(output)}finish(){const expected=Math.round(this.#inputStart*this.#targetRate/this.#sourceRate),remaining=Math.max(0,expected-this.#outputFrames),output=new Float32Array(remaining*2);for(let index=0;index<remaining;index++){output[index*2]=this.#previous[0]!;output[index*2+1]=this.#previous[1]!}return output}}
async function writeRing(interleaved:Float32Array,sab:SharedArrayBuffer,capacityFrames:number){const header=new Int32Array(sab,0,8),data=new Float32Array(sab,32);let sourceFrame=0,totalFrames=interleaved.length/2;while(sourceFrame<totalFrames){const available=Atomics.load(header,2),space=capacityFrames-available;if(space<=0){await delay(3);continue}const frames=Math.min(space,totalFrames-sourceFrame);let write=Atomics.load(header,1);for(let frame=0;frame<frames;frame++){data[write*2]=interleaved[(sourceFrame+frame)*2]!;data[write*2+1]=interleaved[(sourceFrame+frame)*2+1]!;write=(write+1)%capacityFrames}Atomics.store(header,1,write);Atomics.add(header,2,frames);Atomics.add(header,6,frames);sourceFrame+=frames}}
async function fileAtPath(path:string){const parts=path.split("/").filter(Boolean),name=parts.pop();if(!name)throw new Error("invalid_source");let directory=await navigator.storage.getDirectory();for(const part of parts)directory=await directory.getDirectoryHandle(part);return(await directory.getFileHandle(name)).getFile()}
async function streamStem(item:PlaybackRequest["items"][number],request:PlaybackRequest,onBuffered:()=>void){
  const file=await fileAtPath(item.opfsPath),input=new Input({source:new BlobSource(file,{maxCacheSize:8*1024*1024}),formats:ALL_FORMATS});
  try{
    const track=await input.getPrimaryAudioTrack();if(!track||!(await track.canDecode()))throw new Error("unsupported_format");
    const sourceRate=await track.getSampleRate(),channels=await track.getNumberOfChannels();if(channels!==2)throw new Error("result_integrity_failed");
    let announced=false;
    const writeRange=async(startTime:number,endTime?:number)=>{
      const resampler=new StereoResampler(sourceRate,request.targetSampleRate),sink=new AudioSampleSink(track);
      for await(const sample of sink.samples(startTime,endTime)){
        const first=Math.max(0,Math.ceil((startTime-sample.timestamp)*sourceRate-1e-6));
        const last=endTime===undefined?sample.numberOfFrames:Math.min(sample.numberOfFrames,Math.floor((endTime-sample.timestamp)*sourceRate+1e-6));
        if(last>first){const trimmed=first===0&&last===sample.numberOfFrames?sample:sample.trim(first,last);const left=new Float32Array(trimmed.numberOfFrames),right=new Float32Array(trimmed.numberOfFrames);trimmed.copyTo(left,{format:"f32-planar",planeIndex:0});trimmed.copyTo(right,{format:"f32-planar",planeIndex:1});if(trimmed!==sample)trimmed.close();await writeRing(resampler.process(left,right),item.sab,item.capacityFrames)}
        sample.close();
        const available=Atomics.load(new Int32Array(item.sab,0,8),2);if(!announced&&available>=Math.min(item.capacityFrames,request.targetSampleRate)){announced=true;onBuffered()}
      }
      await writeRing(resampler.finish(),item.sab,item.capacityFrames);
    };
    if(request.loop){await writeRange(request.startTime,request.loop.endTime);for(;;)await writeRange(request.loop.startTime,request.loop.endTime)}
    else{await writeRange(request.startTime);Atomics.store(new Int32Array(item.sab,0,8),3,1)}
    if(!announced)onBuffered();
  }finally{input.dispose()}
}

self.onmessage = async ({ data }: MessageEvent<ImportRequest | CleanupRequest | SeparationRequest | PlaybackRequest>) => {
  if (data.type === "cleanup/staging") {
    const root = await navigator.storage.getDirectory();
    try { const staging = await root.getDirectoryHandle("staging"); for (const id of data.operationIds) { try { await staging.removeEntry(id, { recursive: true }); } catch { /* Already clean. */ } } } catch { /* Staging does not exist. */ }
    self.postMessage({ type: "cleanup/complete" });
    return;
  }
  if(data.type==="separation/import"){
    const base={requestId:data.requestId,operationId:data.operationId,songId:data.songId,generation:data.generation};let stagingRoot:FileSystemDirectoryHandle|undefined;
    try{const root=await navigator.storage.getDirectory();stagingRoot=await directoryPath(root,["staging"]);const operationDirectory=await stagingRoot.getDirectoryHandle(data.operationId,{create:true});const staged=[] as {item:SeparationRequest["items"][number];handle:FileSystemFileHandle;sha256:string}[];let completed=0;const total=data.items.reduce((sum,item)=>sum+item.file.size,0);
      for(const item of data.items){const handle=await operationDirectory.getFileHandle(item.kind,{create:true});const before=completed;const sha256=await stageAndHash(handle,item.file,written=>self.postMessage({type:"separation/progress",...base,phase:"writing",completedBytes:before+written,totalBytes:total}));completed+=item.file.size;if(sha256!==item.sha256||item.file.size!==item.byteLength)throw new Error("result_integrity_failed");const geometry=await probeAudio(await handle.getFile());if(geometry.sampleRate!==item.sampleRate||geometry.channels!==item.channels||geometry.durationFrames!==item.durationFrames)throw new Error("result_integrity_failed");staged.push({item,handle,sha256})}
      const results=[];for(const entry of staged){const finalDirectory=await directoryPath(root,["blobs","sha256",entry.sha256.slice(0,2)]);const finalHandle=await finalDirectory.getFileHandle(entry.sha256,{create:true});const existing=await finalHandle.getFile();if(existing.size!==entry.item.file.size)await writeFile(finalHandle,await entry.handle.getFile());const verified=await finalHandle.getFile();if(verified.size!==entry.item.file.size)throw new Error("result_integrity_failed");results.push({kind:entry.item.kind,sha256:entry.sha256,blobId:`sha256:${entry.sha256}`,opfsPath:`/blobs/sha256/${entry.sha256.slice(0,2)}/${entry.sha256}`,byteLength:entry.item.file.size,mediaType:entry.item.file.type||"application/octet-stream"})}
      await stagingRoot.removeEntry(data.operationId,{recursive:true});self.postMessage({type:"separation/complete",...base,results});
    }catch(error){if(stagingRoot){try{await stagingRoot.removeEntry(data.operationId,{recursive:true})}catch{}}self.postMessage({type:"separation/error",...base,code:error instanceof Error?error.message:"storage_unavailable"})}return;
  }
  if(data.type==="playback/stream"){const identity={requestId:data.requestId,songId:data.songId,generation:data.generation};let buffered=0;const onBuffered=()=>{buffered++;if(buffered===data.items.length)self.postMessage({type:"playback/ready",...identity})};try{await Promise.all(data.items.map(item=>streamStem(item,data,onBuffered)));self.postMessage({type:"playback/complete",...identity})}catch(error){self.postMessage({type:"playback/error",...identity,code:error instanceof Error?error.message:"playback_failed"})}return}
  const base = { requestId: data.requestId, operationId: data.operationId };
  let stagingRoot: FileSystemDirectoryHandle | undefined;
  try {
    const root = await navigator.storage.getDirectory();
    stagingRoot = await directoryPath(root, ["staging"]);
    const operationDirectory = await stagingRoot.getDirectoryHandle(data.operationId, { create: true });
    const stagingFile = await operationDirectory.getFileHandle("original", { create: true });
    const hash = new IncrementalSha256();
    const access = await stagingFile.createSyncAccessHandle();
    try {
      access.truncate(0);
      for (let offset = 0; offset < data.file.size;) {
        const chunk = new Uint8Array(await data.file.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
        hash.update(chunk);
        const written = access.write(chunk, { at: offset });
        if (written !== chunk.byteLength) throw new Error("storage_unavailable");
        offset += written;
        self.postMessage({ type: "import/progress", ...base, phase: "writing", completedBytes: offset, totalBytes: data.file.size });
      }
      access.flush();
    } finally { access.close(); }
    const sha256 = hash.digestHex();
    const blobId = `sha256:${sha256}`;
    const finalDirectory = await directoryPath(root, ["blobs", "sha256", sha256.slice(0,2)]);
    const finalHandle = await finalDirectory.getFileHandle(sha256, { create: true });
    const existing = await finalHandle.getFile();
    if (existing.size !== data.file.size) {
      await writeFile(finalHandle, await stagingFile.getFile(), (completedBytes) => self.postMessage({ type: "import/progress", ...base, phase: "verifying", completedBytes, totalBytes: data.file.size }));
    }
    const verified = await finalHandle.getFile();
    if (verified.size !== data.file.size) throw new Error("result_integrity_failed");
    await stagingRoot.removeEntry(data.operationId, { recursive: true });
    self.postMessage({ type: "import/complete", ...base, sha256, blobId, opfsPath: `/blobs/sha256/${sha256.slice(0,2)}/${sha256}`, byteLength: data.file.size, mediaType: data.file.type || "application/octet-stream" });
  } catch (error) {
    if (stagingRoot) { try { await stagingRoot.removeEntry(data.operationId, { recursive: true }); } catch { /* Cleanup is retried at startup. */ } }
    self.postMessage({ type: "import/error", ...base, code: error instanceof Error ? error.message : "storage_unavailable", message: "Import could not be committed." });
  }
};
export {};
