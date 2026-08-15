# Palmap

Palmap is a static, interactive map for Palworld. It combines an extracted
8192-by-8192 world-map texture with normalized point-of-interest (POI) data,
custom type pins, and Alpha Pal portraits. Everything needed at runtime is in
`web/`, so deployment consists of copying that directory to an HTTP server.

This repository is currently a prototype. Leaflet 1.9.4 is its only browser
dependency, and it is loaded from a CDN.

## Requirements

- Python 3. Python dependencies are all from the standard library.
- ImageMagick 7 with WebP read/write support.
- `curl`, used to download Pal portrait images.
- A local HTTP server for development. ES modules and JSON loading do not work
  when `web/index.html` is opened through `file://`.

Check the external programs with:

```shell
python3 --version
magick -version
curl --version
```

## Build order

A complete rebuild normally runs in this order:

1. Convert the retained PalDB JavaScript snapshot into normalized POI JSON.
2. Extract the current world-map texture from the game with FModel.
3. Generate the map tile pyramid from the extracted game texture.
4. Generate the Alpha Pal portrait pins and their runtime manifest.
5. Serve or deploy the contents of `web/`.

The source map texture, `T_WorldMap.png`, is deliberately ignored by Git.

## Build and maintenance tools

All Python tools are in `tools/`. Each command exits nonzero and prints an
actionable error if validation or generation fails.

### `process_poi.py`

`process_poi.py` converts a retained PalDB `map_data_en.js` snapshot into the
normalized `web/data/poi_data.json` consumed by the browser.

The converter does not execute upstream JavaScript. It extracts only the five
allowlisted, JSON-compatible assignments named in `EXPECTED_VARIABLES`,
validates the map bounds and records, transforms coordinates, assigns stable
eight-character IDs, removes exact duplicates, and writes the result
atomically. POI types listed in `IGNORED_POI_TYPES` are intentionally omitted.

Keep the source response metadata when obtaining a new snapshot. At minimum,
record its URL and retrieval time:

```shell
python3 tools/process_poi.py \
    --input source/map_data_en.js \
    --output web/data/poi_data.json \
    --source-url https://paldb.cc/js/map_data_en.js \
    --retrieved-at 2026-08-14T12:00:00Z
```

`--retrieved-at` must be an RFC 3339 UTC timestamp without fractional seconds.
Optional provenance fields are available:

```shell
python3 tools/process_poi.py \
    --input source/map_data_en.js \
    --output web/data/poi_data.json \
    --source-url https://paldb.cc/js/map_data_en.js \
    --retrieved-at 2026-08-14T12:00:00Z \
    --last-modified 'Fri, 14 Aug 2026 18:00:00 GMT' \
    --etag '"response-etag"' \
    --game-version '1.0'
```

Use `--strict` for validation work when every skipped record, duplicate, or
warning should make conversion fail. Normal conversion reports recoverable
record problems as warnings and continues. Dataset-wide ambiguities, such as
stable-ID or type-slug collisions, always fail conversion.

The generated JSON records source provenance, a SHA-256 digest, raw-world map
bounds, generation statistics, normalized types, and normalized POIs.

### Extracting the world map with FModel

[FModel](https://github.com/4sval/FModel) is an open-source browser and
exporter for Unreal Engine archives. Palworld uses unversioned Unreal Engine
packages, so FModel needs a mapping file that matches the installed Palworld
version. An old mapping may open the archives but fail when reading or
exporting individual packages.

These instructions assume the Steam version on Windows:

1. In Steam, right-click Palworld and select **Manage > Browse local files**.
   Keep the path to the directory containing `Pal.exe`.
2. Download and unpack the latest Windows build from the
   [FModel releases page](https://github.com/4sval/FModel/releases).
3. Obtain a Palworld `.usmap` mapping file made for the exact game version
   currently installed. The
   [Palworld modding FModel guide][fmodel-guide] points to the current
   community mapping.
4. Start FModel. If Palworld is not detected, add an undetected game profile
   named `Palworld` and select the Palworld installation directory. If the
   archives do not appear, select `Palworld/Pal/Content/Paks` directly.
5. Open FModel's settings and configure:

   - **Output Directory**: a directory with at least 100 MiB free;
   - **UE Versions**: `GAME_UE5_1`;
   - **Texture Platform**: `Desktop`;
   - **Local Mapping File**: enabled;
   - **Mapping File Path**: the matching `.usmap` from step 3;
   - **Models > Texture Format**: `PNG`; and
   - **Keep Directory Structure**: enabled, if available.

6. Save the settings and restart FModel so the mapping is reloaded.
7. In **Archives**, select and load the Palworld base-game archives. The
   **Folders** and **Packages** views should become available after loading.
8. Search the packages for `T_WorldMap`, or browse to:

   ```text
   Pal/Content/Pal/Texture/UI/Map/T_WorldMap
   ```

   This is the texture used by the in-game map without POI overlays, as listed
   in the
   [Palworld game-file guide](https://palworld.wiki.gg/wiki/Game_Files/Guide).
9. Double-click the package and confirm that FModel shows the world map in the
   image pane. In the package list, right-click `T_WorldMap` and choose
   **Save Texture**. Do not use a screenshot of the preview.
10. Find `T_WorldMap.png` under FModel's output directory and copy it to the
    repository root with that exact name.

Confirm that FModel exported the full-resolution texture before generating
tiles:

```shell
magick identify T_WorldMap.png
```

The output must report `8192x8192`. `generate_tiles.py` rejects any other
dimensions, which prevents accidentally tiling a preview or lower mip level.
The PNG is about 26 MiB for the current texture and is intentionally excluded
from Git.

If extraction fails:

- No archives usually means the selected archive directory is wrong.
- Package parse errors usually mean the `.usmap` does not match the installed
  Palworld patch. Obtain a new mapping, update the path, and restart FModel.
- A missing image pane usually means the package was not decoded correctly.
- A PNG smaller than 8192-by-8192 may be a preview or mobile texture. Confirm
  `Desktop` is selected and use **Save Texture** from the package list.
- After a Palworld update, repeat the extraction even if the old PNG still
  tiles successfully; an old texture can have obsolete geography.

### `generate_tiles.py`

`generate_tiles.py` turns the extracted 8192-by-8192 game texture into the
lossless WebP tile pyramid used by Leaflet:

```shell
python3 tools/generate_tiles.py \
    --input T_WorldMap.png \
    --output-dir web/tiles
```

The prototype fixes the tile size at 256 and the maximum native zoom at 5.
Those values produce zoom levels 0 through 5 and 1,365 tiles in total. The
script invokes ImageMagick once per zoom level: it resizes the full image with
the Lanczos filter when needed, then crops that level into tiles in the same
command. Zoom 5 uses the 8192-by-8192 source without resizing.

The optional `--method` argument selects the WebP compression effort from 0
through 6; its default is 6. `--tile-size` and `--max-zoom` are exposed for
explicitness, but the prototype rejects values other than 256 and 5.

Generation occurs in a staging directory. The existing `web/tiles` directory
is replaced only after all levels and the manifest have been produced and
validated. The manifest includes the source SHA-256, ImageMagick version, tile
count, dimensions, and encoding settings.

### `create_pal_pin.py`

`create_pal_pin.py` downloads and processes one Pal portrait:

```shell
python3 tools/create_pal_pin.py \
    --url https://palworld.wiki.gg/images/Chillet_icon.png \
    --level 11 \
    --output web/images/pal_pins/chillet.png
```

The URL must use HTTP or HTTPS. The script downloads through `curl` into a
temporary directory and performs all image processing in one ImageMagick
command. The result is a 32-by-32 PNG with:

- a black background behind the portrait;
- a circular transparent mask;
- a one-pixel white circular outline; and
- an optional 10-pixel level label in the lower-right corner.

The level label has a dark-grey fill and a white outside halo. `--level` may be
omitted, but when supplied it must be a non-negative integer. The output is
published atomically, so a download or ImageMagick failure cannot leave a
partial pin at the requested path.

### `create_alpha_pal_pins.py`

`create_alpha_pal_pins.py` batch-generates every Alpha Pal pin by calling the
single-pin implementation above:

```shell
python3 tools/create_alpha_pal_pins.py \
    --manifest source/alpha_pal_portrait_urls.json \
    --poi-data web/data/poi_data.json \
    --output-dir web/images/pal_pins \
    --runtime-manifest web/data/alpha_pal_pin_urls.json
```

The source manifest permanently records the wiki portrait URL for each Alpha
Pal. The POI data supplies the level labels. Before downloading anything, the
batch tool validates manifest counts and unique filenames. It also requires
exactly one unambiguous integer level for every configured Alpha Pal.

Downloads and conversions run concurrently. `--workers` controls concurrency
from 1 through 16 and defaults to 4. `--url-prefix` controls the browser path
written into the runtime manifest and defaults to `images/pal_pins`.

Both the complete pin directory and runtime manifest are published only after
every pin succeeds. This avoids deploying a mixture of old and new assets.

## Coordinate transformation

The upstream snapshot can express a location in either raw-world coordinates
(`pos`) or Paldex coordinates (`ipos`). The output stores map-image coordinates
on a normalized 256-by-256 plane. The browser then adapts those coordinates to
Leaflet's axis convention.

### Coordinate spaces

- Paldex coordinates are written below as `(p_x, p_y)`.
- Raw-world coordinates are `(r_x, r_y)` in the game's world units.
- Normalized map-image coordinates are `(m_x, m_y)` from 0 through 256.
  `m_x` increases to the right and `m_y` increases downward.
- Native texture coordinates are `(u, v)` from 0 through 8192.

The raw-world bounds come from `landScapeRealPositionMin` and
`landScapeRealPositionMax` in the upstream `config` object:

```text
x_min, y_min, x_max, y_max
```

They are validated rather than hard-coded into the projection.

### Paldex to raw-world coordinates

Paldex and raw-world axes are crossed. The fixed conversion is:

```text
r_x = p_y * 459 - 123888
r_y = p_x * 459 + 158000
```

Therefore, increasing Paldex X moves right on the map, while increasing
Paldex Y moves upward on the map.

If a record contains `pos`, its raw-world value is authoritative. If it also
contains `ipos`, the converter independently transforms `ipos` and requires
the two representations to agree within one native source pixel. A record
with only `ipos` uses the formulas above.

### Raw-world to normalized map-image coordinates

The top-down texture uses raw Y as its horizontal axis and reversed raw X as
its vertical axis:

```text
m_x = 256 * (r_y - y_min) / (y_max - y_min) + offset_x / 32
m_y = 256 * (x_max - r_x) / (x_max - x_min) + offset_y / 32
```

The reversal in the second formula is what makes increasing raw X move upward
instead of downward on the image.

`MAP_IMAGE_OFFSET_NATIVE_PIXELS_X` and
`MAP_IMAGE_OFFSET_NATIVE_PIXELS_Y` in `tools/process_poi.py` are optional fine
registration corrections. Positive values move pins right or down. They are
specified in native 8192-by-8192 texture pixels, not normalized map units.
There are 32 native pixels per map unit:

```text
8192 / 256 = 32
u = 32 * m_x
v = 32 * m_y
```

With a texture extracted directly from the game, both offsets are currently
zero. If in-game comparison later reveals a systematic image-registration
error, adjust these two constants and regenerate `web/data/poi_data.json`.
Do not change the scale, midpoint, bounds, or axis directions to compensate
for a uniform pixel offset.

### Normalized map coordinates to Leaflet

Leaflet's simple CRS expects the vertical coordinate to increase upward, while
image `m_y` increases downward. `web/js/map_view.js` performs the final
vertical inversion when constructing a marker:

```text
Leaflet [latitude, longitude] = [256 - m_y, m_x]
```

This last step affects only browser rendering. The generated POI JSON keeps
the more conventional top-left-origin image coordinates, which makes direct
comparison against `T_WorldMap.png` straightforward.

### Verifying the projection

Coordinate tests cover known calibration points and axis-direction
invariants. After changing the source map or any projection constant:

1. Regenerate `web/data/poi_data.json`.
2. Run the test suite.
3. Inspect recognizable locations near the center and all four map edges at
   native zoom.
4. Compare against in-game positions before introducing a fine offset.

The most useful visual checks are small man-made islands, towers, fast-travel
points, and other landmarks with unambiguous centers.

## Running and deploying

Serve the static site from the repository root with:

```shell
python3 -m http.server 8000 --directory web
```

Open `http://localhost:8000/`. To deploy, copy the contents of `web/` to the
HTTP hosting directory; no Python code is needed on the server.

Run the offline tests with:

```shell
python3 -m unittest discover -s tests -v
```

[fmodel-guide]: https://pwmodding.wiki/docs/developers/useful-tools/fmodel
