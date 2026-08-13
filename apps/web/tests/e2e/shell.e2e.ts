import{expect,test}from"@playwright/test";
import{readFileSync}from"node:fs";

const browserModelManifest=JSON.parse(readFileSync(new URL("../../../../models/web/manifest.json",import.meta.url),"utf8"));

function silentWav(frames=4_410){const buffer=Buffer.alloc(44+frames*4),view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength),text=(offset:number,value:string)=>buffer.write(value,offset,"ascii");text(0,"RIFF");view.setUint32(4,36+frames*4,true);text(8,"WAVE");text(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,44_100,true);view.setUint32(28,176_400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,frames*4,true);return buffer}

test("production shell is isolated and the bundled demo really plays",async({page,request})=>{const response=await request.get("/");expect(response.ok()).toBeTruthy();expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));await page.goto("/studio");await expect(page.getByRole("link",{name:"Atarang Studio home"})).toBeVisible();await expect(page.getByRole("navigation",{name:"Primary navigation"})).toBeVisible();await expect(page.getByText("Backbeat",{exact:true})).toBeVisible();const transport=page.getByRole("region",{name:"Waveform and transport"});const before=Number(await transport.getAttribute("data-source-time-us"));await page.keyboard.press("Space");await expect(page.getByRole("button",{name:"Pause",exact:true})).toHaveAttribute("aria-pressed","true");await expect.poll(async()=>Number(await transport.getAttribute("data-source-time-us")),{timeout:5_000}).toBeGreaterThan(before+250_000);await page.keyboard.press("Space");await expect(page.getByRole("button",{name:"Play",exact:true})).toHaveAttribute("aria-pressed","false");expect(errors).toEqual([])});

test("authorized YouTube acquisition exposes server and browser separation choices",async({page})=>{let suppliedKey="";await page.addInitScript(()=>sessionStorage.setItem("atarang.cloud.configuration",JSON.stringify({origin:"http://127.0.0.1:4173",deploymentKey:"a".repeat(64)})));await page.route("http://127.0.0.1:4173/api/v1/capabilities",async route=>{suppliedKey=await route.request().headerValue("X-Atarang-Key")??"";await route.fulfill({json:{cloudEnabled:true,youtubeEnabled:true}})});await page.goto("/library");await expect(page.getByRole("heading",{name:"Fetch from YouTube"})).toBeVisible();await expect(page.getByLabel("YouTube URL")).toBeVisible();const submit=page.getByRole("button",{name:"Fetch and separate"});await page.getByLabel("YouTube URL").fill("https://www.youtube.com/watch?v=Ajxn0PKbv7I");await expect(submit).toBeDisabled();await page.getByLabel("I confirm I am authorized to download and process this content.").check();await expect(submit).toBeEnabled();await page.getByLabel(/Fetch only; separate in this browser/).check();await expect(page.getByRole("button",{name:"Fetch to browser"})).toBeEnabled();expect(suppliedKey).toBe("a".repeat(64))});

test("YouTube submission works when randomUUID is unavailable on an HTTP origin",async({page})=>{let idempotencyKey="";await page.addInitScript(()=>{Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});sessionStorage.setItem("atarang.cloud.configuration",JSON.stringify({origin:"http://127.0.0.1:4173",deploymentKey:"a".repeat(64)}))});await page.route("http://127.0.0.1:4173/api/v1/capabilities",route=>route.fulfill({json:{cloudEnabled:true,youtubeEnabled:true}}));await page.route("http://127.0.0.1:4173/api/v1/jobs",async route=>{idempotencyKey=await route.request().headerValue("Idempotency-Key")??"";await route.fulfill({json:{jobId:"019fef4f-9c77-7a3f-94ca-ef4214a806c1",capabilityToken:"canary-capability",state:"acquiring_youtube"}})});await page.route("http://127.0.0.1:4173/api/v1/jobs/019fef4f-9c77-7a3f-94ca-ef4214a806c1",route=>route.fulfill({json:{state:"failed",stage:"failed",progress:.1}}));await page.goto("/library");await page.getByLabel("YouTube URL").fill("https://www.youtube.com/watch?v=Ajxn0PKbv7I");await page.getByLabel("I confirm I am authorized to download and process this content.").check();await page.getByRole("button",{name:"Fetch and separate"}).click();await expect(page.getByRole("alert")).toContainText("failed");expect(idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)});

test("supported compact layout has no horizontal overflow and keeps transport visible",async({page,isMobile})=>{test.skip(!isMobile,"compact layout project only");await page.goto("/studio");const layout=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,transport:document.querySelector('[aria-label="Waveform and transport"]')?.getBoundingClientRect().bottom}));expect(layout.scrollWidth).toBe(layout.viewport);expect(layout.transport).toBeLessThanOrEqual(await page.evaluate(()=>innerHeight));await expect(page.getByRole("tab",{name:"Takes"})).toBeVisible()});

test("cloud operator configuration is session-only and precache excludes private routes",async({page,request})=>{await page.route("http://127.0.0.1:4173/api/v1/capabilities",route=>route.fulfill({json:{cloudEnabled:true}}));await page.goto("/settings");await page.getByLabel("Server origin").fill("http://127.0.0.1:4173/path");await page.getByLabel("Deployment key").fill("a".repeat(64));await page.getByRole("button",{name:"Save and test"}).click();await expect(page.getByText("Server capability verified for this session.")).toBeVisible();const stored=await page.evaluate(()=>sessionStorage.getItem("atarang.cloud.configuration"));expect(stored).toContain("http://127.0.0.1:4173");expect(stored).toContain("a".repeat(64));const precache=await request.get("/precache.json");expect(precache.ok()).toBeTruthy();const paths=await precache.json() as string[];expect(paths.some(path=>path.endsWith(".map")||path.startsWith("/api/")||path.startsWith("/models/"))).toBeFalsy()});

test("a rejected deployment key is not saved",async({page})=>{await page.route("http://127.0.0.1:4173/api/v1/capabilities",route=>route.fulfill({status:401,json:{error:{code:"invalid_source"}}}));await page.goto("/settings");await page.getByLabel("Server origin").fill("http://127.0.0.1:4173");await page.getByLabel("Deployment key").fill("random-key");await page.getByRole("button",{name:"Save and test"}).click();await expect(page.getByText(/Deployment key rejected/)).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem("atarang.cloud.configuration"))).toBeNull()});

test("Signalsmith worklet loads from its same-origin runtime module",async({page})=>{const cspErrors:string[]=[];page.on("console",message=>{if(message.type()==="error"&&message.text().includes("Content Security Policy"))cspErrors.push(message.text())});await page.goto("/studio");await page.getByRole("button",{name:"Play",exact:true}).click();const result=await page.evaluate(async()=>{const paths=await fetch("/precache.json").then(response=>response.json()) as string[];const moduleUrl=paths.find(path=>path.includes("SignalsmithStretch"));if(!moduleUrl)return"missing";const module=await import(moduleUrl);module.default.moduleUrl=moduleUrl;const context=new AudioContext();const node=await module.default(context,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});node.disconnect();await context.close();return"loaded"});expect(result).toBe("loaded");expect(cspErrors).toEqual([])});

test("originals expose an explicit separation action that opens the chooser",async({page})=>{const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));await page.goto("/library");await page.getByLabel("Choose audio to import").setInputFiles({name:"route-check.wav",mimeType:"audio/wav",buffer:silentWav()});await expect(page).toHaveURL(/\/studio\//);await page.getByRole("link",{name:"Library"}).click();const separate=page.getByRole("link",{name:"Separate",exact:true});await expect(separate).toBeVisible();await separate.click();const dialog=page.getByRole("dialog",{name:"Separate this song"});await expect(dialog).toBeVisible();await expect(dialog.getByText("Local on this device")).toBeVisible();await expect(dialog.getByRole("button",{name:"Model not installed"})).toBeDisabled();await expect(dialog.getByText("Audio is never uploaded automatically.")).toBeVisible();await expect(dialog.getByRole("button",{name:"Import package"})).toBeEnabled();expect(errors).toEqual([])});

test("an installed WebGPU model works without a benchmark and reports inference failure persistently",async({page})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/models/htdemucs-web-onnx/manifest.json",route=>route.fulfill({json:browserModelManifest}));
  await page.addInitScript(()=>{
    const NativeWorker=Worker;
    class QualificationWorker {
      onmessage:((event:MessageEvent)=>void)|null=null;
      onerror:((event:ErrorEvent)=>void)|null=null;
      name="";
      constructor(url:string|URL,options?:WorkerOptions){
        this.name=options?.name??"";
        if(!["atarang-capability-probe","atarang-local-support-probe","atarang-local-separation"].includes(this.name))return new NativeWorker(url,options) as unknown as QualificationWorker;
      }
      postMessage(message:{type:string;requestId:string}){
        if(message.type==="model/cancel")return;
        if(this.name==="atarang-local-support-probe"){setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"capability/result",requestId:message.requestId,backend:"webgpu",status:"candidate",reason:"model_correctness_probe_required"}})),10);return}
        if(this.name==="atarang-local-separation"){setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"separation/progress",requestId:message.requestId,stage:"loading_model",progress:.04}})),10);setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"separation/error",requestId:message.requestId,code:"local_capability_failed"}})),40);return}
        setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"capability/progress",requestId:message.requestId,progress:.42}})),50);
        setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"capability/result",requestId:message.requestId,backend:"webgpu",status:"qualified",reason:"qualified",adapterVendor:"test",adapterArchitecture:"test",driverDescription:"test",correctnessPassed:true,rtf:.75,peakMemoryBytes:1}})),3_000);
      }
      terminate(){}
    }
    Object.defineProperty(globalThis,"Worker",{value:QualificationWorker,configurable:true});
  });
  await page.goto("/settings");
  await page.evaluate(async(manifest)=>{
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}});
  },browserModelManifest);
  await page.reload();
  await expect(page.getByText("Ready · not benchmarked")).toBeVisible();
  await expect(page.getByText(/installed and enabled/)).toBeVisible();
  await page.getByRole("button",{name:"Test performance (optional)"}).click();
  await expect(page.getByText(/Running optional performance test… 42%/)).toBeVisible();
  await page.getByRole("link",{name:"Library"}).click();
  await expect(page.getByRole("heading",{name:"Library"})).toBeVisible();
  await page.getByRole("navigation",{name:"Primary navigation"}).getByRole("link",{name:"Settings"}).click();
  await expect(page.getByText(/Running optional performance test… 42%/)).toBeVisible();
  await expect(page.getByText("Ready · RTF 0.75")).toBeVisible();
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"unbenchmarked.wav",mimeType:"audio/wav",buffer:silentWav()});
  await page.getByRole("button",{name:"Separate song"}).click();
  const dialog=page.getByRole("dialog",{name:"Separate this song"});
  await expect(dialog.getByRole("button",{name:"Start local"})).toBeEnabled();
  await dialog.getByRole("button",{name:"Start local"}).click();
  await expect(dialog.getByRole("alert")).toContainText("WebGPU inference failed");
  await dialog.getByRole("button",{name:"Close separation options"}).click();
  await expect(page.getByRole("alert")).toContainText("WebGPU inference failed");
  expect(errors).toEqual([]);
});

test("a running model test blocks concurrent separation and can be cancelled",async({page})=>{
  await page.route("**/models/htdemucs-web-onnx/manifest.json",route=>route.fulfill({json:browserModelManifest}));
  await page.addInitScript(()=>{const NativeWorker=Worker;class StalledQualificationWorker{onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;name="";constructor(url:string|URL,options?:WorkerOptions){this.name=options?.name??"";if(!["atarang-capability-probe","atarang-local-support-probe"].includes(this.name))return new NativeWorker(url,options) as unknown as StalledQualificationWorker}postMessage(message:{type:string;requestId:string}){if(this.name==="atarang-local-support-probe")setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"capability/result",requestId:message.requestId,backend:"webgpu",status:"candidate",reason:"model_correctness_probe_required"}})),10)}terminate(){}}Object.defineProperty(globalThis,"Worker",{value:StalledQualificationWorker,configurable:true})});
  await page.goto("/settings");
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.reload();
  await page.getByRole("button",{name:"Test performance (optional)"}).click();
  await expect(page.getByText(/Running optional performance test/)).toBeVisible();
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"busy-model.wav",mimeType:"audio/wav",buffer:silentWav()});
  await expect(page.getByRole("slider",{name:"Song waveform. Click or drag to seek"})).toBeVisible();
  await page.getByRole("button",{name:"Separate song"}).click();
  const dialog=page.getByRole("dialog",{name:"Separate this song"});
  await expect(dialog.getByRole("button",{name:"Start local"})).toBeEnabled();
  await dialog.getByRole("button",{name:"Start local"}).click();
  await expect(dialog.getByRole("alert")).toContainText("model test or separation is already running");
  await dialog.getByRole("button",{name:"Close separation options"}).click();
  await page.getByRole("navigation",{name:"Primary navigation"}).getByRole("link",{name:"Settings"}).click();
  await page.getByRole("button",{name:"Cancel test"}).click();
  await expect(page.getByRole("button",{name:"Test performance (optional)"})).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("Cancelled");
});

// A machine with no WebGPU adapter is the only local path Safari and Firefox
// have, so it has to stay open — and say what it costs.
test("browser separation falls back to the processor when there is no WebGPU adapter",async({page})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{const NativeWorker=Worker;class SupportWorker{onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;constructor(url:string|URL,options?:WorkerOptions){if(options?.name!=="atarang-local-support-probe")return new NativeWorker(url,options) as unknown as SupportWorker}postMessage(message:{requestId:string}){setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"capability/result",requestId:message.requestId,backend:"wasm",reason:"cpu_fallback_available"}})),10)}terminate(){}}Object.defineProperty(globalThis,"Worker",{value:SupportWorker,configurable:true})});
  await page.route("**/models/htdemucs-web-onnx/manifest.json",route=>route.fulfill({json:browserModelManifest}));
  await page.goto("/settings");
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"cpu-fallback.wav",mimeType:"audio/wav",buffer:silentWav()});
  await page.getByRole("button",{name:"Separate song"}).click();
  const dialog=page.getByRole("dialog",{name:"Separate this song"});
  await expect(dialog.getByRole("button",{name:"Start local"})).toBeEnabled();
  await expect(dialog.getByText(/runs on the processor/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("browser separation stays disabled when the quick WebGPU probe fails",async({page})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{const NativeWorker=Worker;class SupportWorker{onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;constructor(url:string|URL,options?:WorkerOptions){if(options?.name!=="atarang-local-support-probe")return new NativeWorker(url,options) as unknown as SupportWorker}postMessage(){setTimeout(()=>this.onerror?.(new ErrorEvent("error")),10)}terminate(){}}Object.defineProperty(globalThis,"Worker",{value:SupportWorker,configurable:true})});
  await page.route("**/models/htdemucs-web-onnx/manifest.json",route=>route.fulfill({json:browserModelManifest}));
  await page.goto("/settings");
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"unsupported-webgpu.wav",mimeType:"audio/wav",buffer:silentWav()});
  await page.getByRole("button",{name:"Separate song"}).click();
  const dialog=page.getByRole("dialog",{name:"Separate this song"});
  await expect(dialog.getByRole("button",{name:"Unavailable here"})).toBeDisabled();
  await expect(dialog.getByText(/could not check WebGPU availability/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a stalled storage preflight times out with a persistent explanation",async({page})=>{
  await page.route("**/models/htdemucs-web-onnx/manifest.json",route=>route.fulfill({json:browserModelManifest}));
  await page.addInitScript(()=>{const NativeWorker=Worker;class SupportWorker{onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;constructor(url:string|URL,options?:WorkerOptions){if(options?.name!=="atarang-local-support-probe")return new NativeWorker(url,options) as unknown as SupportWorker}postMessage(message:{requestId:string}){setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"capability/result",requestId:message.requestId,backend:"webgpu",status:"candidate",reason:"model_correctness_probe_required"}})),10)}terminate(){}}Object.defineProperty(globalThis,"Worker",{value:SupportWorker,configurable:true})});
  await page.goto("/settings");
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"stalled-preflight.wav",mimeType:"audio/wav",buffer:silentWav()});
  // The analysis pass holds this song's mutation lease while it runs, which is
  // what a user waits out by looking at the waveform appear.
  await expect(page.getByRole("slider",{name:"Song waveform. Click or drag to seek"})).toBeVisible();
  await page.evaluate(()=>Object.defineProperty(navigator.storage,"estimate",{value:()=>new Promise(()=>{}),configurable:true}));
  await page.getByRole("button",{name:"Separate song"}).click();
  const dialog=page.getByRole("dialog",{name:"Separate this song"});
  await dialog.getByRole("button",{name:"Start local"}).click();
  // Either the preflight is still running or it has already given up; racing the
  // ten-second timeout for the intermediate state is not what this test is about.
  await expect.poll(async()=>await dialog.getByRole("status").isVisible()||await dialog.getByRole("alert").isVisible()).toBe(true);
  await expect(dialog.getByRole("alert")).toContainText("storage check did not respond",{timeout:15_000});
  await dialog.getByRole("button",{name:"Close separation options"}).click();
  await expect(page.getByRole("alert")).toContainText("storage check did not respond");
});

test("saved separated songs enable independent stem controls",async({page,isMobile})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  const originalId="019fef4f-9c77-7a3f-94ca-ef4214a806d1",staleOriginalId="019fef4f-9c77-7a3f-94ca-ef4214a806d0",separationId="019fef4f-9c77-7a3f-94ca-ef4214a806d2",sha="a".repeat(64),now="2026-08-11T00:00:00.000Z";
  await page.goto("/");
  await page.evaluate(async({originalId,staleOriginalId,separationId,sha,now})=>{
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction(["originals","separations"],"readwrite"),original={id:originalId,schemaVersion:1,createdAt:now,updatedAt:now,title:"Separated fixture",artist:"Test",sourceFileName:"fixture.wav",sourceMediaType:"audio/wav",byteLength:44,durationUs:1_000_000,contentSha256:sha,blobId:`sha256:${sha}`},stems=["vocals","drums","bass","other"].map(kind=>({kind,blobId:`sha256:${sha}`,sampleRate:44_100,channels:2,durationFrames:44_100,variants:[{encoding:"pcm-f32le-wav",mediaType:"audio/wav",byteLength:44,sha256:sha}]})),manifest={schema:"atarang.separation/1",separationId,original:{originalId:staleOriginalId,contentSha256:sha,sourceMediaType:"audio/wav",sampleRate:44_100,channels:2,durationFrames:44_100},model:{modelId:"htdemucs-4stem",artifactVersion:"test",artifactSha256:sha,upstream:"facebookresearch/demucs htdemucs",license:"MIT"},pipeline:{implementation:"server-pytorch",implementationVersion:"test",decodeVersion:"test",preprocessVersion:"test",segmentFrames:343_980,overlapFrames:85_995,shifts:1,postprocessVersion:"test"},stems,provenance:{mode:"local",createdAt:now}};transaction.objectStore("originals").put(original);transaction.objectStore("separations").put({id:separationId,originalId:staleOriginalId,schemaVersion:1,createdAt:now,updatedAt:now,manifest,bindings:Object.fromEntries(stems.map(stem=>[stem.kind,stem.blobId]))});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}});
  },{originalId,staleOriginalId,separationId,sha,now});
  expect(await page.evaluate(async()=>new Promise<number>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const get=request.result.transaction("separations").objectStore("separations").getAll();get.onsuccess=()=>resolve(get.result.length);get.onerror=()=>reject(get.error)}}))).toBe(1);
  // Stems the browser has evicted are not offered, so the fixture has to put a
  // real file in OPFS and a blob record pointing at it, exactly like an import —
  // decodable audio at its recorded byte length, or the integrity scan
  // quarantines it and playback complains into the console.
  expect(await page.evaluate(async({sha,bytes})=>{
    const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle("blobs",{create:true}),handle=await directory.getFileHandle(`${sha}.wav`,{create:true});
    const writable=await handle.createWritable();await writable.write(new Uint8Array(bytes));await writable.close();
    return new Promise<boolean>((resolve,reject)=>{const request=indexedDB.open("atarang",10);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("blobs","readwrite"),now=new Date().toISOString();transaction.objectStore("blobs").put({id:`sha256:${sha}`,schemaVersion:1,createdAt:now,updatedAt:now,sha256:sha,byteLength:bytes.length,mediaType:"audio/wav",opfsPath:`blobs/${sha}.wav`,referenceCount:4});transaction.oncomplete=()=>{db.close();resolve(true)};transaction.onerror=()=>reject(transaction.error)}});
  },{sha,bytes:[...silentWav()]})).toBe(true);
  await page.goto("/library");
  await page.getByRole("button",{name:"Separated 1"}).click();
  await expect(page.getByText("Separated fixture",{exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Open"}).click();
  // Below 1024px the three panels live behind a switcher, and the mixer is not the one on screen.
  if(isMobile)await page.getByRole("button",{name:"Mix",exact:true}).click();
  const vocals=page.getByRole("slider",{name:/Vocals level/});
  await expect(page.getByRole("complementary",{name:"Four stem mixer"})).toBeVisible();
  await expect(vocals).toBeEnabled();
  await vocals.focus();
  await page.keyboard.press("ArrowDown");
  await expect(vocals).toHaveValue("-0.5");
  await expect(page.getByRole("slider",{name:/Master level/})).toHaveValue("0");
  await page.getByRole("link",{name:"Library"}).click();
  await expect(page.getByRole("link",{name:"Separate again"})).toBeVisible();
  await page.getByRole("link",{name:"Separate again"}).click();
  await expect(page.getByRole("dialog",{name:"Separate this song again"})).toBeVisible();
  expect(errors).toEqual([]);
});

test("the studio keeps the view you set when you leave and come back",async({page,isMobile})=>{
  await page.goto("/studio");
  const transport=page.getByRole("region",{name:"Waveform and transport"});
  await page.getByRole("button",{name:"Zoom in"}).click();
  await page.getByRole("button",{name:"Zoom in"}).click();
  await expect(transport).toHaveAttribute("data-zoom","4");
  await page.getByRole("tab",{name:"Chords"}).click();
  if(isMobile)await page.getByRole("button",{name:"Practice",exact:true}).click();
  await page.getByRole("link",{name:"Library"}).click();
  await expect(page.getByRole("heading",{name:"Library"})).toBeVisible();
  await page.getByRole("navigation",{name:"Primary navigation"}).getByRole("link",{name:"Studio"}).click();
  await expect(transport).toHaveAttribute("data-zoom","4");
  // The compact layout hides the tab strip behind the pane it left on, which is
  // itself the thing being checked.
  if(isMobile){await expect(page.getByRole("button",{name:"Practice",exact:true})).toHaveAttribute("aria-pressed","true");await page.getByRole("button",{name:"Song",exact:true}).click()}
  await expect(page.getByRole("tab",{name:"Chords"})).toHaveAttribute("aria-selected","true");
});

test("the Library category is in the URL, so Back returns to the list you were reading",async({page})=>{
  await page.goto("/library");
  await page.getByRole("button",{name:/^Performances/}).click();
  await expect(page).toHaveURL(/category=performances/);
  await expect(page.getByText("No performances yet")).toBeVisible();
  await page.getByRole("navigation",{name:"Primary navigation"}).getByRole("link",{name:"Studio"}).click();
  await expect(page).toHaveURL(/\/studio/);
  await page.goBack();
  await expect(page).toHaveURL(/category=performances/);
  await expect(page.getByText("No performances yet")).toBeVisible();
});

test("playback survives leaving the Studio, and says what is playing",async({page})=>{
  await page.goto("/studio");
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect(page.getByRole("button",{name:"Pause",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("link",{name:"Library"}).click();
  await expect(page.getByRole("heading",{name:"Library"})).toBeVisible();
  const bar=page.getByRole("region",{name:"Now playing"});
  await expect(bar.getByText("Backbeat")).toBeVisible();
  await expect(bar.getByRole("button",{name:"Pause",exact:true})).toBeVisible();
  const seek=bar.getByLabel("Seek");
  const before=Number(await seek.inputValue());
  await expect.poll(async()=>Number(await seek.inputValue()),{timeout:5_000}).toBeGreaterThan(before);
  // And the same session is still there on the way back — one player, not two.
  await page.getByRole("navigation",{name:"Primary navigation"}).getByRole("link",{name:"Studio"}).click();
  await expect(page.getByRole("button",{name:"Pause",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("region",{name:"Now playing"})).toBeHidden();
});

test("dragging the ruler above the waveform sets the A–B loop",async({page,isMobile})=>{
  await page.goto("/studio");
  const lane=page.locator('[title^="Drag to set the A–B loop"]'),box=(await lane.boundingBox())!;
  const y=box.y+box.height/2;
  // Right to left, because that is the direction that used to fight the minimum length.
  await page.mouse.move(box.x+box.width*.6,y);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.25,y,{steps:8});
  await page.mouse.up();
  await expect(page.getByRole("button",{name:"Clear loop"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Disable loop"})).toHaveAttribute("aria-pressed","true");
  if(isMobile)await page.getByRole("button",{name:"Practice",exact:true}).click();
  // The demo runs 46 seconds, so a quarter to three fifths of it is about 11.5 to 27.6.
  const seconds=async(name:string)=>{const text=await page.getByRole("button",{name}).innerText();const[minutes,rest]=text.split("\n").at(-1)!.split(":");return Number(minutes)*60+Number(rest)};
  expect(await seconds("Set loop start at playhead")).toBeCloseTo(11.5,0);
  expect(await seconds("Set loop end at playhead")).toBeCloseTo(27.6,0);
});
