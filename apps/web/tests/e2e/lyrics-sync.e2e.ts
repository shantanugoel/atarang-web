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
