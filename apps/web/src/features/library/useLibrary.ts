import { useCallback, useEffect, useState } from "react";
import type { OriginalRecord } from "../../storage/database";
import { libraryUsage, listOriginals, listSeparations, subscribeLibrary } from "../../storage/repositories";

export function useLibrary() {
  const [songs, setSongs] = useState<OriginalRecord[]>([]);
  const [usage, setUsage] = useState(0);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const [nextSongs, nextUsage, separations] = await Promise.all([listOriginals(), libraryUsage(), listSeparations()]);
    const separatedIds = new Set(separations.map((record) => record.originalId));
    setSongs(nextSongs.map((song) => Object.assign(song, { separated: separatedIds.has(song.id) }))); setUsage(nextUsage); setLoading(false);
  }, []);
  useEffect(() => { void refresh(); return subscribeLibrary(() => void refresh()); }, [refresh]);
  return { songs, usage, loading, refresh };
}
