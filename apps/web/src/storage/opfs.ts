export async function fileForOpfsPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("Invalid OPFS file path");
  let directory = await navigator.storage.getDirectory();
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return (await directory.getFileHandle(fileName)).getFile();
}

export async function removeOpfsPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;
  let directory = await navigator.storage.getDirectory();
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  try { await directory.removeEntry(fileName); } catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
}

export async function removeOpfsDirectory(path:string){const parts=path.split("/").filter(Boolean),name=parts.pop();if(!name)return;let directory=await navigator.storage.getDirectory();for(const part of parts)directory=await directory.getDirectoryHandle(part);try{await directory.removeEntry(name,{recursive:true})}catch(error){if(!(error instanceof DOMException&&error.name==="NotFoundError"))throw error}}
