import { chromium } from "@playwright/test";

const OUT = "/Users/shantanugoel/dev/atarang-web/screenshots";
const LRC = "/private/tmp/claude-501/-Users-shantanugoel-dev-atarang-web/7c3919ba-22ed-46d3-b1b4-3ce57ce65fd1/scratchpad/demo.lrc";
const base = "http://localhost:3000";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(`${base}/settings`);
await page.getByRole("button", { name: /Download browser model/ }).click();
await page.getByText(/installed and ready/).waitFor({ timeout: 5 * 60_000 });
console.log("model installed");

await page.getByRole("link", { name: "Library", exact: true }).click();
await page.getByRole("button", { name: "Dismiss storage notice" }).click().catch(() => {});
await page.getByRole("button", { name: "Add & separate" }).click();
await page.waitForURL(/\/studio\//, { timeout: 120_000 });

const dialog = page.getByRole("dialog", { name: "Separate this song" });
const start = dialog.getByRole("button", { name: "Start local" });
await start.waitFor({ timeout: 60_000 });
await start.click();
await dialog.waitFor({ state: "hidden", timeout: 15 * 60_000 });
console.log("separated");

await page.getByLabel("Choose LRC lyrics").setInputFiles(LRC);
await page.waitForTimeout(2000);

await page.getByRole("tab", { name: "Chords" }).click();
await page.getByLabel("View").selectOption({ label: "Lyrics + Chords" });
await page.waitForTimeout(1000);

// Park the playhead inside the lyric so a line is highlighted with its chord.
await page.getByRole("button", { name: "Play", exact: true }).click();
await page.waitForTimeout(17_000);
await page.getByRole("button", { name: "Play", exact: true }).click().catch(() => {});
await page.waitForTimeout(1500);

await page.screenshot({ path: `${OUT}/lyrics-chords.png` });
console.log("shot lyrics-chords");
await browser.close();
