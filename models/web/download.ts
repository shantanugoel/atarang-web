interface ModelManifest {
  artifactVersion:string;
  pieces:{name:string;byteLength:number;sha256:string}[];
}

const manifest=await Bun.file("models/web/manifest.json").json() as ModelManifest;
const output="model-files";
const base=`https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/${manifest.artifactVersion}/`;
const sha256=async(bytes:ArrayBuffer)=>Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex");

// A staged piece is re-hashed rather than re-fetched. This also verifies the
// checked-in model files before a build uses them.
let fetched=0;
for(const piece of manifest.pieces){
  const staged=Bun.file(`${output}/${piece.name}`);
  if(staged.size===piece.byteLength&&await sha256(await staged.arrayBuffer())===piece.sha256)continue;
  const response=await fetch(`${base}${piece.name}`);
  if(!response.ok)throw new Error(`model download failed: ${piece.name} (${response.status})`);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==piece.byteLength||await sha256(bytes)!==piece.sha256)throw new Error(`model integrity failed: ${piece.name}`);
  await Bun.write(`${output}/${piece.name}`,bytes);
  fetched++;
}

await Bun.write(`${output}/manifest.json`,Bun.file("models/web/manifest.json"));
console.log(`Model pieces: ${fetched} downloaded, ${manifest.pieces.length-fetched} already staged.`);
