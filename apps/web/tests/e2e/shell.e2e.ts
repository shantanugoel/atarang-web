import{expect,test}from"@playwright/test";
import{readFileSync}from"node:fs";

const browserModelManifest=JSON.parse(readFileSync(new URL("../../../../models/web/manifest.json",import.meta.url),"utf8"));

function silentWav(frames=4_410){const buffer=Buffer.alloc(44+frames*4),view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength),text=(offset:number,value:string)=>buffer.write(value,offset,"ascii");text(0,"RIFF");view.setUint32(4,36+frames*4,true);text(8,"WAVE");text(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,44_100,true);view.setUint32(28,176_400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,frames*4,true);return buffer}
function constantWav(sample:number,frames=44_100){const buffer=silentWav(frames);for(let offset=44;offset<buffer.length;offset+=2)buffer.writeInt16LE(sample,offset);return buffer}

test("production shell is isolated and the bundled demo really plays",async({page,request})=>{const response=await request.get("/");expect(response.ok()).toBeTruthy();expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));await page.goto("/studio");await expect(page.getByRole("link",{name:"Atarang Studio home"})).toBeVisible();await expect(page.getByRole("navigation",{name:"Primary navigation"})).toBeVisible();await expect(page.getByText("Backbeat",{exact:true})).toBeVisible();const transport=page.getByRole("region",{name:"Waveform and transport"});const before=Number(await transport.getAttribute("data-source-time-us"));await page.keyboard.press("Space");await expect(page.getByRole("button",{name:"Pause",exact:true})).toHaveAttribute("aria-pressed","true");await expect.poll(async()=>Number(await transport.getAttribute("data-source-time-us")),{timeout:5_000}).toBeGreaterThan(before+250_000);await page.keyboard.press("Space");await expect(page.getByRole("button",{name:"Play",exact:true})).toHaveAttribute("aria-pressed","false");expect(errors).toEqual([])});

test("authorized YouTube acquisition exposes server and browser separation choices",async({page,isMobile})=>{let suppliedKey="";await page.addInitScript(()=>sessionStorage.setItem("atarang.cloud.configuration",JSON.stringify({origin:"http://127.0.0.1:4173",deploymentKey:"a".repeat(64)})));await page.route("http://127.0.0.1:4173/api/v1/capabilities",async route=>{suppliedKey=await route.request().headerValue("X-Atarang-Key")??"";await route.fulfill({json:{cloudEnabled:true,youtubeEnabled:true}})});await page.goto("/library");const local=page.getByRole("region",{name:"Import local audio"}),youtube=page.getByRole("region",{name:"Fetch from YouTube"}),localAction=local.getByRole("button",{name:"Choose audio",exact:true}),submit=youtube.getByRole("button",{name:"Fetch and separate"});await expect(local).toBeVisible();await expect(youtube).toBeVisible();await expect(localAction).toBeVisible();const[localBox,youtubeBox,localHeading,youtubeHeading]=await Promise.all([local.boundingBox(),youtube.boundingBox(),local.getByRole("heading").boundingBox(),youtube.getByRole("heading").boundingBox()]);expect(Math.round(localBox!.width)).toBe(Math.round(youtubeBox!.width));expect(Math.round(localHeading!.x-localBox!.x)).toBe(Math.round(youtubeHeading!.x-youtubeBox!.x));if(isMobile)expect(youtubeBox!.y).toBeGreaterThan(localBox!.y+localBox!.height);else expect(Math.round(youtubeBox!.y)).toBe(Math.round(localBox!.y));await expect(page.getByLabel("YouTube URL")).toBeVisible();expect(await localAction.evaluate(element=>getComputedStyle(element).backgroundColor)).toBe(await submit.evaluate(element=>getComputedStyle(element).backgroundColor));await page.getByLabel("YouTube URL").fill("https://www.youtube.com/watch?v=Ajxn0PKbv7I");await expect(submit).toBeDisabled();await page.getByLabel("I confirm I am authorized to download and process this content.").check();await expect(submit).toBeEnabled();await page.getByLabel(/Fetch only; separate in this browser/).check();await expect(page.getByRole("button",{name:"Fetch to browser"})).toBeEnabled();expect(suppliedKey).toBe("a".repeat(64))});

test("YouTube submission works when randomUUID is unavailable on an HTTP origin",async({page})=>{let idempotencyKey="";await page.addInitScript(()=>{Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});sessionStorage.setItem("atarang.cloud.configuration",JSON.stringify({origin:"http://127.0.0.1:4173",deploymentKey:"a".repeat(64)}))});await page.route("http://127.0.0.1:4173/api/v1/capabilities",route=>route.fulfill({json:{cloudEnabled:true,youtubeEnabled:true}}));await page.route("http://127.0.0.1:4173/api/v1/jobs",async route=>{idempotencyKey=await route.request().headerValue("Idempotency-Key")??"";await route.fulfill({json:{jobId:"019fef4f-9c77-7a3f-94ca-ef4214a806c1",capabilityToken:"canary-capability",state:"acquiring_youtube"}})});await page.route("http://127.0.0.1:4173/api/v1/jobs/019fef4f-9c77-7a3f-94ca-ef4214a806c1",route=>route.fulfill({json:{state:"failed",stage:"failed",progress:.1}}));await page.goto("/library");await page.getByLabel("YouTube URL").fill("https://www.youtube.com/watch?v=Ajxn0PKbv7I");await page.getByLabel("I confirm I am authorized to download and process this content.").check();await page.getByRole("button",{name:"Fetch and separate"}).click();await expect(page.getByRole("alert")).toContainText("The server could not finish this job");expect(idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)});

test("supported compact layout has no horizontal overflow and keeps transport visible",async({page,isMobile})=>{test.skip(!isMobile,"compact layout project only");await page.goto("/studio");const layout=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,transport:document.querySelector('[aria-label="Waveform and transport"]')?.getBoundingClientRect().bottom}));expect(layout.scrollWidth).toBe(layout.viewport);expect(layout.transport).toBeLessThanOrEqual(await page.evaluate(()=>innerHeight));await expect(page.getByRole("tab",{name:"Takes"})).toBeVisible()});

test("page titles identify the route and current song",async({page})=>{await page.goto("/library/");await expect(page).toHaveTitle("Library — Atarang");const navigation=page.getByRole("navigation",{name:"Primary navigation"});await navigation.getByRole("link",{name:"Settings"}).click();await expect(page).toHaveTitle("Settings — Atarang");await page.goto("/studio/");await expect(page).toHaveTitle("Backbeat — Atarang");await page.goBack();await expect(page).toHaveTitle("Settings — Atarang");await page.goto("/studio/019ffc79-67f3-760d-bc42-cc3cc125eae9");await expect(page).toHaveTitle("Song not found — Atarang");await page.goto("/studio/song/extra");await expect(page).toHaveTitle("Page not found — Atarang")});

test("changing Library category clears its search",async({page})=>{await page.goto("/library");const search=page.getByRole("textbox",{name:"Search library"});await search.fill("does-not-match");await expect(page.getByText("No matching songs")).toBeVisible();await page.getByRole("button",{name:/^Separated/}).click();await expect(search).toHaveValue("");await expect(search).toHaveAttribute("placeholder","Search separated");await page.getByRole("button",{name:/^Originals/}).click();await expect(page.getByText(/^Backbeat/)).toBeVisible()});

test("chord and settings controls reflow at 320 CSS pixels",async({page,isMobile})=>{test.skip(isMobile,"one 320px reflow pass is enough");await page.setViewportSize({width:320,height:800});await page.goto("/library");await page.getByLabel("Choose audio to import").setInputFiles({name:"reflow.wav",mimeType:"audio/wav",buffer:silentWav()});await page.getByRole("button",{name:"Skip for now and just play the song"}).click();await page.getByRole("tab",{name:"Chords"}).click();await page.getByRole("button",{name:"Paste chart"}).click();await page.getByLabel("Paste ChordPro chart").fill("{title: Reflow}\n[Am]One [F]two");await page.getByRole("button",{name:"Add chart"}).click();for(const name of["Transpose down","Transpose up","Simplify","Decrease capo","Increase capo","Edit","Import","Export","Remove selected chart"]){const control=page.getByRole("button",{name,exact:true});await expect(control).toBeVisible();expect(await control.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth})).toBe(true)}expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);await page.goto("/settings");await expect(page.getByText("The built-in model is ready for an explicit, verified download.")).toBeVisible();const picker=page.getByLabel("Settings section",{exact:true});await expect(picker).toBeInViewport();await expect(picker).toHaveValue("#storage");await page.goto("/settings#privacy");await expect(picker).toHaveValue("#privacy");for(const control of[page.getByRole("button",{name:"Refresh usage"}),page.getByRole("button",{name:"Backup library"}),page.getByRole("button",{name:"Restore backup"}),page.getByLabel("Chord symbol"),page.getByRole("button",{name:"Save voicing"}),page.getByRole("button",{name:/Download browser model/}),page.getByText("Advanced model package",{exact:true}),page.getByLabel("Server origin"),page.getByLabel("Deployment key"),page.getByRole("button",{name:"Save and test"}),page.getByRole("button",{name:"Clear session"})])await expect(control).toBeVisible();const selects=await page.getByRole("combobox").all();expect(selects).toHaveLength(8);for(const select of selects)await expect(select).toBeVisible();for(const value of["#storage","#audio","#chords","#models","#privacy"]){await picker.selectOption(value);await expect(page).toHaveURL(new RegExp(`${value}$`));expect(await page.locator(value).evaluate(element=>{const box=element.getBoundingClientRect();return box.top>=-1&&box.top<innerHeight})).toBe(true)}await picker.selectOption("#models");await page.goBack();await expect(picker).toHaveValue("#privacy");const routerState=await page.evaluate(()=>history.state);await page.evaluate(()=>{location.hash="#missing"});await expect(page).toHaveURL(/#storage$/);await expect(picker).toHaveValue("#storage");expect(await page.evaluate(()=>history.state)).toEqual(routerState);expect(await page.locator("#storage").evaluate(element=>{const box=element.getBoundingClientRect();return box.top>=-1&&box.top<innerHeight})).toBe(true);expect(await page.evaluate(()=>({width:document.documentElement.scrollWidth,clipped:[...document.querySelectorAll<HTMLElement>('main button,main input,main select,main summary')].filter(element=>element.offsetParent!==null&&!element.closest('nav')).some(element=>{const box=element.getBoundingClientRect();return box.left<0||box.right>innerWidth})}))).toEqual({width:320,clipped:false})});

test("a Settings deep link opens its section",async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto("/settings#privacy");await expect(page.getByLabel("Settings section",{exact:true})).toHaveValue("#privacy");await expect(page.getByRole("heading",{name:"Cloud processing"})).toBeInViewport()});

test("cloud operator configuration is session-only and precache excludes private routes",async({page,request})=>{await page.route("http://127.0.0.1:4173/api/v1/capabilities",route=>route.fulfill({json:{cloudEnabled:true}}));await page.goto("/settings");await page.getByLabel("Server origin").fill("http://127.0.0.1:4173/path");await page.getByLabel("Deployment key").fill("a".repeat(64));await page.getByRole("button",{name:"Save and test"}).click();await expect(page.getByText("Server capability verified for this session.")).toBeVisible();const stored=await page.evaluate(()=>sessionStorage.getItem("atarang.cloud.configuration"));expect(stored).toContain("http://127.0.0.1:4173");expect(stored).toContain("a".repeat(64));const precache=await request.get("/precache.json");expect(precache.ok()).toBeTruthy();const paths=await precache.json() as string[];expect(paths.some(path=>path.endsWith(".map")||path.startsWith("/api/")||path.startsWith("/models/"))).toBeFalsy()});

test("a rejected deployment key is not saved",async({page})=>{await page.route("http://127.0.0.1:4173/api/v1/capabilities",route=>route.fulfill({status:401,json:{error:{code:"invalid_source"}}}));await page.goto("/settings");await page.getByLabel("Server origin").fill("http://127.0.0.1:4173");await page.getByLabel("Deployment key").fill("random-key");await page.getByRole("button",{name:"Save and test"}).click();await expect(page.getByText(/deployment key was rejected/i)).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem("atarang.cloud.configuration"))).toBeNull()});

test("Signalsmith worklet loads from its same-origin runtime module",async({page})=>{const cspErrors:string[]=[];page.on("console",message=>{if(message.type()==="error"&&message.text().includes("Content Security Policy"))cspErrors.push(message.text())});await page.goto("/studio");await page.getByRole("button",{name:"Play",exact:true}).click();const result=await page.evaluate(async()=>{const paths=await fetch("/precache.json").then(response=>response.json()) as string[];const moduleUrl=paths.find(path=>path.includes("SignalsmithStretch"));if(!moduleUrl)return"missing";const module=await import(moduleUrl);module.default.moduleUrl=moduleUrl;const context=new AudioContext();const node=await module.default(context,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});node.disconnect();await context.close();return"loaded"});expect(result).toBe("loaded");expect(cspErrors).toEqual([])});

test("originals expose an explicit separation action that opens the chooser",async({page})=>{const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));await page.goto("/library");const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:"Choose audio",exact:true}).click();await(await chooser).setFiles({name:"route-check.wav",mimeType:"audio/wav",buffer:silentWav()});await expect(page).toHaveURL(/\/studio\//);await page.getByRole("button",{name:"Skip for now and just play the song"}).click();await expect(page).toHaveTitle("Route Check — Atarang");await page.getByRole("link",{name:"Library"}).click();const separate=page.getByRole("link",{name:"Separate",exact:true});await expect(separate).toBeVisible();await separate.click();const dialog=page.getByRole("dialog",{name:"Separate this song"});await expect(dialog).toBeVisible();await expect(dialog.getByText("Local on this device")).toBeVisible();await expect(dialog.getByRole("button",{name:"Model not installed"})).toBeDisabled();await expect(dialog.getByText("Audio is never uploaded automatically.")).toBeVisible();await expect(dialog.getByRole("button",{name:"Import package"})).toBeEnabled();expect(errors).toEqual([])});

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
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}});
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
  await expect(page.getByRole("slider",{name:"Song waveform. Click or drag to seek"})).toBeVisible();
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
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.reload();
  await page.getByRole("button",{name:"Test performance (optional)"}).click();
  await expect(page.getByText(/Running optional performance test/)).toBeVisible();
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"busy-model.wav",mimeType:"audio/wav",buffer:silentWav()});
  await expect(page.getByRole("slider",{name:"Song waveform. Click or drag to seek"})).toBeVisible();
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
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"cpu-fallback.wav",mimeType:"audio/wav",buffer:silentWav()});
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
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"unsupported-webgpu.wav",mimeType:"audio/wav",buffer:silentWav()});
  const dialog=page.getByRole("dialog",{name:"Separate this song"});
  await expect(dialog.getByRole("button",{name:"Unavailable here"})).toBeDisabled();
  await expect(dialog.getByText(/could not check WebGPU availability/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a stalled storage preflight times out with a persistent explanation",async({page})=>{
  await page.route("**/models/htdemucs-web-onnx/manifest.json",route=>route.fulfill({json:browserModelManifest}));
  await page.addInitScript(()=>{const NativeWorker=Worker;class SupportWorker{onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;constructor(url:string|URL,options?:WorkerOptions){if(options?.name!=="atarang-local-support-probe")return new NativeWorker(url,options) as unknown as SupportWorker}postMessage(message:{requestId:string}){setTimeout(()=>this.onmessage?.(new MessageEvent("message",{data:{type:"capability/result",requestId:message.requestId,backend:"webgpu",status:"candidate",reason:"model_correctness_probe_required"}})),10)}terminate(){}}Object.defineProperty(globalThis,"Worker",{value:SupportWorker,configurable:true})});
  await page.goto("/settings");
  await page.evaluate(async(manifest)=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("models","readwrite");transaction.objectStore("models").put({id:manifest.modelArtifactId,schemaVersion:1,createdAt:manifest.createdAt,updatedAt:new Date().toISOString(),status:"ready",manifest,bindings:{}});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},browserModelManifest);
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"stalled-preflight.wav",mimeType:"audio/wav",buffer:silentWav()});
  // The analysis pass holds this song's mutation lease while it runs, which is
  // what a user waits out by looking at the waveform appear.
  await expect(page.getByRole("slider",{name:"Song waveform. Click or drag to seek"})).toBeVisible();
  await page.evaluate(()=>Object.defineProperty(navigator.storage,"estimate",{value:()=>new Promise(()=>{}),configurable:true}));
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
  await page.addInitScript(()=>{const nodes:StereoPannerNode[]=[];Object.defineProperty(window,"__atarangPanners",{value:nodes});const create=AudioContext.prototype.createStereoPanner;AudioContext.prototype.createStereoPanner=function(){const node=create.call(this);nodes.push(node);return node}});
  await page.goto("/");
  await page.evaluate(async({originalId,staleOriginalId,separationId,sha,now})=>{
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction(["originals","separations"],"readwrite"),original={id:originalId,schemaVersion:1,createdAt:now,updatedAt:now,title:"Separated fixture",artist:"Test",sourceFileName:"fixture.wav",sourceMediaType:"audio/wav",byteLength:44,durationUs:1_000_000,contentSha256:sha,blobId:`sha256:${sha}`},stems=["vocals","drums","bass","other"].map(kind=>({kind,blobId:`sha256:${sha}`,sampleRate:44_100,channels:2,durationFrames:44_100,variants:[{encoding:"pcm-f32le-wav",mediaType:"audio/wav",byteLength:44,sha256:sha}]})),manifest={schema:"atarang.separation/1",separationId,original:{originalId:staleOriginalId,contentSha256:sha,sourceMediaType:"audio/wav",sampleRate:44_100,channels:2,durationFrames:44_100},model:{modelId:"htdemucs-4stem",artifactVersion:"test",artifactSha256:sha,upstream:"facebookresearch/demucs htdemucs",license:"MIT"},pipeline:{implementation:"server-pytorch",implementationVersion:"test",decodeVersion:"test",preprocessVersion:"test",segmentFrames:343_980,overlapFrames:85_995,shifts:1,postprocessVersion:"test"},stems,provenance:{mode:"local",createdAt:now}};transaction.objectStore("originals").put(original);transaction.objectStore("separations").put({id:separationId,originalId:staleOriginalId,schemaVersion:1,createdAt:now,updatedAt:now,manifest,bindings:Object.fromEntries(stems.map(stem=>[stem.kind,stem.blobId]))});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}});
  },{originalId,staleOriginalId,separationId,sha,now});
  expect(await page.evaluate(async()=>new Promise<number>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const get=request.result.transaction("separations").objectStore("separations").getAll();get.onsuccess=()=>resolve(get.result.length);get.onerror=()=>reject(get.error)}}))).toBe(1);
  // Stems the browser has evicted are not offered, so the fixture has to put a
  // real file in OPFS and a blob record pointing at it, exactly like an import —
  // decodable audio at its recorded byte length, or the integrity scan
  // quarantines it and playback complains into the console.
  expect(await page.evaluate(async({sha,bytes})=>{
    const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle("blobs",{create:true}),handle=await directory.getFileHandle(`${sha}.wav`,{create:true});
    const writable=await handle.createWritable();await writable.write(new Uint8Array(bytes));await writable.close();
    return new Promise<boolean>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("blobs","readwrite"),now=new Date().toISOString();transaction.objectStore("blobs").put({id:`sha256:${sha}`,schemaVersion:1,createdAt:now,updatedAt:now,sha256:sha,byteLength:bytes.length,mediaType:"audio/wav",opfsPath:`blobs/${sha}.wav`,referenceCount:4});transaction.oncomplete=()=>{db.close();resolve(true)};transaction.onerror=()=>reject(transaction.error)}});
  },{sha,bytes:[...constantWav(8_000)]})).toBe(true);
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
  const vocalPan=page.getByRole("slider",{name:"Vocals pan"}),vocalMeter=page.getByRole("meter",{name:"Vocals live level"});
  await vocalPan.fill("-0.65");
  await expect(vocalPan).toHaveValue("-0.65");
  await expect.poll(()=>page.evaluate(()=>((window as unknown as {__atarangPanners:StereoPannerNode[]}).__atarangPanners[0]?.pan.value))).toBeCloseTo(-.65,2);
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect.poll(async()=>Number(await vocalMeter.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  // No `.first()`: one control per action is the point, so a second match here is a regression.
  await page.getByRole("button",{name:"Mute Vocals track",exact:true}).click();
  await expect.poll(async()=>Number(await vocalMeter.getAttribute("aria-valuenow"))).toBe(0);
  await page.getByRole("button",{name:"Pause",exact:true}).click();
  await expect(page.getByRole("slider",{name:/Master level/})).toHaveValue("0");
  await page.getByRole("link",{name:"Library"}).click();
  await expect(page.getByRole("link",{name:"Separate again"})).toBeVisible();
  await page.getByRole("link",{name:"Separate again"}).click();
  const replaceDialog=page.getByRole("dialog",{name:"Separate this song again"});
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button",{name:"Close separation options"}).click();
  if(isMobile)await page.getByRole("button",{name:"Mix",exact:true}).click();
  await expect(page.getByRole("slider",{name:"Vocals pan"})).toHaveValue("-0.65");
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByRole("button",{name:/^Separated/}).click();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Remove separation for Separated fixture"}).click();
  await expect(page.getByText("No separated songs")).toBeVisible();
  await page.getByRole("button",{name:/^Originals/}).click();
  await expect(page.getByText("Separated fixture",{exact:true})).toBeVisible();
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

test("the chord strip shows the shape being played and the one to reach next",async({page,isMobile})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/library");
  await page.getByLabel("Choose audio to import").setInputFiles("src/assets/backbeat.mp3");
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+/);
  await page.getByRole("button",{name:"Skip for now and just play the song"}).click();
  if(isMobile)await page.getByRole("button",{name:"Song",exact:true}).click();
  await page.getByRole("tab",{name:"Chords"}).click();
  const shapes=page.getByRole("group",{name:"Chord shapes"});
  // Backbeat decodes to G then D, so the pair at the playhead is unambiguous.
  await expect(shapes.getByRole("img",{name:"G guitar chord diagram"})).toBeVisible({timeout:30_000});
  await expect(shapes.getByText("Now",{exact:true})).toBeVisible();
  await expect(shapes.getByRole("img",{name:"D guitar chord diagram"})).toBeVisible();
  await expect(shapes.getByText("Next",{exact:true})).toBeVisible();
  // Past the last change there is nothing left to reach, so the pair collapses
  // to the one shape still sounding rather than inventing a chord after it.
  await page.getByRole("button",{name:"Forward 10 seconds"}).click();
  await expect(shapes.getByRole("img",{name:"D guitar chord diagram"})).toBeVisible();
  await expect(shapes.getByRole("img")).toHaveCount(1);
  await expect(shapes.getByText("Next",{exact:true})).toBeHidden();
  // Picking a chord is a lookup of one shape, not a position in the song.
  await page.getByTitle(/^G · /).click();
  await expect(shapes.getByText("Selected chord")).toBeVisible();
  await expect(shapes.getByRole("img")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a saved guitar voicing replaces the catalogue across songs",async({page,isMobile})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/settings#chords");
  await expect(page.getByRole("heading",{name:"Chord voicing library"})).toBeVisible();
  for(const[label,fret]of [["Low E fret","8"],["A fret","10"],["D fret","10"],["G fret","9"],["B fret","8"],["High E fret","8"]]as const)await page.getByLabel(label).selectOption(fret);
  await page.getByRole("button",{name:"Save voicing"}).click();
  await expect(page.getByRole("alert")).toContainText("high-position chord needs a barre fret");
  await page.getByLabel("Barre fret").selectOption("8");
  await page.getByRole("button",{name:"Save voicing"}).click();
  await expect(page.getByRole("button",{name:"Edit C voicing"})).toBeVisible();
  const downloadPromise=page.waitForEvent("download");await page.getByRole("button",{name:"Backup library"}).click();const backup=await downloadPromise,backupPath=await backup.path();expect(backupPath).toBeTruthy();
  let songUrl="";for(const name of ["voicing-one.wav","voicing-two.wav"]){
    await page.getByRole("link",{name:"Library"}).click();
    await page.getByLabel("Choose audio to import").setInputFiles({name,mimeType:"audio/wav",buffer:silentWav(44_100)});
    await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+/);
    songUrl=page.url();
    await page.getByRole("button",{name:"Skip for now and just play the song"}).click();
    if(isMobile)await page.getByRole("button",{name:"Song",exact:true}).click();
    await page.getByRole("tab",{name:"Chords"}).click();
    await page.getByRole("button",{name:"Paste chart"}).click();
    await page.getByLabel("Paste ChordPro chart").fill(`{title: ${name}}\n[C]Shared voicing`);
    await page.getByRole("button",{name:"Add chart"}).click();
    await page.getByRole("button",{name:"Show C diagram"}).click();
    await expect(page.getByText("Your voicing")).toBeVisible();
    await expect(page.getByRole("img",{name:"C guitar chord diagram"})).toBeVisible();
  }
  await page.getByRole("navigation",{name:"Primary navigation"}).getByRole("link",{name:"Settings"}).click();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Remove C voicing"}).click();
  await expect(page.getByText("No saved voicings yet.")).toBeVisible();
  await page.goto(songUrl);
  if(isMobile)await page.getByRole("button",{name:"Song",exact:true}).click();
  await page.getByRole("tab",{name:"Chords"}).click();
  await page.getByLabel("View").selectOption("chart");
  await page.getByRole("button",{name:"Show C diagram"}).click();
  await expect(page.getByText("Your voicing")).toBeHidden();
  await expect(page.getByRole("img",{name:"C guitar chord diagram"})).toBeVisible();
  await page.getByRole("navigation",{name:"Primary navigation"}).getByRole("link",{name:"Settings"}).click();
  await page.getByLabel("Choose Atarang backup").setInputFiles(backupPath!);
  await expect(page.getByRole("button",{name:"Edit C voicing"})).toBeVisible();
  expect(errors).toEqual([]);
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

test("the Library previews sources and bulk removal preserves shared media",async({page})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/library");
  await page.getByLabel("Choose audio to import").setInputFiles({name:"Library A.wav",mimeType:"audio/wav",buffer:silentWav()});
  await expect(page).toHaveURL(/\/studio\//);
  await page.getByRole("button",{name:"Skip for now and just play the song"}).click();
  await page.getByRole("link",{name:"Library"}).click();
  await page.getByLabel("Choose audio to import").setInputFiles({name:"Library B.wav",mimeType:"audio/wav",buffer:silentWav()});
  await expect(page).toHaveURL(/\/studio\//);
  await page.getByRole("button",{name:"Skip for now and just play the song"}).click();
  await page.getByRole("link",{name:"Library"}).click();
  await expect(page.getByRole("button",{name:/^Originals/})).toContainText(/KB/);
  await page.getByRole("button",{name:"Preview Library B"}).click();
  const preview=page.locator('audio[aria-label="Preview Library B"]');
  await expect(preview).toBeVisible();
  await page.getByLabel("Select Library A").check();
  await expect(page.getByRole("button",{name:"Remove selected (1)"})).toBeVisible();
  await page.getByLabel("Search library").fill("Library B");
  await expect(page.getByRole("button",{name:"Remove selected (1)"})).toBeHidden();
  await page.getByLabel("Search library").fill("");
  await page.getByLabel("Select Library A").check();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Remove selected (1)"}).click();
  await expect(page.getByText("Library A",{exact:true})).toBeHidden();
  await expect(page.getByText("Library B",{exact:true})).toBeVisible();
  await expect(preview).toBeVisible();
  expect(errors).toEqual([]);
});

test("a recorded take can be removed without a source song",async({page})=>{
  const performanceId="019fef4f-9c77-7a3f-94ca-ef4214a806e1",originalId="019fef4f-9c77-7a3f-94ca-ef4214a806e2",sha="b".repeat(64),now="2026-08-11T00:00:00.000Z";
  await page.goto("/");
  await page.evaluate(async({performanceId,originalId,sha,now})=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction("performances","readwrite"),asset={blobId:`sha256:${sha}`,sha256:sha,byteLength:100,mediaType:"audio/wav"},manifest={schema:"atarang.performance/1",performanceId,originalId,revision:0,startedAt:now,endedAt:"2026-08-11T00:00:01.000Z",sampleRate:44_100,channels:2,durationFrames:44_100,mic:asset,backing:asset,inputOffsetUs:0,edit:{trimStartUs:0,trimEndUs:1_000_000,fadeInUs:0,fadeOutUs:0},updatedAt:now};transaction.objectStore("performances").put({id:performanceId,originalId,revision:0,schemaVersion:1,createdAt:now,updatedAt:now,manifest});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}}),{performanceId,originalId,sha,now});
  await page.goto("/library?category=performances");
  await expect(page.getByText("Recorded take",{exact:true})).toBeVisible();
  await page.getByLabel("Select take from recording").check();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Remove selected (1)"}).click();
  await expect(page.getByText("No performances yet")).toBeVisible();
});

test("a take can be previewed, compared, remixed, and discarded",async({page,isMobile})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  const performanceId="019fef4f-9c77-7a3f-94ca-ef4214a806f1",micSha="c".repeat(64),backingSha="d".repeat(64),now="2026-08-11T00:00:00.000Z",mic=[...constantWav(10_000)],backing=[...constantWav(0)];
  await page.goto("/library");
  await page.getByLabel("Choose audio to import").setInputFiles({name:"take-preview.wav",mimeType:"audio/wav",buffer:silentWav(44_100)});
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+/);
  const originalId=new URL(page.url()).pathname.split("/").at(-1)!;
  await page.evaluate(async({performanceId,originalId,micSha,backingSha,now,mic,backing})=>{
    const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle("qa-takes",{create:true});
    for(const[sha,bytes]of[[micSha,mic],[backingSha,backing]]as const){const handle=await directory.getFileHandle(`${sha}.wav`,{create:true}),writable=await handle.createWritable();await writable.write(new Uint8Array(bytes));await writable.close()}
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,transaction=db.transaction(["blobs","performances"],"readwrite"),blobs=transaction.objectStore("blobs"),asset=(sha:string,byteLength:number)=>({blobId:`sha256:${sha}`,sha256:sha,byteLength,mediaType:"audio/wav"});for(const[sha,bytes]of[[micSha,mic],[backingSha,backing]]as const)blobs.put({id:`sha256:${sha}`,schemaVersion:1,createdAt:now,updatedAt:now,sha256:sha,byteLength:bytes.length,mediaType:"audio/wav",opfsPath:`/qa-takes/${sha}.wav`,referenceCount:1});const manifest={schema:"atarang.performance/1",performanceId,originalId,revision:0,startedAt:now,endedAt:"2026-08-11T00:00:01.000Z",sampleRate:44_100,channels:2,durationFrames:44_100,mic:asset(micSha,mic.length),backing:asset(backingSha,backing.length),inputOffsetUs:0,deviceSettings:{},edit:{trimStartUs:0,trimEndUs:1_000_000,fadeInUs:0,fadeOutUs:0},updatedAt:now};transaction.objectStore("performances").put({id:performanceId,originalId,revision:0,schemaVersion:1,createdAt:now,updatedAt:now,manifest});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})
  },{performanceId,originalId,micSha,backingSha,now,mic,backing});
  await page.reload();
  if(isMobile)await page.getByRole("button",{name:"Song",exact:true}).click();
  await page.getByRole("tab",{name:"Takes"}).click();
  await page.getByRole("button",{name:"Preview take"}).click();
  const player=page.getByLabel("Take 1 take preview");
  await expect(player).toBeVisible();
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,articleRight:document.querySelector('[role=tabpanel] article')!.getBoundingClientRect().right-innerWidth,audioRight:document.querySelector('audio[aria-label^="Take 1"]')!.getBoundingClientRect().right-innerWidth}));
  expect(layout.overflow).toBe(0);expect(layout.articleRight).toBeLessThanOrEqual(0);expect(layout.audioRight).toBeLessThanOrEqual(0);
  expect(await player.evaluate(async audio=>new DataView(await(await fetch((audio as HTMLAudioElement).src)).arrayBuffer()).getInt16(44,true))).toBe(7_200);
  await page.getByRole("button",{name:"Reference"}).click();
  await expect(page.getByLabel("Take 1 reference preview")).toBeVisible();
  await page.getByLabel("Take 1 mic mix").fill("0.5");
  await expect(page.getByRole("button",{name:"Preview take"})).toBeVisible();
  await expect.poll(()=>page.evaluate(async id=>{try{const root=await navigator.storage.getDirectory();await(await(await root.getDirectoryHandle("exports")).getDirectoryHandle(id)).getDirectoryHandle("preview");return false}catch{return true}},performanceId)).toBe(true);
  expect(await page.evaluate(async id=>new Promise<number>((resolve,reject)=>{const request=indexedDB.open("atarang",11);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const get=request.result.transaction("performances").objectStore("performances").get(id);get.onsuccess=()=>resolve(get.result.manifest.edit.micGain);get.onerror=()=>reject(get.error)}}),performanceId)).toBe(.5);
  await page.getByRole("button",{name:"Preview take"}).click();
  await expect(page.getByLabel("Take 1 take preview")).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Discard take 1"}).click();
  await expect(page.getByText("No takes yet")).toBeVisible();
  expect(errors).toEqual([]);
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

test("sing-along follows timed lyrics and turns lyric gestures into a loop",async({page,isMobile})=>{
  const errors:string[]=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/library");
  await page.getByLabel("Choose audio to import").setInputFiles({name:"sing-along.wav",mimeType:"audio/wav",buffer:silentWav(2_205_000)});
  await page.getByRole("button",{name:"Skip for now and just play the song"}).click();
  await page.getByLabel("Choose LRC lyrics").setInputFiles({name:"sing-along.lrc",mimeType:"text/plain",buffer:Buffer.from("[00:00.00]First line\n[00:20.00]Second line\n[00:40.00]Third line")});
  await page.getByRole("button",{name:"Sing along"}).click();
  await expect(page).toHaveURL(/sing=1/);
  await expect(page.getByRole("button",{name:"Exit sing-along"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(await page.evaluate(()=>innerWidth));
  await page.mouse.wheel(0,200);
  await expect(page.getByRole("button",{name:"Resume follow"})).toBeVisible();
  await page.getByRole("button",{name:"Resume follow"}).click();
  await page.waitForTimeout(700);
  const first=page.getByRole("button",{name:/First line/}),second=page.getByRole("button",{name:/Second line/}),third=page.getByRole("button",{name:/Third line/});
  if(isMobile){
    const pointer={pointerId:1,pointerType:"touch",button:0,buttons:1,bubbles:true};
    await first.dispatchEvent("pointerdown",pointer);await page.waitForTimeout(550);await first.dispatchEvent("pointerup",{...pointer,buttons:0});
    await first.dispatchEvent("pointerdown",pointer);await second.dispatchEvent("pointerover",pointer);await second.dispatchEvent("pointerup",{...pointer,buttons:0});
  }else{
    await second.hover();await page.mouse.down();await page.waitForTimeout(550);await page.mouse.up();
    await second.hover();await page.mouse.down();await third.hover();await page.mouse.up();
  }
  await page.getByRole("button",{name:"Exit sing-along"}).click();
  if(isMobile)await page.getByRole("button",{name:"Practice",exact:true}).click();
  await expect(page.getByRole("button",{name:"Set loop start at playhead"})).toContainText(isMobile?"00:00.000":"00:20.000");
  await expect(page.getByRole("button",{name:"Set loop end at playhead"})).toContainText(isMobile?"00:40.000":"00:45.000");
  expect(errors).toEqual([]);
});

test("a named passage is saved from the loop and restores it later",async({page,isMobile})=>{
  await page.goto("/studio");
  const lane=page.locator('[title^="Drag to set the A–B loop"]'),box=(await lane.boundingBox())!,y=box.y+box.height/2;
  await page.mouse.move(box.x+box.width*.2,y);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.4,y,{steps:8});
  await page.mouse.up();
  if(isMobile)await page.getByRole("button",{name:"Practice",exact:true}).click();
  const boundary=()=>page.getByRole("button",{name:"Set loop start at playhead"}).innerText();
  const saved=await boundary();
  await page.getByLabel("Name for the current loop").fill("Chorus");
  // Enter, not the button: naming a passage and pressing return is the gesture.
  await page.getByLabel("Name for the current loop").press("Enter");
  const section=page.getByRole("button",{name:/^Chorus/});
  await expect(section).toBeVisible();
  await expect(page.getByLabel("Name for the current loop")).toHaveValue("");
  // Move the loop somewhere else, then let the saved passage put it back.
  await page.getByRole("button",{name:"Set loop start at playhead"}).click();
  expect(await boundary()).not.toBe(saved);
  await section.click();
  expect(await boundary()).toBe(saved);
  await page.getByRole("button",{name:"Delete section Chorus"}).click();
  await expect(section).toBeHidden();
});
