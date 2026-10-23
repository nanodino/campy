// Browser-side storage: "library" = filters you've imported, "backups" = what was on the camera before first overwrite.
type StoreName = "library" | "backups";

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open("campsnap", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("library");
      r.result.createObjectStore("backups");
    };
    r.onsuccess = () => res(r.result);
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

export const put = (s: StoreName, key: string, v: Blob) => run(s, "readwrite", (o) => o.put(v, key));
export const get = (s: StoreName, key: string) => run<Blob | undefined>(s, "readonly", (o) => o.get(key));
export const del = (s: StoreName, key: string) => run(s, "readwrite", (o) => o.delete(key));
export const keys = async (s: StoreName) => (await run(s, "readonly", (o) => o.getAllKeys())) as string[];
