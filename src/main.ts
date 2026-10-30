import "./style.css";
import * as cam from "./camera";
import * as store from "./store";
import { SLOTS, slotIds, type SlotId } from "./camera";

type Photo = { url: string; name: string; time: number; file: File };
type Loadout = Partial<Record<SlotId, string>>;

const ROLL_GAP = 2 * 60 * 60 * 1000;
const rollDates = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

let root: FileSystemDirectoryHandle | null = null;
let tab: "filters" | "photos" = "filters";
let photos: Photo[] = [];
let imported = new Set<string>();
let importing = false;
let favourites = new Set<string>();
let favouritesOnly = false;
let rollNames = new Map<string, string>();
let sheetRoll: string | null = null;
let onCamera = new Set<SlotId>();
let slotNames: Partial<Record<SlotId, string>> = {};
let backedUp = new Set<string>();
let library: string[] = [];
let loadouts = new Map<string, Loadout>();
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
  loadouts = new Map();
  for (const name of await store.keys("loadouts")) loadouts.set(name, (await store.get<Loadout>("loadouts", name))!);
  backedUp = new Set(await store.keys("backups"));
  onCamera = new Set();
  slotNames = root ? await cam.readManifest(root) : {};
  if (root) for (const id of slotIds) if (await cam.hasSlot(root, id)) onCamera.add(id);
}

async function loadPhotos() {
  photos.forEach((p) => URL.revokeObjectURL(p.url));
  const files: File[] = [];
  for await (const fh of cam.findPhotos(root!)) files.push(await fh.getFile());
  files.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
  photos = files.map((f) => ({ url: URL.createObjectURL(f), name: f.name, time: f.lastModified, file: f }));
  imported = new Set(await store.keys("imported"));
  favourites = new Set(await store.keys("favourites"));
  rollNames = new Map();
  for (const key of await store.keys("rollNames")) rollNames.set(key, (await store.get<string>("rollNames", key))!);
}

function groupRolls(list: Photo[]) {
  const rolls: Photo[][] = [];
  for (const p of list) {
    const roll = rolls.at(-1);
    if (roll && p.time - roll.at(-1)!.time < ROLL_GAP) roll.push(p);
    else rolls.push([p]);
  }
  return rolls;
}

const photoKey = (p: Photo) => `${p.name}|${p.file.size}|${p.time}`;
const rollKey = (roll: Photo[]) => photoKey(roll[0]);

// Named after the roll's first photo, not its number: numbers shift as photos leave the card.
function rollFolder(roll: Photo[]) {
  const d = new Date(roll[0].time);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
  const stamp = local.toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  const name = rollNames.get(rollKey(roll))?.replace(/[\\/:*?"<>|]/g, "-").replace(/[. ]+$/, "");
  return name ? `${stamp} ${name}` : stamp;
}

async function renameRoll(roll: Photo[], rawName: string) {
  const name = rawName.trim();
  if (name) {
    rollNames.set(rollKey(roll), name);
    await store.put("rollNames", rollKey(roll), name);
  } else {
    rollNames.delete(rollKey(roll));
    await store.del("rollNames", rollKey(roll));
  }
}

async function toggleFavourite(p: Photo) {
  const key = photoKey(p);
  if (favourites.delete(key)) await store.del("favourites", key);
  else {
    favourites.add(key);
    await store.put("favourites", key, Date.now());
  }
  if (!favourites.size) favouritesOnly = false;
  render();
}

async function importPhotos(list: Photo[]) {
  if (!root) return;
  let dest: FileSystemDirectoryHandle;
  try {
    dest = await cam.pickImportFolder();
  } catch {
    return; // picker cancelled
  }
  if (await root.resolve(dest)) return say("That folder is on the camera. Choose one on your computer.");
  importing = true;
  const wanted = new Set(list);
  let copied = 0, skipped = 0, failed = 0;
  say(`Importing ${list.length} photo${list.length === 1 ? "" : "s"}…`);
  for (const roll of groupRolls(photos)) {
    for (const p of roll.filter((p) => wanted.has(p))) {
      try {
        const dir = await dest.getDirectoryHandle(rollFolder(roll), { create: true });
        if (await cam.copyPhoto(dir, p.file)) copied++;
        else skipped++;
        await store.put("imported", photoKey(p), Date.now());
        imported.add(photoKey(p));
      } catch {
        failed++;
      }
      // Not say(): re-rendering every photo for each file would stall the import.
      message = `Importing photo ${copied + skipped + failed} of ${list.length}…`;
      document.querySelector(".status")!.textContent = message;
    }
  }
  importing = false;
  say(
    `Imported ${copied} photo${copied === 1 ? "" : "s"} to ${dest.name}.` +
      (skipped ? ` ${skipped} already there.` : "") +
      (failed ? ` Couldn't import ${failed}. Check the camera is connected and the folder has space.` : ""),
  );
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
  const file = new Blob([JSON.stringify({ version: 1, filters, loadouts: Object.fromEntries(loadouts) })], { type: "application/json" });
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
    let m = 0;
    for (const [name, slots] of Object.entries(parsed.loadouts ?? {})) {
      const clean = cleanLoadout(slots);
      if (!Object.keys(clean).length) continue;
      await store.put("loadouts", name, clean);
      m++;
    }
    await loadFilters();
    const extra = m ? ` and ${m} loadout${m === 1 ? "" : "s"}` : "";
    say(`Restored ${n} filter${n === 1 ? "" : "s"}${extra} from ${file.name}. Anything with the same name was replaced.`);
  } catch {
    say("That file isn't a Camp Snap library export. Choose a .json file made by Export library.");
  }
}

function cleanLoadout(v: unknown) {
  const slots: Loadout = {};
  for (const id of slotIds) {
    const name = (v as Loadout | null)?.[id];
    if (typeof name === "string") slots[id] = name;
  }
  return slots;
}

async function saveLibraryToCamera() {
  if (!root) return;
  say(`Saving ${library.length} filter${library.length === 1 ? "" : "s"} to the camera…`);
  const failed: string[] = [];
  for (const name of library) {
    const data = await store.get("library", name);
    try {
      if (!data) throw new Error("missing");
      await cam.writeLibraryFilter(root, name, data);
    } catch {
      failed.push(name);
    }
  }
  const saved = library.length - failed.length;
  say(
    failed.length
      ? `Saved ${saved} of ${library.length} filters to ${cam.LIBRARY_DIR}. Couldn't save: ${failed.join(", ")}. Eject the camera before unplugging it.`
      : `Saved ${saved} filter${saved === 1 ? "" : "s"} to ${cam.LIBRARY_DIR} on the camera. Eject the camera before unplugging it.`,
  );
}

async function loadLibraryFromCamera() {
  if (!root) return;
  say("Loading filters from the camera…");
  let n = 0;
  let failed = false;
  try {
    for await (const f of cam.readLibraryFilters(root)) {
      await store.put("library", f.name, f);
      n++;
    }
  } catch {
    failed = true;
  }
  await checkPersist();
  await loadFilters();
  if (failed) say(`Couldn't finish reading ${cam.LIBRARY_DIR}. Loaded ${n} filter${n === 1 ? "" : "s"} before it stopped. Check the camera is connected.`);
  else if (!n) say(`No filters found in ${cam.LIBRARY_DIR} on the camera.`);
  else say(`Loaded ${n} filter${n === 1 ? "" : "s"} from the camera. Filters with the same name were replaced.`);
}

async function writeSlotFilter(camera: FileSystemDirectoryHandle, slot: SlotId, data: Blob) {
  // Keep the first original only, so "Restore original" always means the factory file.
  if (!backedUp.has(slot)) {
    const current = await cam.readSlot(camera, slot);
    if (current) await store.put("backups", slot, current);
  }
  await cam.writeSlot(camera, slot, data);
}

async function assign(slot: SlotId, libName: string) {
  const data = await store.get("library", libName);
  if (!root || !data) return;
  await writeSlotFilter(root, slot, data);
  await cam.writeManifest(root, { ...slotNames, [slot]: libName });
  await loadFilters();
  say(`${libName} is now on ${SLOTS[slot]}. Eject the camera before unplugging it.`);
}

// Reads the slot dropdowns, so a loadout can be planned without touching the camera.
async function saveLoadout(rawName: string) {
  const name = rawName.trim();
  if (!name) return say("Name the loadout first.");
  const slots: Loadout = {};
  for (const id of slotIds) {
    const picked = document.querySelector<HTMLSelectElement>(`select[name="${id}"]`)!.value;
    if (picked) slots[id] = picked;
  }
  const n = Object.keys(slots).length;
  if (!n) return say("Pick a filter on at least one slot first.");
  const verb = loadouts.has(name) ? "Replaced" : "Saved";
  await store.put("loadouts", name, slots);
  await loadFilters();
  say(`${verb} ${name} with ${n} filter${n === 1 ? "" : "s"}.`);
}

// Slots the loadout doesn't mention are left as they are.
async function applyLoadout(name: string, slots: Loadout) {
  if (!root) return;
  say(`Writing ${name} to the camera…`);
  const names = { ...slotNames };
  const missed: string[] = [];
  for (const id of slotIds) {
    const libName = slots[id];
    if (!libName) continue;
    try {
      const data = await store.get("library", libName);
      if (!data) throw new Error("missing");
      await writeSlotFilter(root, id, data);
      names[id] = libName;
    } catch {
      missed.push(`${SLOTS[id]} (${libName})`);
    }
  }
  await cam.writeManifest(root, names).catch(() => missed.push(cam.MANIFEST));
  await loadFilters();
  say(
    (missed.length ? `${name} is only partly on the camera. Couldn't write: ${missed.join(", ")}.` : `${name} is on the camera.`) +
      " Eject the camera before unplugging it.",
  );
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
    { name: id, ariaLabel: `Library filter for ${SLOTS[id]}` },
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

function loadoutsView() {
  const nameInput = h("input", { type: "text", placeholder: "Loadout name", ariaLabel: "Loadout name" });
  return h("div", { class: "library" },
    h("h2", { textContent: "Loadouts" }),
    h("p", { textContent: "Pick filters on the slots above, name the set and save it. Writing a loadout changes only the slots it includes." }),
    h("form", { class: "row", onsubmit: (e: Event) => { e.preventDefault(); saveLoadout(nameInput.value); } },
      nameInput,
      h("button", { textContent: "Save loadout", disabled: !library.length }),
    ),
    h("ul", { class: "loadouts" }, ...[...loadouts].map(([name, slots]) =>
      h("li", {},
        h("strong", { textContent: name }),
        h("p", { class: "note", textContent: slotIds.filter((id) => slots[id]).map((id) => `${id}: ${slots[id]!.replace(/\.flt$/i, "")}`).join(" · ") }),
        h("div", { class: "row" },
          h("button", { textContent: "Write to camera", disabled: !root, onclick: () => applyLoadout(name, slots) }),
          h("button", { class: "quiet", textContent: "Remove", onclick: async () => { await store.del("loadouts", name); await loadFilters(); render(); } }),
        ),
      ),
    )),
  );
}

function filtersView() {
  const input = h("input", { type: "file", accept: ".flt", multiple: true, hidden: true, onchange: () => input.files && importFilters(input.files) });
  const restoreInput = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: () => restoreInput.files?.[0] && importLibrary(restoreInput.files[0]) });
  return h("section", {},
    h("ul", { class: "slots" }, ...slotIds.map(slotCard)),
    loadoutsView(),
    h("div", { class: "library" },
      h("h2", { textContent: "Your filter library" }),
      h("p", { textContent: "Download .flt files from filters.campsnapphoto.com, then add them here." }),
      h("div", { class: "row" },
        h("button", { textContent: "Add .flt files", onclick: () => input.click() }),
        h("button", { textContent: "Export library", disabled: !library.length, onclick: exportLibrary }),
        h("button", { textContent: "Import library", onclick: () => restoreInput.click() }),
        h("button", { textContent: "Save library to camera", disabled: !root || !library.length, onclick: saveLibraryToCamera }),
        h("button", { textContent: "Load library from camera", disabled: !root, onclick: loadLibraryFromCamera }),
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
  const fresh = photos.filter((p) => !imported.has(photoKey(p)));
  const freshFavourites = fresh.filter((p) => favourites.has(photoKey(p)));
  const size = photos.reduce((total, p) => total + p.file.size, 0);
  return h("div", {},
    h("p", { class: "note summary", textContent: `${photos.length} photo${photos.length === 1 ? "" : "s"} · ${formatSize(size)} on the card` }),
    h("div", { class: "row import" },
      h("button", {
        textContent: fresh.length ? `Import ${fresh.length} new photo${fresh.length === 1 ? "" : "s"}` : "All photos imported",
        disabled: importing || !fresh.length,
        onclick: () => importPhotos(fresh),
      }),
      h("button", { textContent: `Import ${freshFavourites.length} favourite${freshFavourites.length === 1 ? "" : "s"}`, disabled: importing, hidden: !freshFavourites.length, onclick: () => importPhotos(freshFavourites) }),
      h("button", { textContent: favouritesOnly ? "Show all photos" : "Show favourites", disabled: !favourites.size, ariaPressed: String(favouritesOnly), onclick: () => { favouritesOnly = !favouritesOnly; render(); } }),
      h("button", { class: "quiet", textContent: "Import all again", disabled: importing, hidden: fresh.length === photos.length, onclick: () => importPhotos(photos) }),
    ),
    ...groupRolls(photos).map(rollView).filter((v) => v !== null).reverse(),
  );
}

function formatSize(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function photoTile(p: Photo) {
  const starred = favourites.has(photoKey(p));
  return h("div", { class: "photo" },
    h("img", { src: p.url, alt: p.name, loading: "lazy", decoding: "async", onclick: () => { viewer.querySelector("img")!.src = p.url; viewer.showModal(); } }),
    h("button", { class: "star", textContent: starred ? "★" : "☆", ariaLabel: `Favourite ${p.name}`, ariaPressed: String(starred), onclick: () => toggleFavourite(p) }),
  );
}

// Assumes one photo per slot, shot in slot order. The names are what's on the slots now, not when the photos were taken.
function sheetView(roll: Photo[]) {
  return h("div", {},
    h("p", { class: "note", textContent: "Shoot one photo on each slot, in this order, as the first photos of a roll. Filter names show what's on the slots now." }),
    h("div", { class: "sheet" }, ...roll.slice(0, slotIds.length).map((p, n) => {
      const id = slotIds[n];
      const filter = slotNames[id] ?? (onCamera.has(id) ? "Unknown filter" : "Built-in filter");
      return h("figure", {}, photoTile(p), h("figcaption", {}, h("strong", { textContent: SLOTS[id] }), ` ${filter}`));
    })),
  );
}

function rollView(roll: Photo[], i: number) {
  const shown = favouritesOnly ? roll.filter((p) => favourites.has(photoKey(p))) : roll;
  if (!shown.length) return null;
  const key = rollKey(roll);
  const nameInput = h("input", { class: "roll-name", value: rollNames.get(key) ?? "", placeholder: `Roll ${i + 1}`, ariaLabel: `Name for roll ${i + 1}`, onchange: () => renameRoll(roll, nameInput.value) });
  return h("section", { class: "roll" },
    h("div", { class: "roll-head" },
      h("h2", {}, nameInput),
      h("button", { class: "quiet", textContent: sheetRoll === key ? "Back to photos" : "Test sheet", hidden: roll.length < 2, onclick: () => { sheetRoll = sheetRoll === key ? null : key; render(); } }),
    ),
    h("p", { class: "note", textContent: `${rollDates.formatRange(roll[0].time, roll.at(-1)!.time)} · ${roll.length} photo${roll.length === 1 ? "" : "s"}` }),
    sheetRoll === key ? sheetView(roll) : h("div", { class: "grid" }, ...shown.map(photoTile)),
  );
}

function render() {
  const tabBtn = (t: typeof tab, label: string) =>
    h("button", { class: "tab", textContent: label, ariaPressed: String(tab === t), onclick: () => { tab = t; render(); } });
  app.replaceChildren(
    h("header", {},
      h("h1", { textContent: "campy" }),
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
