# mapfix shim: Lightroom maps without Google

> Proposed README section. It replaces the Google API key procedure, which stopped working in November 2023 (issue #41).

## How it works

Lightroom 6's Map module was written for Google's Maps JavaScript API. Google's current API no longer runs in the browser engine embedded in Lightroom 6 (Chromium 51), so no API key can bring it back.

This fix replaces Google's API with `mapfix-shim.js`, a small compatibility layer. It provides the parts of `google.maps` that Lightroom uses, built on [Leaflet](https://leafletjs.com). Lightroom's own map code stays unchanged.

| Map type in Lightroom | Source |
|---|---|
| Road | OpenStreetMap |
| Satellite | Esri World Imagery |
| Hybrid | Esri World Imagery, with Esri's road and place-name overlays |
| Terrain | OpenTopoMap |
| Light and Dark | OpenStreetMap, recolored |
| Address search and address lookup | OpenStreetMap's Nominatim service |

No account or API key is needed. The patch only changes three URLs in Lightroom. Lightroom loads the shim and Leaflet from the jsDelivr CDN.

Lightroom's map never worked offline. If the shim or Leaflet can't be loaded, Lightroom shows its usual "Map is offline" screen.

Fair use: the tile servers and Nominatim are free services with usage policies. Lightroom's normal use is fine. Please don't bulk-download areas or geocode huge catalogs in one go.

## Step-by-step procedure

Tested with Lightroom 6.14. Close Lightroom before you start.

### 1. Back up the Map module

Same as before: make a copy of `Location.lrmodule` on Windows, or `Location.agmodule` on Mac.

If you leave the copy in the same folder, change its extension so that Lightroom doesn't load it.

If you patched the module for a Google API key earlier, you can apply this patch on top of that, or start again from your original backup.

### 2. Extract the three Lua files

- **Windows:**
  1. Open `Location.lrmodule` in Resource Hacker and expand `LUA`.
  2. Use *Save bin resource* on `LOCATIONMAPVIEW.LUA`, `REVERSEGEOCODESERVICEFALLBACK.LUA` and `LOCATIONVIEWCONTROLLER.LUA`.
- **Mac:** In `Location.agmodule/Contents/Resources/`, copy `LocationMapView.lua`, `ReverseGeocodeServiceFallback.lua` and `LocationViewController.lua`. Rename the originals, for example to `*.lua.bak`.

### 3. Patch them

Windows:

```
patchluastr.py LOCATIONMAPVIEW.LUA -p patches/mapfix-shim.patch -o LOCATIONMAPVIEW.bin
patchluastr.py REVERSEGEOCODESERVICEFALLBACK.LUA -p patches/mapfix-shim.patch -o REVERSEGEOCODESERVICEFALLBACK.bin
patchluastr.py LOCATIONVIEWCONTROLLER.LUA -p patches/mapfix-shim.patch -o LOCATIONVIEWCONTROLLER.bin
```

Mac:

```
patchluastr.py LocationMapView.lua.bak -p patches/mapfix-shim.patch -o LocationMapView.lua
patchluastr.py ReverseGeocodeServiceFallback.lua.bak -p patches/mapfix-shim.patch -o ReverseGeocodeServiceFallback.lua
patchluastr.py LocationViewController.lua.bak -p patches/mapfix-shim.patch -o LocationViewController.lua
```

Each file contains only some of the patched strings, so `not found, nothing to patch` messages are normal. Each file must still report at least one `Updated ... strings`:
- 3 or 4 for the map view
- 1 for each of the other two files

### 4. Put the patched files back

- **Windows:** In Resource Hacker, use *Replace Resource* for the three resources, then save `Location.lrmodule`.
- **Mac:** Copy the three patched `.lua` files into `Location.agmodule/Contents/Resources/`.

### 5. Add `config.lua`

Copy `patches/config.lua` into Lightroom's settings folder. To find that folder:

1. In Lightroom, go to *Help > System Info*.
2. Look for the line *Settings Folder*.

On Windows this is usually `C:\Users\<your user name>\AppData\Roaming\Adobe\Lightroom`. On Mac it is usually `~/Library/Application Support/Adobe/Lightroom`.

If that folder already has a `config.lua`, for example for the [debug log](notes.md#debug-log), add the `locationModule` entries to it.

`enablePremiereLicense = false` makes Lightroom look up the addresses of photos through the shim (Nominatim), instead of Adobe's Google geocoding service, which no longer works. Without it, the map works, but addresses of photos are not filled in.

To fill in addresses automatically, also enable *Look up city, state, and country of GPS coordinates* under *Catalog Settings > Metadata*.

### 6. Start Lightroom

Open the Map module. The map should appear as before, now with OpenStreetMap and Esri tiles.

## Updates

The patch loads the newest `1.x` release of the shim. Fixes reach you without re-patching, although jsDelivr can take some time to pick up a new release. Only a `2.0` release would need a new patch.

To stay on a specific release, or to test a new one, set the version in `config.lua`:

```lua
locationModule = { enablePremiereLicense = false, api_version = "v1.0.0" }
```

### Hosting the shim yourself

This is for advanced users.

You can load the shim from your own server instead of jsDelivr by entering a URL instead of a version number in `api_version`:

```lua
locationModule = { enablePremiereLicense = false, api_version = "https://example.org/lightroom/mapfix-shim.js" }
```

Note that `api_version` only affects the map itself. Looking up addresses of photos happens on a separate hidden page, and `config.lua` can't change what that page loads. It always loads the default `1.x` shim from jsDelivr and uses that shim's geocoder settings.

To host everything yourself, including the geocoder and the online check, edit `patches/mapfix-shim.patch` before patching: replace the jsDelivr URL in its three replacement lines with your own. With that, `api_version` isn't needed.

Tile servers, Leaflet's location and the geocoder settings are set at the top of `mapfix-shim.js` (`DEFAULT_CONFIG`). A self-hosted copy can change any of them. A self-hosted URL must not contain `?` or `&`.

## Known limitations

- No Street View and no 45° imagery.
- Google's custom map styles are approximated: Light and Dark are recolored OpenStreetMap tiles.
- Looking up addresses is limited to one request per second, Nominatim's policy. Large batches take a while.
- Lightroom still asks Adobe's service-status server whether the map plugin is enabled, and this patch doesn't change that.

## Release process (maintainers)

1. Test the shim in the harness (`harness/README.md`): the smoke test must pass completely in Chrome.
2. Set `SHIM_VERSION` in `shim/mapfix-shim.js` and commit.
3. Tag the commit `vX.Y.Z` and push the tag.

   **Before the first release:** check that the repository has no older tags that look like `1.x` versions. jsDelivr could resolve `@1` to those instead.
4. Check that `https://cdn.jsdelivr.net/gh/astuder/lightroom-map-fix@vX.Y.Z/shim/mapfix-shim.js` serves the new file. `@1` follows once jsDelivr refreshes its cache. jsDelivr offers a purge endpoint to speed this up.
