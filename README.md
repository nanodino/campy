# campy

Camp Snap camera utilities: a small browser app for managing filters on a Camp Snap 2 and browsing its photos over USB. For some reason I cannot explain I hate using Finder for this, this photo gallery on the browser is what I needed.

Everything runs locally in the browser and all your data stays yours. 

## Requirements

- Chrome or Edge on desktop. The app uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) to read and write the camera's drive, which other browsers don't support. I use Firefox in my personal life so I hate this.
- Node.js, to run or build it.

## Getting started

```sh
npm install
npm run dev      # start the dev server
npm run build    # type-check and build to dist/
```

Plug the camera in over USB-C, open the app, click **Connect camera** and choose the camera's drive (its top-level folder).

## Filters

The camera has six filter slots, each stored as a `.flt` file at the top level of the card:

| Slot | File |
| --- | --- |
| Standard | `S.flt` |
| Vintage 1 | `V1.flt` |
| Vintage 2 | `V2.flt` |
| Vintage 3 | `V3.flt` |
| Analog | `A.flt` |
| Black & White | `Bw.flt` |

Filenames are case-sensitive.

### Your filter library

Download `.flt` files from [filters.campsnapphoto.com](https://filters.campsnapphoto.com), then click **Add .flt files** to add them to your library. The library is kept in the browser's storage (IndexedDB), so it's still there next time, but backups are a good idea.

- **Export library** downloads all your filters and loadouts as one `.json` file.
- **Import library** loads that file back in. Filters and loadouts with the same name are replaced.
- **Save library to camera** copies every filter into a `Filter Library` folder on the card. Filters with the same name are replaced, and filters you've removed from the library stay on the card. The folder is only a copy: slots still use the `.flt` files at the top level.
- **Load library from camera** adds every `.flt` file in that folder to your library, which is handy on a new computer or after the browser clears its storage. Filters with the same name are replaced, and filters that aren't on the card stay in your library.

### Putting filters on the camera

On each slot card, pick a filter from your library and click **Write to camera**. That overwrites the slot's `.flt` file on the camera.

**Restore original** deletes the slot's `.flt` file from the camera, so the camera falls back to its built-in filter for that slot.

Always eject the camera before unplugging it.

### Loadouts

A loadout is a named set of filters, like "Summer" or "Black & white day". Pick filters in the slot dropdowns, type a name and click **Save loadout**. You don't need the camera connected, and saving under an existing name replaces that loadout.

**Write to camera** on a loadout writes its filters to their slots in one go. Slots it doesn't include are left as they are. If one of its filters is no longer in your library, that slot is skipped and the status line says so.

Loadouts are kept in the browser's storage alongside your library. They're included in **Export library**, but not in **Save library to camera**.

### `filters.txt`

The app keeps a plain-text record of which library filter is on each slot in `filters.txt`, at the top level of the card:

```
S.flt = Kodak Gold.flt
V1.flt = Portra Warm.flt
```

It's updated whenever you write or restore a slot, and read when you connect, so each slot card shows the name of its filter. Slots without a line show "Unknown filter". Because it lives on the card, it goes wherever the camera goes. You can edit it by hand as long as each line keeps the `slot file = name` format.

### Backups

The first time you write to a slot, the app saves a copy of the file that was there in the browser's storage. Nothing in the app uses these copies at the moment. They're kept as a safety net.

## Photos

The **Photos** tab shows every JPEG on the camera, grouped into rolls with the newest roll first. A gap of 2 hours or more between two photos starts a new roll, however many photos are in it, and photos within a roll run oldest to newest. Rolls use each file's modified date, so they're only as accurate as the camera's clock. Click a photo to view it full size and click again to close it. The top of the tab shows how many photos are on the card and how much space they use. The browser can't see the card's total size, so it can't show free space.

Click a roll's title to name it. Clear the name to go back to "Roll 3".

Click the star on a photo to make it a favourite. **Show favourites** hides everything else, and **Import favourites** imports just the new ones. Roll names and favourites are kept in this browser, and aren't included in **Export library**.

### Test sheet

To compare your filters, start a new roll and take one photo on each slot in this order: Standard, Vintage 1, Vintage 2, Vintage 3, Analog, Black & White. Click **Test sheet** on the roll to see those photos side by side with their filter names.

The app can't tell which slot took a photo, so it goes by position: the first six photos of the roll, in order. The filter names are what's on the slots now, so view the sheet before changing them.

### Importing to your computer

**Import new photos** asks for a folder on your computer and copies each new photo into a subfolder for its roll, named after the roll's first photo, like `2026-10-03 10.00`. If you've named the roll, its name is added, like `2026-10-03 10.00 Saturday hike`. Renaming a roll after importing it starts a new folder for later photos. Photos on the card are left alone.

The browser remembers what you've imported, so those photos are skipped next time, even if you've moved them. That record stays in this browser, so a new computer or cleared storage starts fresh. **Import all again** copies everything, which is useful if you've lost a copy.

Nothing is overwritten. A photo with the same name and size in the folder is skipped, and one with the same name but a different size is saved as `IMG_1 (2).JPG`.

## Project layout

- `src/camera.ts`: slot definitions and reading and writing files on the camera, including `filters.txt`.
- `src/store.ts`: browser storage for the filter library, backups, loadouts, the record of imported photos, favourites and roll names.
- `src/main.ts`: the UI.
- `src/style.css`: styles.
