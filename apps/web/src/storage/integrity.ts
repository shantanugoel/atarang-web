import {
  assertBeatGrid,
  assertChordAnalysis,
  assertLyricsDocument,
  assertModelArtifactManifest,
  assertPerformanceManifest,
  assertPracticeState,
  assertSeparationManifest,
  assertUserChart,
  assertUserChord,
} from "@atarang/contracts";
import { database, type QuarantineRecord } from "./database";
import { fileForOpfsPath, removeOpfsDirectory } from "./opfs";
import { notifyLibraryChanged } from "./repositories";

let running: Promise<void> | null = null;

const quarantine = async (
  kind: QuarantineRecord["kind"],
  recordId: string,
  code: string,
  recoverable = true,
) => {
  const db = await database;
  const now = new Date().toISOString();
  const id = `${kind}:${recordId}:${code}`;
  const existing = await db.get("quarantine", id);
  await db.put("quarantine", {
    id,
    kind,
    recordId,
    code,
    recoverable,
    schemaVersion: 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
};

async function scan() {
  const db = await database;
  const cutoff = Date.now() - 5 * 60_000;

  for (const operation of await db.getAll("operations")) {
    if (operation.status !== "staging" || Date.parse(operation.updatedAt) >= cutoff) continue;
    try {
      await removeOpfsDirectory(`/staging/${operation.id}`);
    } catch {
      // Keep the quarantine notice if the browser cannot reclaim staging.
    }
    await db.put("operations", {
      ...operation,
      status: "failed",
      errorCode: "stale_staging_recovered",
      updatedAt: new Date().toISOString(),
    });
    await quarantine("operation", operation.id, "stale_staging_recovered", true);
  }

  // IndexedDB and OPFS are evicted independently when the origin is not
  // persisted, so a record can outlive its bytes. Left in place it is a promise
  // of audio nobody can play: the song stays listed as ready, the storage
  // readout counts megabytes that are gone, and the player reports a decode
  // failure for a file that is not there. Dropping the record is not data loss —
  // the data is already lost — and it is what makes every reader below tell the
  // truth. The song, its lyrics, charts and analysis stay; only the pointer goes.
  for (const blob of await db.getAll("blobs")) {
    try {
      const file = await fileForOpfsPath(blob.opfsPath);
      if (file.size !== blob.byteLength) await quarantine("blob", blob.id, "byte_length_mismatch", false);
    } catch {
      await db.delete("blobs", blob.id);
      await quarantine("blob", blob.id, "missing_blob", false);
    }
  }

  // A grid from a superseded detector is valid, not corrupt: it is replaced by
  // the next analysis pass rather than deleted out from under the song here.
  for (const record of await db.getAll("beats")) {
    try {
      assertBeatGrid(record.document);
    } catch {
      await db.delete("beats", record.id);
    }
  }
  for (const record of await db.getAll("chordAnalyses")) {
    try {
      assertChordAnalysis(record.document);
    } catch {
      await db.delete("chordAnalyses", record.id);
    }
  }
  for (const record of await db.getAll("separations")) {
    try {
      assertSeparationManifest(record.manifest);
    } catch {
      await quarantine("record", record.id, "invalid_separation", true);
    }
  }
  for (const record of await db.getAll("practice")) {
    try {
      assertPracticeState(record.document);
    } catch {
      await quarantine("record", record.id, "invalid_practice", true);
    }
  }
  for (const record of await db.getAll("lyrics")) {
    try {
      assertLyricsDocument(record.document);
    } catch {
      await quarantine("record", record.id, "invalid_lyrics", true);
    }
  }
  for (const record of await db.getAll("charts")) {
    try {
      assertUserChart(record.document);
    } catch {
      await quarantine("record", record.id, "invalid_chart", true);
    }
  }
  for(const record of await db.getAll("userChords")){try{assertUserChord(record.document)}catch{await quarantine("record",record.id,"invalid_user_chord",true)}}
  for (const record of await db.getAll("models")) {
    try {
      assertModelArtifactManifest(record.manifest);
    } catch {
      await db.delete("models", record.id);
      for (const capability of await db.getAll("capabilities")) {
        if (capability.modelArtifactId === record.id) await db.delete("capabilities", capability.id);
      }
    }
  }
  for (const record of await db.getAll("performances")) {
    try {
      assertPerformanceManifest(record.manifest);
    } catch {
      await quarantine("record", record.id, "invalid_performance", true);
    }
  }
  // The sweep runs while the Library is already on screen, so whatever it
  // reconciled has to reach the list that is reading the old answer.
  notifyLibraryChanged();
}

export function runIntegrityScan() {
  return (running ??= scan().finally(() => {
    running = null;
  }));
}

export async function listQuarantine() {
  return (await database).getAll("quarantine");
}
