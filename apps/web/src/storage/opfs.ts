// Every operation here does the same walk: split the path, descend to the
// containing directory, act on the last segment.
async function walk(path: string) {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  let directory = await navigator.storage.getDirectory();
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return [directory, name] as const;
}

// A removal that finds nothing has already succeeded.
async function remove(path: string, recursive: boolean) {
  const [directory, name] = await walk(path);
  if (!name) return;
  try { await directory.removeEntry(name, { recursive }); } catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
}

export async function fileForOpfsPath(path: string) {
  const [directory, name] = await walk(path);
  if (!name) throw new Error("Invalid OPFS file path");
  return (await directory.getFileHandle(name)).getFile();
}

// OPFS is evictable when storage is not persistent, while the IndexedDB record
// that points at it is not. Anything that reports an asset as installed has to
// ask OPFS, not the record.
export async function opfsPathsExist(paths: string[]) {
  try {
    await Promise.all(paths.map((path) => fileForOpfsPath(path)));
    return true;
  } catch { return false; }
}

export const removeOpfsPath = (path: string) => remove(path, false);
export const removeOpfsDirectory = (path: string) => remove(path, true);
