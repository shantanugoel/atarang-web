import{expect,test}from"@playwright/test";

/**
 * The path that was completely broken by a one-line wasm mismatch and shipped
 * anyway: import a real song, separate it in this browser, play the result.
 * Unit tests and `tsc` both passed throughout that.
 *
 * Opt-in, because it runs the 126 MB model and, on a machine with no WebGPU
 * adapter, the whole song through the processor. Run it before a release:
 *
 *   ATARANG_E2E_SEPARATION=1 bun run test:e2e:separation
 */
test.describe("local separation",()=>{
  test.skip(!process.env.ATARANG_E2E_SEPARATION,"set ATARANG_E2E_SEPARATION=1 to run the slow real-separation pass");
  test.describe.configure({timeout:15*60_000});

  test("the bundled demo imports, separates in this browser, and plays back as four stems",async({page,request,isMobile})=>{
    const manifest=await request.get("/models/htdemucs-web-onnx/manifest.json");
    test.skip(!manifest.ok(),"browser model is not available in the build");
    // The ONNX runtime prints its own warnings through console.error. Its real
    // failures are tagged [E:onnxruntime and still count.
    const errors:string[]=[];
    page.on("console",message=>{if(message.type()==="error"&&!message.text().includes("[W:onnxruntime"))errors.push(message.text())});
    page.on("pageerror",error=>errors.push(error.message));

    await page.goto("/settings");
    await page.getByRole("button",{name:/Download browser model/}).click();
    await expect(page.getByText(/installed and enabled/)).toBeVisible({timeout:5*60_000});

    await page.getByRole("link",{name:"Library"}).click();
    await page.getByLabel("Choose audio to import").setInputFiles("src/assets/backbeat.mp3");
    await expect(page).toHaveURL(/\/studio\//);

    await page.getByRole("button",{name:"Separate song"}).click();
    const dialog=page.getByRole("dialog",{name:"Separate this song"});
    const start=dialog.getByRole("button",{name:"Start local"});
    await expect(start).toBeEnabled({timeout:60_000});
    await start.click();
    // The sheet closes only when all four stems are verified and published, and
    // it stays open with an explanation when they are not — so watch for both
    // rather than waiting out the full timeout on a failure that already showed.
    const failure=dialog.getByRole("alert");
    await expect.poll(async()=>await dialog.isHidden()||await failure.isVisible(),{timeout:10*60_000,intervals:[2_000]}).toBe(true);
    if(await failure.isVisible())throw new Error(`local separation failed: ${await failure.innerText()}`);

    const stems=await page.evaluate(async()=>new Promise<string[]>((resolve,reject)=>{
      const request=indexedDB.open("atarang",11);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const get=request.result.transaction("separations").objectStore("separations").getAll();get.onsuccess=()=>resolve(get.result.flatMap(record=>record.manifest.stems.map((stem:{kind:string})=>stem.kind)));get.onerror=()=>reject(get.error)};
    }));
    expect(stems.sort()).toEqual(["bass","drums","other","vocals"]);

    // Published is not the same as playable: this is the assertion the wasm
    // mismatch would have failed.
    if(isMobile)await page.getByRole("button",{name:"Mix",exact:true}).click();
    await expect(page.getByRole("complementary",{name:"Four stem mixer"})).toBeVisible();
    const transport=page.getByRole("region",{name:"Waveform and transport"});
    const before=Number(await transport.getAttribute("data-source-time-us"));
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await expect.poll(async()=>Number(await transport.getAttribute("data-source-time-us")),{timeout:30_000}).toBeGreaterThan(before+250_000);
    expect(errors).toEqual([]);
  });
});
