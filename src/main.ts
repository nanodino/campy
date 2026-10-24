import "./style.css";
import * as cam from "./camera";
import * as store from "./store";
import { SLOTS, slotIds, type SlotId } from "./camera";

let root: FileSystemDirectoryHandle | null = null;
let tab: "filters" | "photos" = "filters";
let photos: { url: string; name: string }[] = [];
let onCamera = new Set<SlotId>();
let slotNames: Partial<Record<SlotId, string>> = {};
let backedUp = new Set<string>();
let library: string[] = [];
let message = "";
let persisted = false;

const app = document.getElementById("app")!;
const viewer = document.getElementById("viewer") as HTMLDialogElement;
viewer.addEventListener("click", () => viewer.close());

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { class: cls, ...rest } = props;
  const el = document.createElement(tag);
  if (cls) el.className = String(cls);
  Object.assign(el, rest);
  el.append(...kids);
  return el;
}

function say(m: string) {
  message = m;
  render();
}

async function loadFilters() {
  library = (await store.keys("library")).sort();
  backedUp = new Set(await store.keys("backups"));
  onCamera = new Set();
  slotNames = root ? await cam.readManifest(root) : {};
  if (root) for (const id of slotIds) if (await cam.hasSlot(root, id)) onCamera.add(id);
}

async function loadPhotos() {
  photos.forEach((p) => URL.revokeObjectURL(p.url));
  const files: File[] = [];
  for await (const fh of cam.findPhotos(root!)) files.push(await fh.getFile());
  files.sort((a, b) => b.lastModified - a.lastModified);
  photos = files.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
}

async function connect() {
  try {
    root = await cam.pickCamera();
  } catch {
    return; // picker cancelled
  }
  say("Reading the camera…");
  await Promise.all([loadFilters(), loadPhotos()]);
  say(`Connected. Found ${photos.length} photos.`);
}

async function importFilters(files: FileList) {
  let n = 0;
  for (const f of files) {
    if (!/\.flt$/i.test(f.name)) continue;
    await store.put("library", f.name, f);
    n++;
  }
  await checkPersist();
  await loadFilters();
  say(`Added ${n} filter${n === 1 ? "" : "s"} to your library.`);
}

// Ask the browser not to evict our data. Some browsers decide silently, others prompt.
async function checkPersist() {
  if (!navigator.storage?.persist) return;
  persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
}

async function toBase64(b: Blob) {
  let s = "";
  for (const byte of new Uint8Array(await b.arrayBuffer())) s += String.fromCharCode(byte);
  return btoa(s);
}
const fromBase64 = (s: string) => new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))]);

async function exportLibrary() {
  const filters = [];
  for (const name of library) {
    const blob = await store.get("library", name);
    if (blob) filters.push({ name, data: await toBase64(blob) });
  }
  const file = new Blob([JSON.stringify({ version: 1, filters })], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(file), download: `campsnap-library-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
  say(`Exported ${filters.length} filter${filters.length === 1 ? "" : "s"}.`);
}

async function importLibrary(file: File) {
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.version !== 1 || !Array.isArray(parsed.filters)) throw new Error("format");
    let n = 0;
    for (const f of parsed.filters) {
      if (typeof f?.name !== "string" || typeof f?.data !== "string" || !/\.flt$/i.test(f.name)) continue;
      await store.put("library", f.name, fromBase64(f.data));
      n++;
    }
    await loadFilters();
    say(`Restored ${n} filter${n === 1 ? "" : "s"} from ${file.name}. Filters with the same name were replaced.`);
  } catch {
    say("That file isn't a Camp Snap library export. Choose a .json file made by Export library.");
  }
}

async function assign(slot: SlotId, libName: string) {
  const data = await store.get("library", libName);
  if (!root || !data) return;
  // Keep the first original only, so "Restore original" always means the factory file.
  if (!backedUp.has(slot)) {
    const current = await cam.readSlot(root, slot);
    if (current) await store.put("backups", slot, current);
  }
  await cam.writeSlot(root, slot, data);
  await cam.writeManifest(root, { ...slotNames, [slot]: libName });
  await loadFilters();
  say(`${libName} is now on ${SLOTS[slot]}. Eject the camera before unplugging it.`);
}

// Removing the slot file lets the camera fall back to its built-in filter.
async function restore(slot: SlotId) {
  if (!root) return;
  await cam.deleteSlot(root, slot);
  const { [slot]: _, ...rest } = slotNames;
  await cam.writeManifest(root, rest);
  await loadFilters();
  say(`Deleted ${cam.slotFile(slot)} from the camera. Eject the camera before unplugging it.`);
}

function slotCard(id: SlotId) {
  const select = h(
    "select",
    { ariaLabel: `Library filter for ${SLOTS[id]}` },
    h("option", { value: "", textContent: "Pick a filter" }),
    ...library.map((n) => h("option", { value: n, textContent: n, selected: n === slotNames[id] })),
  );
  return h(
    "li",
    { class: "slot" },
    h("span", { class: "slot-file", textContent: id }),
    h("div", { class: "slot-body" },
      h("h3", { textContent: SLOTS[id] }),
      h("p", { class: "slot-filter", textContent: slotNames[id] ?? "Unknown filter" }),
      h("p", { class: onCamera.has(id) ? "on" : "off", textContent: onCamera.has(id) ? `${cam.slotFile(id)} on camera` : `No ${cam.slotFile(id)} on camera` }),
      select,
      h("div", { class: "row" },
        h("button", { textContent: "Write to camera", disabled: !root || !library.length, onclick: () => select.value && assign(id, select.value) }),
        h("button", { class: "quiet", textContent: "Restore original", hidden: !onCamera.has(id), onclick: () => restore(id) }),
      ),
    ),
  );
}

function filtersView() {
  const input = h("input", { type: "file", accept: ".flt", multiple: true, hidden: true, onchange: () => input.files && importFilters(input.files) });
  const restoreInput = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: () => restoreInput.files?.[0] && importLibrary(restoreInput.files[0]) });
  return h("section", {},
    h("ul", { class: "slots" }, ...slotIds.map(slotCard)),
    h("div", { class: "library" },
      h("h2", { textContent: "Your filter library" }),
      h("p", { textContent: "Download .flt files from filters.campsnapphoto.com, then add them here." }),
      h("div", { class: "row" },
        h("button", { textContent: "Add .flt files", onclick: () => input.click() }),
        h("button", { textContent: "Export library", disabled: !library.length, onclick: exportLibrary }),
        h("button", { textContent: "Import library", onclick: () => restoreInput.click() }),
      ),
      input,
      restoreInput,
      h("p", { class: "note", textContent: persisted ? "This browser has agreed to keep your library." : "This browser may clear your library to free space. Export it to keep a copy." }),
      h("ul", {}, ...library.map((n) => h("li", {}, n, h("button", { class: "quiet", textContent: "Remove", onclick: async () => { await store.del("library", n); await loadFilters(); render(); } })))),
    ),
  );
}

function photosView() {
  if (!root) return h("p", { class: "empty", textContent: "Connect the camera to see its photos." });
  if (!photos.length) return h("p", { class: "empty", textContent: "No JPEGs found on this drive. Check you picked the camera's root folder." });
  return h("div", { class: "grid" }, ...photos.map((p) =>
    h("img", { src: p.url, alt: p.name, loading: "lazy", decoding: "async", onclick: () => { viewer.querySelector("img")!.src = p.url; viewer.showModal(); } }),
  ));
}

function render() {
  const tabBtn = (t: typeof tab, label: string) =>
    h("button", { class: "tab", textContent: label, ariaPressed: String(tab === t), onclick: () => { tab = t; render(); } });
  app.replaceChildren(
    h("header", {},
      h("h1", { textContent: "Camp Snap companion" }),
      h("button", { class: "primary", textContent: root ? "Reconnect camera" : "Connect camera", disabled: !cam.supported, onclick: connect }),
    ),
    cam.supported
      ? h("p", { class: "status", role: "status", textContent: message || "Plug in the camera over USB-C, then choose its drive." })
      : h("p", { class: "status", textContent: "This browser can't open drives. Use Chrome or Edge on desktop." }),
    h("nav", {}, tabBtn("filters", "Filters"), tabBtn("photos", "Photos")),
    tab === "filters" ? filtersView() : photosView(),
  );
}

checkPersist().then(loadFilters).then(render);
