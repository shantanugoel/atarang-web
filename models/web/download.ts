import { mkdir } from "node:fs/promises";

interface ModelManifest {
  artifactVersion:string;
  pieces:{name:string;byteLength:number;sha256:string}[];
}

const manifest=await Bun.file("models/web/manifest.json").json() as ModelManifest;
const output="model-files";
await mkdir(output,{recursive:true});
const base=`https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/${manifest.artifactVersion}/`;

for(const piece of manifest.pieces){
  const response=await fetch(`${base}${piece.name}`);
  if(!response.ok)throw new Error(`model download failed: ${piece.name} (${response.status})`);
  const bytes=await response.arrayBuffer();
  const sha256=Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex");
  if(bytes.byteLength!==piece.byteLength||sha256!==piece.sha256)throw new Error(`model integrity failed: ${piece.name}`);
  await Bun.write(`${output}/${piece.name}`,bytes);
}

await Bun.write(`${output}/manifest.json`,Bun.file("models/web/manifest.json"));
