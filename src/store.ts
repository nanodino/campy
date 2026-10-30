// Browser-side storage: "library" = filters you've imported, "backups" = what was on the camera before first overwrite,
// "imported" = photos already copied to the computer, "loadouts" = named sets of filters for the slots.
const STORES = ["library", "backups", "imported", "loadouts"] as const;
type StoreName = (typeof STORES)[number];

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open("campsnap", 3);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close(); // don't block a newer version opening in another tab
      res(r.result);
    };
    r.onerror = () => rej(r.error);
  });

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const put = (s: StoreName, key: string, v: unknown) => run(s, "readwrite", (o) => o.put(v, key));
export const get = <T = Blob>(s: StoreName, key: string) => run<T | undefined>(s, "readonly", (o) => o.get(key));
export const del = (s: StoreName, key: string) => run(s, "readwrite", (o) => o.delete(key));
export const keys = async (s: StoreName) => (await run(s, "readonly", (o) => o.getAllKeys())) as string[];
