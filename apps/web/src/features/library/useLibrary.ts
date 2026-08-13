import { useCallback, useEffect, useState } from "react";
import type { OriginalRecord } from "../../storage/database";
import { libraryCategoryUsage, libraryUsage, listAllPerformances, listAnalyzedOriginalIds, listOriginals, listSeparations, subscribeLibrary } from "../../storage/repositories";

export function useLibrary() {
  const [songs, setSongs] = useState<OriginalRecord[]>([]);
  const [usage, setUsage] = useState(0);
  const [categoryUsage,setCategoryUsage]=useState({originals:0,separated:0,performances:0});
  const [loading, setLoading] = useState(true);
  const [performances,setPerformances]=useState<Awaited<ReturnType<typeof listAllPerformances>>>([]);
  const refresh = useCallback(async () => {
    const [nextSongs, nextUsage, nextCategoryUsage,separations,nextPerformances,analyzedIds] = await Promise.all([listOriginals(), libraryUsage(),libraryCategoryUsage(), listSeparations(),listAllPerformances(),listAnalyzedOriginalIds()]);
    const separatedIds = new Set(separations.flatMap((record) => [record.originalId,record.manifest.original.originalId]));
    const separatedHashes = new Set(separations.map((record) => record.manifest.original.contentSha256));
    setSongs(nextSongs.map((song) => Object.assign(song, { separated: separatedIds.has(song.id)||separatedHashes.has(song.contentSha256),analyzed:analyzedIds.has(song.id) })));setPerformances(nextPerformances); setUsage(nextUsage);setCategoryUsage(nextCategoryUsage); setLoading(false);
  }, []);
  useEffect(() => { void refresh(); return subscribeLibrary(() => void refresh()); }, [refresh]);
  return { songs, performances, usage, categoryUsage, loading, refresh };
}
