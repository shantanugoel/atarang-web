import{expect,test}from"@playwright/test";
import{syntheticProgression}from"../eval/synthetic";

// Both workspaces stay mounted across tab switches, so a lyrics import only
// reaches the chords tab if its copy of the document is subscribed to writes.
test("lyrics imported on the lyrics tab reach the already-mounted chords tab",async({page,isMobile})=>{
  await page.goto("/library");
  await page.getByLabel("Choose audio to import").setInputFiles({name:"lyric-sync.wav",mimeType:"audio/wav",buffer:syntheticProgression(1).mixture});
  await page.getByRole("button",{name:"Skip for now and just play the song"}).click();
  if(isMobile)await page.getByRole("button",{name:"Song",exact:true}).click();
  await page.getByRole("tab",{name:"Chords"}).click();
  await expect(page.getByLabel("View")).toBeVisible({timeout:30_000});
  await page.getByRole("tab",{name:"Synced lyrics"}).click();
  await page.getByLabel("Choose LRC lyrics").setInputFiles({name:"lyric-sync.lrc",mimeType:"text/plain",buffer:Buffer.from("[00:00.00]First line\n[00:04.00]Second line")});
  await expect(page.getByRole("button",{name:/First line/})).toBeVisible();
  await page.getByRole("tab",{name:"Chords"}).click();
  await page.getByLabel("View").selectOption("lyricsChords");
  await expect(page.getByText("No lyrics yet")).toBeHidden();
  await expect(page.getByText("First line")).toBeVisible();
});

// Enhanced LRC is the karaoke case: one word lit at a time instead of a whole
// line. Coverage of it is partial in the wild, so the line-level path above stays
// the normal one and this is the addition, not the replacement.
test("enhanced LRC lights one word at a time",async({page,isMobile})=>{
  await page.goto("/library");
  await page.getByLabel("Choose audio to import").setInputFiles({name:"word-timed.wav",mimeType:"audio/wav",buffer:syntheticProgression(1).mixture});
  await page.getByRole("button",{name:"Skip for now and just play the song"}).click();
  if(isMobile)await page.getByRole("button",{name:"Song",exact:true}).click();
  await page.getByLabel("Choose LRC lyrics").setInputFiles({name:"word-timed.lrc",mimeType:"text/plain",buffer:Buffer.from("[00:00.00]<00:00.00>Wide <00:02.00>open <00:04.00>road\n[00:08.00]Second line")});
  const first=page.getByRole("button",{name:/Wide open road/});
  await expect(first).toBeVisible();
  // Only the word being sung carries a class, so its text is the readout.
  const litWord=()=>page.evaluate(()=>[...document.querySelectorAll("p span")].find(span=>span.className)?.textContent?.trim()??null);
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect.poll(litWord,{timeout:10_000}).toBe("Wide");
  await expect.poll(litWord,{timeout:10_000}).toBe("open");
  await page.getByRole("button",{name:"Pause",exact:true}).click();
});
