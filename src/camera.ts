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

// Plain-text record of which library filter is on each slot, e.g. "V1.flt = Kodak Gold.flt".
// Lives on the camera so it travels with the card.
export const MANIFEST = "filters.txt";

export async function readManifest(root: FileSystemDirectoryHandle): Promise<Partial<Record<SlotId, string>>> {
  const names: Partial<Record<SlotId, string>> = {};
  let text = "";
  try {
    text = await (await (await root.getFileHandle(MANIFEST)).getFile()).text();
  } catch {
    return names;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\.flt\s*=\s*(.+)$/.exec(line.trim());
    if (m && slotIds.includes(m[1] as SlotId)) names[m[1] as SlotId] = m[2];
  }
  return names;
}

export async function writeManifest(root: FileSystemDirectoryHandle, names: Partial<Record<SlotId, string>>) {
  const lines = slotIds.filter((id) => names[id]).map((id) => `${slotFile(id)} = ${names[id]}`);
  const w = await (await root.getFileHandle(MANIFEST, { create: true })).createWritable();
  await w.write(lines.join("\n") + "\n");
  await w.close();
}

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
