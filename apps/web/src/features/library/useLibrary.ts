import { useCallback, useEffect, useState } from "react";
import type { OriginalRecord } from "../../storage/database";
import { libraryCategoryUsage, libraryUsage, listAllPerformances, listAnalyzedOriginalIds, listOriginals, listSeparations, missingAudioOriginalIds, subscribeLibrary } from "../../storage/repositories";

export function useLibrary() {
  const [songs, setSongs] = useState<OriginalRecord[]>([]);
  const [usage, setUsage] = useState(0);
  const [categoryUsage,setCategoryUsage]=useState({originals:0,separated:0,performances:0});
  const [loading, setLoading] = useState(true);
  const [performances,setPerformances]=useState<Awaited<ReturnType<typeof listAllPerformances>>>([]);
  const refresh = useCallback(async () => {
    const [nextSongs, nextUsage, nextCategoryUsage,separations,nextPerformances,analyzedIds,missingIds] = await Promise.all([listOriginals(), libraryUsage(),libraryCategoryUsage(), listSeparations(),listAllPerformances(),listAnalyzedOriginalIds(),missingAudioOriginalIds()]);
    const separatedIds = new Set(separations.flatMap((record) => [record.originalId,record.manifest.original.originalId]));
    const separatedHashes = new Set(separations.map((record) => record.manifest.original.contentSha256));
    // `listSeparations` has already dropped stems the browser reclaimed, so a
    // song that still has them is still playable even without its mixture.
    setSongs(nextSongs.map((song) => {const separated=separatedIds.has(song.id)||separatedHashes.has(song.contentSha256);return Object.assign(song, { separated,analyzed:analyzedIds.has(song.id),missing:missingIds.has(song.id)&&!separated })}));setPerformances(nextPerformances); setUsage(nextUsage);setCategoryUsage(nextCategoryUsage); setLoading(false);
  }, []);
  useEffect(() => { void refresh(); return subscribeLibrary(() => void refresh()); }, [refresh]);
  return { songs, performances, usage, categoryUsage, loading, refresh };
}
