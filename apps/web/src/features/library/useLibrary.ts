import { useCallback, useEffect, useState } from "react";
import type { OriginalRecord } from "../../storage/database";
import { libraryUsage, listAllPerformances, listOriginals, listSeparations, subscribeLibrary } from "../../storage/repositories";

export function useLibrary() {
  const [songs, setSongs] = useState<OriginalRecord[]>([]);
  const [usage, setUsage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [performances,setPerformances]=useState<Awaited<ReturnType<typeof listAllPerformances>>>([]);
  const refresh = useCallback(async () => {
    const [nextSongs, nextUsage, separations,nextPerformances] = await Promise.all([listOriginals(), libraryUsage(), listSeparations(),listAllPerformances()]);
    const separatedIds = new Set(separations.flatMap((record) => [record.originalId,record.manifest.original.originalId]));
    const separatedHashes = new Set(separations.map((record) => record.manifest.original.contentSha256));
    setSongs(nextSongs.map((song) => Object.assign(song, { separated: separatedIds.has(song.id)||separatedHashes.has(song.contentSha256) })));setPerformances(nextPerformances); setUsage(nextUsage); setLoading(false);
  }, []);
  useEffect(() => { void refresh(); return subscribeLibrary(() => void refresh()); }, [refresh]);
  return { songs, performances, usage, loading, refresh };
}
