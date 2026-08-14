import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { asPercent, parseLab, pool, score, type Report } from "../eval/chordEval";

/**
 * What the chord detector actually scores, against annotations.
 *
 * Opt-in, because no corpus can ship with the app: the reference annotations
 * everyone publishes against (Isophonics, Billboard) are licensed for research
 * and the recordings they describe cannot be redistributed at all. So this
 * points at a directory you assembled yourself:
 *
 *   ATARANG_EVAL_CORPUS=~/chords bun run test:e2e:chords
 *
 * Each track is an audio file beside a `.lab` file of the same name, in Harte
 * notation — `0.0 2.6 N`, `2.6 5.2 C:maj` — which is what every published
 * annotation set already uses.
 *
 * The whole pipeline runs, in a real browser, through the real import path:
 * mediabunny decodes, the worker runs, the model runs, the result is read back
 * out of IndexedDB. A number from anything less than that is a number about a
 * test harness.
 */
const corpus = process.env.ATARANG_EVAL_CORPUS;
const AUDIO = new Set([".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus"]);

function tracks(directory: string) {
  const found: { audio: string; lab: string; name: string }[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!AUDIO.has(extname(entry).toLowerCase())) continue;
      const lab = join(path, `${basename(entry, extname(entry))}.lab`);
      try { statSync(lab); } catch { continue; }
      found.push({ audio: full, lab, name: basename(entry, extname(entry)) });
    }
  };
  walk(directory);
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The stored analysis for one imported file, or null while it is still running.
 *
 * Runs inside the page, so it reaches for IndexedDB directly rather than the
 * app's repositories: this has to observe what was actually persisted, not what
 * a module in the same bundle believes was persisted.
 */
const storedAnalysis = (fileName: string) => new Promise<{ algorithm: string; segments: { startTimeUs: number; endTimeUs: number; chord: string }[] } | null>((resolve, reject) => {
  const request = indexedDB.open("atarang", 11);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction(["originals", "chordAnalyses"]);
    const originals = transaction.objectStore("originals").getAll();
    originals.onerror = () => reject(originals.error);
    originals.onsuccess = () => {
      const original = originals.result.find((record) => record.sourceFileName === fileName);
      if (!original) { resolve(null); return; }
      const analysis = transaction.objectStore("chordAnalyses").get(original.id);
      analysis.onerror = () => reject(analysis.error);
      analysis.onsuccess = () => resolve(analysis.result ? { algorithm: analysis.result.document.algorithmVersion, segments: analysis.result.document.segments } : null);
    };
  };
});

test.describe("chord accuracy", () => {
  test.skip(!corpus, "set ATARANG_EVAL_CORPUS to a directory of audio files with matching .lab annotations");
  // Every track is decoded and analysed in the browser, at roughly real time.
  test.describe.configure({ timeout: 60 * 60_000 });

  test("detected chords are scored against the annotations", async ({ page }) => {
    const found = tracks(corpus!);
    expect(found, `no audio-and-.lab pairs under ${corpus}`).not.toHaveLength(0);

    const reports: { name: string; algorithm: string; report: Report; segments: { startTimeUs: number; endTimeUs: number; chord: string }[] }[] = [];
    for (const track of found) {
      const fileName = basename(track.audio);
      await page.goto("/library");
      await page.getByLabel("Choose audio to import").setInputFiles(track.audio);
      await expect(page).toHaveURL(/\/studio\//, { timeout: 120_000 });
      const skip = page.getByRole("button", { name: "Skip for now and just play the song" });
      if (await skip.isVisible().catch(() => false)) await skip.click();

      let stored: Awaited<ReturnType<typeof storedAnalysis>> = null;
      await expect.poll(async () => {
        stored = await page.evaluate(storedAnalysis, fileName);
        return stored !== null;
      }, { timeout: 15 * 60_000, intervals: [2_000] }).toBe(true);
      const analysis = stored as unknown as NonNullable<Awaited<ReturnType<typeof storedAnalysis>>>;

      const report = score(
        parseLab(readFileSync(track.lab, "utf8")),
        analysis.segments.map((segment) => ({ startUs: segment.startTimeUs, endUs: segment.endTimeUs, chord: segment.chord })),
      );
      // The segments go into the written report as well as the score: a track
      // that scores badly is a thing to read, not just a number to look at.
      reports.push({ name: track.name, algorithm: analysis.algorithm, report, segments: analysis.segments });
      // Printed per track rather than only at the end, because a corpus run is
      // long and the interesting track is usually the one scoring badly.
      console.log(`${track.name.slice(0, 40).padEnd(40)} ${analysis.algorithm.padEnd(22)} ${Object.entries(report.scores).map(([name, value]) => `${name} ${asPercent(value.recall)}`).join("  ")}`);
    }

    const overall = pool(reports.map((entry) => entry.report));
    console.log(`\n${found.length} tracks, ${(overall.annotatedUs / 6e7).toFixed(1)} minutes annotated`);
    for (const [name, value] of Object.entries(overall.scores)) console.log(`  ${name.padEnd(10)} ${asPercent(value.recall)}  (over ${(value.comparedUs / 6e7).toFixed(1)} min)`);
    if (overall.unparsedUs) console.log(`  unread annotations: ${(overall.unparsedUs / 6e7).toFixed(1)} min — ${overall.unparsed.join(", ")}`);

    const out = process.env.ATARANG_EVAL_OUT;
    if (out) { writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), tracks: reports, overall }, null, 2)}\n`); console.log(`\nwritten to ${out}`); }

    // The harness asserts only that it measured something. What the number has
    // to beat is a judgement about a release, not about a commit.
    expect(overall.scores.majmin!.comparedUs).toBeGreaterThan(0);
  });
});
