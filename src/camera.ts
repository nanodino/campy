// Camp Snap 2 filter slots. Filenames are case-sensitive: do not normalise.
export const SLOTS = {
  S: "Standard",
  V1: "Vintage 1",
  V2: "Vintage 2",
  V3: "Vintage 3",
  A: "Analog",
  Bw: "Black & White",
} as const;

export type SlotId = keyof typeof SLOTS;
export const slotIds = Object.keys(SLOTS) as SlotId[];
export const slotFile = (id: SlotId) => `${id}.flt`;

export const supported = "showDirectoryPicker" in window;

export const pickCamera = () => window.showDirectoryPicker({ mode: "readwrite" });

export async function readSlot(root: FileSystemDirectoryHandle, id: SlotId): Promise<File | null> {
  try {
    return await (await root.getFileHandle(slotFile(id))).getFile();
  } catch {
    return null;
  }
}

export async function hasSlot(root: FileSystemDirectoryHandle, id: SlotId) {
  return (await readSlot(root, id)) !== null;
}

export async function writeSlot(root: FileSystemDirectoryHandle, id: SlotId, data: Blob) {
  const handle = await root.getFileHandle(slotFile(id), { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

// Folder layout isn't assumed: scan a few levels deep for JPEGs.
export async function* findPhotos(
  dir: FileSystemDirectoryHandle,
  depth = 3,
): AsyncGenerator<FileSystemFileHandle> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    if (handle.kind === "file" && /\.jpe?g$/i.test(name)) yield handle as FileSystemFileHandle;
    else if (handle.kind === "directory" && depth > 0)
      yield* findPhotos(handle as FileSystemDirectoryHandle, depth - 1);
  }
}
