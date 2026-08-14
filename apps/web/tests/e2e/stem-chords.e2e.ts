import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { syntheticProgression } from "../eval/synthetic";
import { asPercent, parseLab, score } from "../eval/chordEval";

/**
 * Chords decoded from the separated stems, which for a long time meant chords
 * decoded worse than the mixture: the stems pass ran template chroma while the
 * mixture pass ran the model, and the guard that noticed skipped the stems pass
 * entirely rather than fixing it. Nothing failed, because nothing looked.
 *
 * Real separation needs the 126 MB model and minutes per song, so the stems
 * here are written straight into storage the way `htdemucs` would have left
 * them. What is being tested is the decode, not the separator.
 */
test("chords from separated stems are decoded by the model", async ({ page }) => {
  // Two stems are decoded and run through the model, at roughly real time.
  test.setTimeout(180_000);
  const errors: string[] = [];
  // The separation model is not staged here and its manifest 404s. That is the
  // state this test is deliberately in — it fabricates the stems precisely so it
  // does not need the separator — so it is not a failure.
  const ignore = (text: string) => text.includes("[W:onnxruntime") || text.includes("404");
  page.on("console", (message) => { if (message.type() === "error" && !ignore(message.text())) errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  const audio = syntheticProgression();
  const stems = { other: audio.other, bass: audio.bass, vocals: audio.other, drums: audio.other };
  const originalId = "019fef4f-9c77-7a3f-94ca-ef4214a80600", separationId = "019fef4f-9c77-7a3f-94ca-ef4214a80601";
  const files = Object.entries(stems).map(([kind, bytes]) => ({ kind, sha: createHash("sha256").update(bytes).digest("hex"), bytes: [...bytes] }));

  await page.goto("/");
  await page.evaluate(async ({ originalId, separationId, files, durationFrames, sampleRate }) => {
    // Every stem is a real decodable file at its recorded length, because the
    // integrity scan quarantines anything that is not and the decode would then
    // never be asked for.
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("blobs", { create: true });
    for (const file of files) {
      const handle = await directory.getFileHandle(`${file.sha}.wav`, { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array(file.bytes));
      await writable.close();
    }
    const now = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("atarang", 11);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["originals", "separations", "blobs"], "readwrite");
        const blobs = transaction.objectStore("blobs");
        for (const file of files) blobs.put({ id: `sha256:${file.sha}`, schemaVersion: 1, createdAt: now, updatedAt: now, sha256: file.sha, byteLength: file.bytes.length, mediaType: "audio/wav", opfsPath: `blobs/${file.sha}.wav`, referenceCount: 4 });
        const mixture = files[0]!;
        transaction.objectStore("originals").put({ id: originalId, schemaVersion: 1, createdAt: now, updatedAt: now, title: "Synthetic progression", artist: "Fixture", sourceFileName: "synthetic.wav", sourceMediaType: "audio/wav", byteLength: mixture.bytes.length, durationUs: Math.round(durationFrames / sampleRate * 1e6), contentSha256: mixture.sha, blobId: `sha256:${mixture.sha}` });
        const manifest = {
          schema: "atarang.separation/1", separationId,
          original: { originalId, contentSha256: mixture.sha, sourceMediaType: "audio/wav", sampleRate, channels: 1, durationFrames },
          model: { modelId: "htdemucs-4stem", artifactVersion: "test", artifactSha256: mixture.sha, upstream: "facebookresearch/demucs htdemucs", license: "MIT" },
          pipeline: { implementation: "server-pytorch", implementationVersion: "test", decodeVersion: "test", preprocessVersion: "test", segmentFrames: 343_980, overlapFrames: 85_995, shifts: 1, postprocessVersion: "test" },
          stems: files.map((file) => ({ kind: file.kind, blobId: `sha256:${file.sha}`, sampleRate, channels: 1, durationFrames, variants: [{ encoding: "pcm-f32le-wav", mediaType: "audio/wav", byteLength: file.bytes.length, sha256: file.sha }] })),
          provenance: { mode: "local", createdAt: now },
        };
        transaction.objectStore("separations").put({ id: separationId, originalId, schemaVersion: 1, createdAt: now, updatedAt: now, manifest, bindings: Object.fromEntries(files.map((file) => [file.kind, `sha256:${file.sha}`])) });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { originalId, separationId, files, durationFrames: audio.durationFrames, sampleRate: audio.sampleRate });

  // Opening the song is what asks for the stem decode.
  await page.goto(`/studio/${originalId}`);

  const stored = async () => page.evaluate((id) => new Promise<{ algorithm: string; chords: string[]; segments: { startTimeUs: number; endTimeUs: number; chord: string }[] } | null>((resolve, reject) => {
    const request = indexedDB.open("atarang", 11);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const get = request.result.transaction("chordAnalyses").objectStore("chordAnalyses").get(id);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result ? { algorithm: get.result.document.algorithmVersion, chords: get.result.document.segments.map((segment: { chord: string }) => segment.chord), segments: get.result.document.segments } : null);
    };
  }), originalId);

  await expect.poll(async () => (await stored())?.algorithm, { timeout: 120_000, intervals: [1_000] }).toBe("atarang-crema/2-stems");
  const analysis = (await stored())!;
  // The decode has to have found harmony, not merely finished: a run of "N" is
  // what a broken front end produces and it would still carry the new label.
  expect(analysis.chords.filter((chord) => chord !== "N").length).toBeGreaterThan(1);
  // Deliberately not asserting that this scores better than the mixture decode.
  // These stems are a split of a fixture that never had drums or a vocal in it,
  // so there is nothing for separation to take out of the way and the two paths
  // should agree. What phase 1 is worth has to be measured on real music, with
  // real stems, through `tests/eval`.
  console.log(`stems: ${Object.entries(score(parseLab(audio.lab), analysis.segments.map((segment) => ({ startUs: segment.startTimeUs, endUs: segment.endTimeUs, chord: segment.chord }))).scores).map(([name, value]) => `${name} ${asPercent(value.recall)}`).join("  ")}`);
  expect(errors).toEqual([]);
});
