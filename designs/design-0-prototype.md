# Palmap Prototype Technical Design

## 1. Document status

- Status: Proposed
- Scope: Prototype milestone
- Product requirements: [`prd.md`](../prd.md)
- Intended implementation language: Python 3 and browser-native JavaScript
- Runtime deployment model: Static files served over HTTP

This document defines the complete implementation design for the Palmap
prototype. The prototype proves that PalDB place-of-interest data can be
converted into stable application data, positioned correctly on the Palworld
world map, filtered by type, and inspected through an anchored tooltip.

The design deliberately excludes MVP progress tracking, local storage,
progress import and export, and final POI icons. Those features depend on the
stable POI identifiers established by this prototype, but they are not
implemented during this milestone.

## 2. Goals

The prototype must provide all of the following behavior:

1. Display the local `world_map.webp` as a zoomable, pannable tiled map.
2. Load normalized POIs from a local JSON file.
3. Place POI pins at the correct map coordinates.
4. Allow each POI type to be shown or hidden.
5. Open a tooltip anchored to a pin when the user clicks that pin.
6. Show at least the POI name and type in the tooltip.
7. Work when served by a generic static HTTP server.
8. Require no Node.js, server-side application, or deployment-time build.
9. Generate stable POI identifiers suitable for use by the future MVP.
10. Record enough source metadata to reproduce and compare generated data.

## 3. Non-goals

The prototype will not provide:

- User progress or a completed/not-completed state.
- Local-storage persistence.
- Progress file import or export.
- Final per-type artwork. Prototype pins use local CSS styling.
- Text search, routing, navigation, or user-created markers.
- A backend, database, authentication, or user accounts.
- Automatic downloading of PalDB data in the browser.
- Automatic downloading of map tiles or JavaScript libraries at runtime.
- Automated discovery of the Palworld game version represented by PalDB.
- Perfect support for every optional field found in the upstream dataset.

The converter will retain selected optional fields for tooltips and debugging,
but unsupported source fields do not automatically become product features.

## 4. Design principles

### 4.1 Static runtime, explicit preparation

The browser application consumes only repository-owned static assets. Python
utilities perform source conversion and tile generation before the files are
deployed. This separates two different concerns:

- Preparation may require Python and Python packages.
- Serving and using the application requires only an HTTP file server and a
  browser.

This is not a Node.js build pipeline. The browser source remains readable and
is not bundled, transpiled, minified, or generated.

### 4.2 Treat upstream JavaScript as untrusted data

The PalDB source is JavaScript, but the converter must not execute it. Running
the file with `eval`, `exec`, a browser, or a JavaScript runtime would allow an
upstream file to execute arbitrary code during conversion.

Instead, the converter locates a small allowlist of variable assignments,
extracts their JSON-compatible object or array literals with a bracket-aware
scanner, and parses those literals with Python's
[`json` module](https://docs.python.org/3/library/json.html). Any construct
outside the supported JSON subset causes a clear conversion failure.

### 4.3 Deterministic generated artifacts

Given identical source bytes and converter options, the converter must produce
identical POI records in an identical order. The only intentionally variable
field is `retrieved_at`, which is supplied explicitly rather than read from the
clock during the normalization step.

Determinism makes reviews meaningful, prevents unnecessary deployment changes,
and makes stable identifier generation testable.

### 4.4 Preserve source coordinates

Every normalized POI retains its original coordinate system and coordinate
values. The converted map position is also stored. Keeping both allows a pin
to be diagnosed without downloading or reparsing the original PalDB file.

### 4.5 Keep browser responsibilities small

The browser displays already normalized records. It does not understand PalDB
variable names, inconsistent fields, HTML fragments, coordinate shifts, or
identity rules. These responsibilities belong to the Python converter, where
they can be validated and unit tested.

## 5. System overview

The system has two execution phases:

```text
Preparation phase

map_data_en.js --------> process_poi.py --------> poi_data.json
world_map.webp --------> generate_tiles.py ----> tiles/{z}/{x}/{y}.webp

Static runtime

index.html + CSS + JavaScript + vendored Leaflet
                    |
                    +---- loads poi_data.json
                    +---- loads visible local map tiles
```

The preparation outputs are committed or copied into the deployable directory.
A release does not run either Python utility on the target HTTP server.

## 6. Technology choices

### 6.1 Mapping library: Leaflet

Use [Leaflet](https://leafletjs.com/) with
[`L.CRS.Simple`](https://leafletjs.com/examples/crs-simple/crs-simple.html).
`L.CRS.Simple` represents a flat, non-geographic coordinate plane, which is
appropriate because `world_map.webp` is an image rather than a geographic web
Mercator map.

Leaflet provides the required tile loading, panning, zooming, marker layers,
tooltips, and viewport bounds without requiring a hosted map service. Its CSS,
JavaScript, and referenced image assets must be stored under `vendor/leaflet/`.
The page must not load Leaflet from a CDN.

The exact Leaflet version must be documented in `vendor/leaflet/VERSION` and
must not use a floating version reference. Updating Leaflet is an explicit
maintenance operation.

### 6.2 Browser language: JavaScript modules

Use browser-native ECMAScript modules. The application is split into small
source files loaded by a `<script type="module">` element. Modern browsers
support module imports over HTTP without a bundler.

The prototype targets the current versions of Firefox, Chromium, and Safari.
It does not support opening `index.html` through a `file://` URL because browser
security rules may block module and JSON requests. A local static HTTP server
is the supported development and deployment environment.

### 6.3 Preparation language: Python 3

Use Python 3.11 or newer. Both preparation utilities use only the Python
standard library. The tile generator invokes
[ImageMagick 7](https://imagemagick.org/script/command-line-processing.php)
through `subprocess.run()` for image decoding, resizing, cropping, and lossless
WebP encoding.

ImageMagick is a preparation-time system dependency, not a Python package or a
browser dependency. Require the ImageMagick 7 `magick` command and a build with
read/write support for WebP. Do not support the legacy ImageMagick 6 `convert`
command under the same interface, because its behavior and available options
can differ. No `requirements-dev.txt` is needed for the prototype.

### 6.4 Tile format

Generate 256 by 256 pixel lossless WebP tiles. The source image is already a
compressed WebP image, so applying lossy WebP encoding to generated tiles
would add a second generation of compression artifacts. Lossless encoding
preserves the pixels produced after decoding and, for lower zoom levels,
resizing the source image.

The source image is 8192 by 8192 pixels, so the native-resolution level
contains 32 tiles on each axis. The pyramid has levels 0 through 5:

| Level | Full level size | Tiles per axis | Total tiles |
|------:|----------------:|---------------:|------------:|
| 0 | 256 x 256 | 1 | 1 |
| 1 | 512 x 512 | 2 | 4 |
| 2 | 1024 x 1024 | 4 | 16 |
| 3 | 2048 x 2048 | 8 | 64 |
| 4 | 4096 x 4096 | 16 | 256 |
| 5 | 8192 x 8192 | 32 | 1024 |

The total is 1365 tiles. Leaflet requests only tiles intersecting or near the
current viewport, avoiding full-resolution image decoding during initial page
load.

## 7. Repository layout

The implementation uses the following layout:

```text
palmap/
|-- index.html
|-- prd.md
|-- world_map.webp
|-- css/
|   `-- palmap.css
|-- js/
|   |-- app.js
|   |-- map_view.js
|   |-- poi_repository.js
|   `-- type_filter.js
|-- data/
|   `-- poi_data.json
|-- tiles/
|   `-- {z}/{x}/{y}.webp
|-- tools/
|   |-- generate_tiles.py
|   `-- process_poi.py
|-- tests/
|   |-- fixtures/
|   |   `-- map_data_sample.js
|   |-- test_generate_tiles.py
|   `-- test_process_poi.py
|-- vendor/
|   `-- leaflet/
|       |-- VERSION
|       |-- images/
|       |-- leaflet.css
|       `-- leaflet.js
`-- designs/
    `-- design-0-prototype.md
```

Generated data and tiles are deployable assets. Whether all generated tiles
are committed to Git or attached during release packaging is a repository
policy decision. In either case, a deployable checkout or package must already
contain them.

## 8. PalDB source structure

At the time of this design, `map_data_en.js` declares five relevant variables:

- `iconLookup`: metadata keyed by POI type.
- `extrasIngame`: supplemental POIs using `ipos` coordinates.
- `config`: map dimensions and raw world-coordinate bounds.
- `fixedDungeon`: the main POI array, usually using `pos` coordinates.
- `regionData`: named regions using `ipos` coordinates.

The variable names are part of the converter's input contract, not the
browser's data contract. If PalDB renames or restructures them, conversion must
fail with an actionable error instead of producing incomplete output.

Important inconsistencies include:

- Main records can contain either `pos` or `ipos`.
- `pos` uses large raw world values; `ipos` uses Paldex-style values.
- Stable upstream `id` fields are optional.
- `item` can contain HTML markup rather than plain text.
- Optional metadata includes `lv`, `comment`, `onlyTime`, `href`,
  `UniqueName`, and `fixed_icon`.
- POI categories are generally defined separately in `iconLookup`.

## 9. Source acquisition and provenance

Downloading `map_data_en.js` is a deliberate human or release operation. The
converter accepts a local input file and does not fetch a URL itself. Keeping
network access outside the converter makes its inputs explicit and its tests
offline and deterministic.

For each source snapshot, record:

- The source URL.
- Retrieval time in UTC using RFC 3339 form.
- The HTTP `Last-Modified` value, when present.
- The HTTP `ETag` value, when present.
- The SHA-256 digest of the exact source bytes.
- The Palworld game version, only when established from a reliable source.

The current PalDB script does not contain a game version. The converter must
therefore accept `--game-version` as an optional argument and output `null`
when it is not supplied. It must never infer the game version from an HTTP
timestamp.

Example invocation:

```shell
python3 tools/process_poi.py \
    --input source/map_data_en.js \
    --output data/poi_data.json \
    --source-url https://paldb.cc/js/map_data_en.js \
    --retrieved-at 2026-08-12T23:18:37Z \
    --last-modified 'Wed, 12 Aug 2026 04:21:53 GMT' \
    --etag 'W/"204ced-658d1ed58c28c-gzip"'
```

The exact upstream source snapshot should be retained outside the deployable
assets or documented in release records. It is not loaded by the browser.

## 10. JavaScript data extraction

### 10.1 Allowed assignments

The converter extracts only the five allowlisted variables described above.
For each variable it performs these steps:

1. Search for the exact token sequence `var`, the expected variable name, and
   `=` with arbitrary whitespace between tokens.
2. Reject the file if the variable is absent or assigned more than once.
3. Require the first non-whitespace value character to be `{` or `[`. No
   function call or expression is accepted.
4. Scan one character at a time while tracking nested braces, nested brackets,
   JSON strings, and string escape characters.
5. Stop when the opening container is balanced.
6. Require the following non-whitespace character to be `;`.
7. Parse the extracted text with `json.loads()`.
8. Validate the parsed top-level type expected for that variable.

The scanner must understand that brackets inside JSON strings do not affect
nested depth. It does not need to implement JavaScript comments, template
literals, single-quoted strings, `undefined`, trailing commas, or expressions.
Encountering those constructs results in a conversion error explaining that
the upstream format changed.

### 10.2 Why regular expressions alone are insufficient

A regular expression that stops at the first `]` or `}` fails for nested
objects and string content. The small bracket-aware scanner is easier to audit
than a general JavaScript parser and intentionally supports only the source
shape that the project expects.

### 10.3 HTML-to-text conversion

The `item` field may contain embedded `<img>` markup. The normalized `name`
must be plain text.

Use a small subclass of Python's
[`HTMLParser`](https://docs.python.org/3/library/html.parser.html) to collect
text nodes. Then decode character references, collapse consecutive whitespace
to a single space, and trim leading and trailing whitespace. Do not preserve
HTML attributes such as `alt`, `title`, `src`, or `data-bs-title` as part of
the POI name.

The browser must also assign tooltip content through `textContent`, not
`innerHTML`. This is defense in depth if malformed markup reaches the JSON.

## 11. Coordinate systems

### 11.1 Coordinate names

The design uses three explicitly named coordinate systems:

1. `raw_world`: Large Palworld world coordinates from a record's `pos` field.
2. `paldex`: In-game map coordinates from a record's `ipos` field.
3. `map`: Leaflet `CRS.Simple` coordinates in a 256 by 256 unit square at
   zoom level 0.

Generic names such as `x` and `y` are always nested inside an object that
identifies the coordinate system.

### 11.2 Paldex-to-raw conversion

The referenced coordinate documentation gives the raw-world midpoint as
`(-123888, 158000)` and the scale as `459`. Convert `ipos` to raw coordinates
with:

```text
raw_x = paldex_x * 459 - 123888
raw_y = paldex_y * 459 + 158000
```

These constants must be named, documented module constants rather than inline
numeric literals:

```python
PALDEX_SCALE = 459
RAW_WORLD_MIDPOINT_X = -123888
RAW_WORLD_MIDPOINT_Y = 158000
```

Records containing `pos` skip this step because they already contain raw
coordinates.

### 11.3 Raw-to-map conversion

Use the bounds in PalDB's `config` object rather than the older bounds in the
coordinate note. At the time of design, the keys are:

```text
landScapeRealPositionMin.X
landScapeRealPositionMin.Y
landScapeRealPositionMax.X
landScapeRealPositionMax.Y
```

For raw coordinate `(raw_x, raw_y)`, calculate normalized map coordinates:

```text
map_x = 256 * (raw_x - raw_min_x) / (raw_max_x - raw_min_x)
map_y = 256 * (raw_max_y - raw_y) / (raw_max_y - raw_min_y)
```

The Y expression is inverted because image rows increase downward while raw
world Y increases upward. `(map_y, map_x)` is passed to Leaflet because Leaflet
uses latitude/longitude ordering even for `CRS.Simple`.

The result remains a floating-point number; rounding would cause visible
position loss at high zoom. A map unit corresponds to 32 source-image pixels
at native zoom because `8192 / 256 = 32`.

### 11.4 Bounds handling

A finite position inside inclusive range `[0, 256]` on both axes is valid.
A position outside that range is not silently clamped. Clamping would make a
bad transformation appear to be a legitimate marker along the map edge.

For out-of-bounds records:

1. Emit a warning containing the generated ID, type, source coordinates, and
   calculated map coordinates.
2. Exclude the record from `pois` by default.
3. Count it in `generation.statistics.excluded_out_of_bounds`.
4. Exit unsuccessfully if `--strict` was supplied.

NaN, infinity, missing axes, booleans, and non-numeric strings are malformed
coordinates and are always errors for that record.

### 11.5 Coordinate calibration

Formula correctness is not sufficient evidence of visual alignment. Create a
checked-in calibration fixture containing at least ten recognizable locations
distributed across the center, north, south, east, west, and newer islands.

Each fixture entry contains:

```json
{
    "source_id": "REGION_Grass_1_Village",
    "expected_map": {
        "x": 101.25,
        "y": 147.5
    },
    "tolerance_native_pixels": 16,
    "reason": "Center of the Small Settlement map symbol"
}
```

The example numbers are illustrative and must be replaced by measured values.
The automated test converts the point and compares it with the expected map
position. Because one map unit represents 32 native pixels, the test converts
the error into native pixels before applying the tolerance.

In addition, perform a visual review at native zoom. All calibration markers
must land on the intended feature. A systematic error across all points means
the transform is wrong; a local error usually means either source data or the
chosen visual reference is inaccurate.

## 12. Stable POI identity

### 12.1 Identifier properties

Every normalized POI ID must be:

- Globally unique within a dataset.
- Exactly eight URL-safe ASCII characters.
- Deterministic for identical source records.
- Independent of source-array order.
- Independent of transformed map coordinates.
- Safe for use as a JSON string, DOM dataset value, and local-storage key.
- Stable across converter runs when irrelevant metadata changes.

### 12.2 Canonical type slug

Convert the plain-text type to a lowercase ASCII slug:

1. Normalize Unicode with NFKD.
2. Remove combining marks.
3. Convert ASCII letters to lowercase.
4. Replace runs of non-alphanumeric characters with one underscore.
5. Remove leading and trailing underscores.
6. Reject an empty result.

For example, `Black Marketeer` becomes `black_marketeer`.

### 12.3 Canonical identity

Every POI receives the same compact output-ID format, whether or not PalDB
provides an upstream ID. The input to the hash differs according to the source
record.

When a non-empty scalar `id` is present, construct this canonical identity
object from the exact upstream value:

```json
{
    "kind": "upstream",
    "type": "Region",
    "upstream_id": "REGION_Grass_1_Village"
}
```

Including the type prevents unrelated upstream ID namespaces from colliding.
Retain the upstream ID as its exact JSON scalar type and value; for strings,
case and punctuation are significant. Reject object, array, boolean, null, and
empty-string IDs. This keeps numeric `1` distinct from string `"1"`.

For a record without `id`, build a canonical identity object containing:

```json
{
    "kind": "derived",
    "type": "Black Marketeer",
    "coordinate_system": "paldex",
    "x": "337",
    "y": "360",
    "href": "Desert_00",
    "unique_name": null
}
```

Coordinate numbers are serialized as canonical decimal strings so `337` and
`337.0` produce the same value. Include `href` and the normalized scalar value
of `UniqueName.Key` when available. Do not include display name, comment,
level, transformed coordinates, icon URL, or array position.

### 12.4 Compact output ID

Serialize either canonical identity object as compact JSON with sorted keys
and UTF-8 encoding. Hash those bytes with
[SHA-256](https://docs.python.org/3/library/hashlib.html), take the first six
bytes of the digest, and encode them with unpadded
[URL-safe base64][python-base64].
Six input bytes encode as exactly eight characters without padding:

```text
EnZc1kqJ
```

This example is the result for the canonical upstream identity shown in the
previous section.

[python-base64]: https://docs.python.org/3/library/base64.html

The ID contains 48 bits. With approximately 14,000 POIs, the birthday-bound
probability of at least one collision is approximately 0.000035 percent. This
is sufficiently small for compact runtime identifiers, but it is not treated
as impossible.

The converter maintains a map from each eight-character ID to the complete
canonical identity JSON. If two distinct canonical identities produce the
same compact ID, conversion fails and reports both identities. It must not
append an array index, lengthen only one ID, or add a random suffix, because
those responses would make output IDs unstable or variable-length.

If multiple source records have identical canonical identity objects and
identical normalized content, retain one and report a deduplication warning.
If their normalized content differs, fail because there is no stable basis for
choosing or numbering them.

## 13. Normalized JSON contract

### 13.1 Top-level object

`data/poi_data.json` has this shape:

```json
{
    "schema_version": 1,
    "data_version": "2026-08-12-4f8c21d7",
    "game_version": null,
    "source": {
        "url": "https://paldb.cc/js/map_data_en.js",
        "retrieved_at": "2026-08-12T23:18:37Z",
        "last_modified": "Wed, 12 Aug 2026 04:21:53 GMT",
        "etag": "W/\"204ced-658d1ed58c28c-gzip\"",
        "sha256": "<64 lowercase hexadecimal characters>"
    },
    "map": {
        "source_width": 8192,
        "source_height": 8192,
        "tile_size": 256,
        "min_zoom": 0,
        "max_zoom": 5,
        "raw_world_bounds": {
            "min_x": -1099400,
            "min_y": -724400,
            "max_x": 349400,
            "max_y": 724400
        }
    },
    "generation": {
        "statistics": {
            "source_records": 0,
            "output_records": 0,
            "deduplicated": 0,
            "excluded_out_of_bounds": 0
        }
    },
    "types": [],
    "pois": []
}
```

`schema_version` changes only when the JSON contract changes incompatibly.
`data_version` identifies a particular upstream snapshot and is formed from
the UTC retrieval date plus the first eight characters of the source SHA-256
digest. It is not a game version.

`game_version` is a string supplied by an operator or `null`. The future MVP
can use `schema_version` to interpret the file and `data_version` to diagnose
which POI snapshot produced saved progress.

### 13.2 Type record

Each entry in `types` has this shape:

```json
{
    "id": "black_marketeer",
    "name": "Black Marketeer",
    "category": "NPCs",
    "pin_color": "#7c3aed"
}
```

The type `id` is its canonical slug. `category` comes from `iconLookup` when
present and otherwise equals `Other`. `pin_color` is assigned deterministically
from a fixed, accessible local palette by hashing the type ID into the palette.
It is a prototype visualization, not the final MVP icon.

Sort type records by case-insensitive name, with the exact name as a stable
secondary key.

### 13.3 POI record

Each entry in `pois` has this shape:

```json
{
    "id": "EnZc1kqJ",
    "name": "Small Settlement",
    "type_id": "region",
    "type_name": "Region",
    "category": "Locations",
    "map_position": {
        "x": 101.25,
        "y": 147.5
    },
    "source_position": {
        "system": "paldex",
        "x": 75,
        "y": -480
    },
    "details": {
        "level": null,
        "comment": null,
        "availability": null
    }
}
```

Required fields are `id`, `name`, `type_id`, `type_name`, `category`,
`map_position`, `source_position`, and `details`. Missing optional details are
represented by `null`, not omitted, so the browser contract remains uniform.

The converter includes these optional tooltip fields:

- `level`: integer `lv`, when valid.
- `comment`: plain text derived from `comment`, when present.
- `availability`: plain text derived from `onlyTime`, when present.

Do not place upstream HTML or remote icon URLs in the normalized POI contract.
Final icons are an MVP concern and will be local assets.

Sort `pois` by `id`. This makes generated diffs and duplicate diagnosis
predictable.

### 13.4 Numeric encoding

Write map coordinates as JSON numbers with enough precision to reproduce at
least one quarter of a native source pixel. Since one map unit is 32 pixels,
four decimal places are sufficient, but the implementation should avoid
unnecessary rounding and allow Python's deterministic JSON float encoding.

All numeric values must be finite. JSON `NaN`, `Infinity`, and `-Infinity` are
forbidden by passing `allow_nan=False` to `json.dump()`.

## 14. Converter command-line interface

Implement the converter with
[`argparse`](https://docs.python.org/3/library/argparse.html):

```text
usage: process_poi.py [-h] --input PATH --output PATH
                      --source-url URL --retrieved-at TIMESTAMP
                      [--last-modified VALUE] [--etag VALUE]
                      [--game-version VERSION] [--strict]
```

Arguments have these meanings:

- `--input`: Existing local PalDB JavaScript source.
- `--output`: Destination JSON file.
- `--source-url`: Original URL recorded as provenance.
- `--retrieved-at`: Required UTC RFC 3339 timestamp supplied by the operator.
- `--last-modified`: Optional HTTP response metadata.
- `--etag`: Optional HTTP response metadata.
- `--game-version`: Optional verified Palworld version.
- `--strict`: Turn recoverable record warnings into a failed run.

The utility writes informational messages and warnings to standard error. On
success it writes the JSON atomically and exits zero. On failure it leaves an
existing output untouched and exits nonzero.

Atomic writing uses a temporary file in the output directory, flushes and
closes it, and then replaces the destination with `os.replace()`. A temporary
file in the same directory ensures the replacement stays on one filesystem.

## 15. Converter validation and error policy

### 15.1 File-level fatal errors

The following conditions fail the entire run:

- Input cannot be read or decoded as UTF-8.
- An expected top-level variable is missing or duplicated.
- Extracted content is not JSON-compatible.
- `config` is missing required bounds or contains invalid bounds.
- Map width or height is not 8192 for this prototype configuration.
- Two non-identical POIs receive the same stable ID.
- The output cannot be serialized or atomically replaced.

### 15.2 Record-level errors

A malformed individual record produces a warning and is excluded unless
`--strict` is active. Examples include:

- Missing or empty `item` after HTML-to-text conversion.
- Missing or empty `type`.
- Neither `pos` nor `ipos` is present.
- Both coordinate fields are present but disagree after conversion.
- Missing, non-numeric, non-finite, or boolean coordinate values.
- Converted coordinates are outside the map.

Every warning includes the source array name and the best available upstream
identity. The summary counts excluded records. A successful non-strict run
with warnings remains visible and reviewable; it must not silently discard
data.

If both coordinate fields are present, treat `pos` as authoritative and
compare converted `ipos` against it. A difference greater than one native map
pixel on either axis is a malformed record. One native pixel is derived from
the configured raw-world range divided by 8192, rather than encoded as another
magic constant.

### 15.3 Supported input arrays

Combine records from `fixedDungeon`, `extrasIngame`, and `regionData`. The
source array is not part of the stable ID because upstream may move a record
between arrays. It is retained only in diagnostic messages during conversion.

## 16. Tile generator

### 16.1 Command-line interface

```text
usage: generate_tiles.py [-h] --input PATH --output-dir PATH
                         [--tile-size 256] [--max-zoom 5]
                         [--method 6]
```

The defaults are part of the prototype configuration. Reject an input whose
dimensions are not exactly 8192 by 8192, because silently stretching or
cropping a different map would invalidate POI alignment.

`--method` controls WebP encoding effort from 0 through 6. It may affect
generation time and file size, but it must not change decoded pixel values.
The tile generator offers no lossy-quality option.

Before reading or changing the output directory, the utility performs these
dependency checks:

1. Resolve `magick` with `shutil.which()` and fail if it is unavailable.
2. Run `magick -version`, require a major version of 7, and retain the first
   version line for the manifest.
3. Run `magick -list format` and require the `WEBP` entry to advertise both
   read and write support.
4. Run `magick identify -format "%w %h" <input>` and require exactly
   `8192 8192`.

Pass every command to `subprocess.run()` as an argument list with `shell=False`
and `check=True`. Capture standard output and standard error. On failure, show
the command's program and options plus ImageMagick's diagnostic output, but do
not construct or print a shell-escaped command that a user might copy without
reviewing its paths.

### 16.2 Generation algorithm

For each zoom level from 0 through 5, calculate the level size as
`256 * 2 ** zoom` and the number of tiles per axis as `2 ** zoom`. Invoke
ImageMagick once for that complete level rather than once per tile. This limits
process startup to six invocations for the full pyramid.

For levels 0 through 4, the argument list is conceptually equivalent to:

```text
magick <input> -filter Lanczos -resize <size>x<size>! \
    -crop 256x256 +repage +adjoin \
    -quality 100 -define webp:method=<method> \
    <staging>/<zoom>/sequence_%04d.webp
```

This code block documents argument order; Python passes each token as a
separate list element and does not execute the displayed shell continuations.
The `!` makes the calculated square dimensions exact. This is safe because the
source was already validated as square. `+repage` removes each crop's virtual
canvas offset, and `+adjoin` requests separate output files.

For native zoom level 5, omit `-filter` and `-resize`. ImageMagick therefore
decodes the source and crops it without resampling. All levels still use the
same `-quality 100` setting, which selects lossless WebP encoding. The project
trusts ImageMagick's encoder contract and does not independently compare
decoded pixels during generation.

ImageMagick numbers the cropped sequence in row-major order. After a level
finishes, Python must:

1. Require exactly `(2 ** zoom) ** 2` numbered output files.
2. Require contiguous sequence numbers beginning at zero.
3. Calculate `tile_x = sequence % tiles_per_axis`.
4. Calculate `tile_y = sequence // tiles_per_axis`.
5. Create the `<staging>/<zoom>/<tile_x>/` directory.
6. Rename the sequence file to `<tile_y>.webp` in that directory.

Each level derives directly from the original image rather than from the
preceding smaller level. This avoids accumulating resize error through several
successive downsampling operations.

At zoom level 5, tiles are exact crops of the decoded source and are not
resized. At levels 0 through 4, resizing necessarily calculates new pixels;
lossless WebP ensures those calculated pixels are not degraded again during
tile encoding. “Lossless” therefore refers to encoding the tile pixels, not
to reversing any compression already present in the downloaded source.

Generation occurs in a temporary sibling directory. After every expected tile
is written and verified, perform a controlled directory swap:

1. Rename an existing output directory to a uniquely named backup sibling.
2. Rename the completed staging directory to the requested output path.
3. If the second rename fails, restore the backup and report failure.
4. Remove the backup only after the new output occupies the requested path.

Both renames remain on the same filesystem. This prevents generation or image
encoding failures from damaging the old output. A process or machine crash in
the short interval between renames can leave the backup beside the output;
the next run detects this state and reports recovery instructions instead of
guessing which tree to delete.

The tool also writes `tiles/manifest.json` containing the source image
SHA-256, dimensions, tile size, zoom range, total tile count, and this tool
metadata:

```json
{
    "generator": {
        "program": "ImageMagick",
        "version": "ImageMagick 7.x.x-..."
    },
    "encoding": {
        "format": "webp",
        "lossless": true,
        "quality": 100,
        "method": 6,
        "resize_filter": "Lanczos"
    }
}
```

Record the actual first version line reported by `magick -version`, not the
placeholder shown above. The browser validates only dimensions and zoom range;
the remaining fields support reproducibility and review when generated tiles
change between environments.

### 16.3 Stale tile removal

If configuration changes, obsolete tiles must not survive. Generating into a
fresh temporary directory and replacing the complete output is preferable to
editing an existing tree. Replacement must target only the explicit
`--output-dir`; the tool must reject `/`, the current workspace root, and an
empty path.

## 17. Browser architecture

### 17.1 `poi_repository.js`

This module owns loading and validating `data/poi_data.json`.

Its public interface is:

```javascript
/** Loads and validates the normalized POI dataset. */
export async function loadPoiData(url) {}
```

Validation checks the schema version, required top-level containers, unique
type IDs, unique POI IDs, the eight-character URL-safe ID format, known
`type_id` references, finite map coordinates, and coordinates inside
`[0, 256]`. It returns a frozen normalized object or throws an `Error` with a
user-safe message.

The prototype supports only `schema_version === 1`. A different version is a
hard error rather than an attempt at best-effort interpretation.

### 17.2 `map_view.js`

This module wraps Leaflet and owns:

- Creation of the `L.Map` with `L.CRS.Simple`.
- Local tile-layer configuration.
- Initial bounds and zoom.
- Marker creation and removal.
- Tooltip creation.
- Mapping from POI IDs to marker instances.

Its public interface is conceptually:

```javascript
/** Creates and returns the Palmap map view. */
export function createMapView(element, options) {}
```

The returned object exposes documented methods to set all POIs and update the
set of visible type IDs. Internal Leaflet objects remain private to the module.

Configure the map with:

```javascript
{
    crs: L.CRS.Simple,
    minZoom: 0,
    maxZoom: 7,
    zoomSnap: 1,
    maxBoundsViscosity: 1.0
}
```

The tile layer uses levels 0 through 5 and sets `maxNativeZoom: 5`. Zooms 6
and 7 enlarge native tiles for close inspection without generating additional
tiles. Set bounds to `[[0, 0], [256, 256]]`, fit those bounds initially, and
constrain panning with a small padding so the map cannot be lost completely.

### 17.3 `type_filter.js`

This module renders filter controls from the dataset's `types` array. It owns
the visible-type state in memory and emits a callback whenever it changes.

Render one checkbox per exact POI type, grouped under its category. All types
are visible initially. Include `Show all` and `Hide all` actions because a
dataset with many types is otherwise tedious to control.

Checkbox labels include the type name and current POI count. Controls use real
HTML `<input type="checkbox">` elements and associated `<label>` elements so
they work with keyboards and assistive technology.

Filter state does not persist after reload in the prototype.

### 17.4 `app.js`

This is the composition root. It performs these steps in order:

1. Find required page elements and fail clearly if markup is incomplete.
2. Show the loading state.
3. Load and validate `poi_data.json`.
4. Create the map and local tile layer.
5. Create markers for the normalized POIs.
6. Create the type filter from normalized type records.
7. Connect filter changes to marker visibility.
8. Fit the map bounds.
9. Replace the loading state with the ready state.

Any rejected operation enters an error state that leaves a readable message
on the page and logs technical detail to the browser console.

## 18. Marker rendering

### 18.1 Prototype marker

Use `L.circleMarker` with a shared `L.canvas()` renderer. The current PalDB
source contains many thousands of records; putting one HTML or SVG element in
the DOM for every record would create avoidable layout and rendering work.
Leaflet's canvas renderer draws paths into a shared canvas while retaining
per-marker click hit testing and tooltip binding.

A marker is a colored circular pin with a contrasting outline. Its fill color
comes from the normalized type record. It does not attempt to reproduce final
game icons.

Markers have a consistent radius in screen pixels so they remain clickable at
all zoom levels. Configure an adequately wide, transparent interaction stroke
if visual density requires a smaller visible circle. The effective pointer
target should be at least 20 by 20 CSS pixels where nearby POIs do not overlap.

### 18.2 Layer organization

Create one `L.LayerGroup` per POI type. Adding or removing a type group is more
efficient and easier to reason about than visiting every marker after each
checkbox change.

The map view keeps:

```text
type ID -> LayerGroup
POI ID  -> Marker
```

Marker creation occurs once after data load. Filtering only adds or removes
existing type groups.

### 18.3 Tooltip behavior

Create one shared `L.tooltip` in `map_view.js`, configured with `permanent` set
to `false`, direction `top`, and a small upward offset. Do not bind one tooltip
instance to every marker. On a marker click or touch event:

1. Build the tooltip's DOM content for that marker's POI.
2. Set the shared tooltip's geographic position to the marker position.
3. Record the selected POI ID.
4. Open the tooltip on the map.

This produces a click-open tooltip anchored to the selected pin and avoids
thousands of tooltip objects. Configure each circle marker with
`bubblingMouseEvents: false` so its click does not immediately invoke the map's
close-tooltip handler. The tooltip is not hover-opened, because hover is
unavailable on touch screens.

The tooltip displays:

1. POI name as the heading.
2. POI type as required metadata.
3. Level, comment, and availability when non-null.

Create DOM elements and assign all upstream-derived values through
`textContent`. Never interpolate source data into an HTML string.

Reusing the shared instance closes the previously displayed content. Clicking
the map closes the current tooltip and clears the selected POI ID. If a filter
hides the selected marker's type, close its tooltip before removing its layer.

## 19. Page layout and interaction

The application fills the viewport. A filter panel overlays or sits beside the
map depending on available width:

- At desktop widths, show a fixed-width panel on the left and map on the right.
- At narrow widths, show a collapsible panel above the map or as a modal
  drawer, leaving most of the viewport available for touch panning.

The map container must have an explicit computed height; otherwise Leaflet
renders into a zero-height element.

Provide visible Leaflet zoom controls. Browser wheel, mouse drag, keyboard,
and touch interactions use Leaflet's standard behavior. Do not disable page
zoom or add a restrictive viewport meta setting.

Use semantic elements for headings and controls. Visible focus indicators must
remain enabled. Color is not the only representation of a filter type because
every colored marker and checkbox also has a text label or accessible name.

## 20. Loading and failure states

The page has three top-level states:

### 20.1 Loading

Display `Loading map data...` while JSON is requested and parsed. The map may
initialize before data finishes loading, but filter controls remain disabled.

### 20.2 Ready

Remove the loading message, enable filters, and show a compact POI count. The
count reflects currently visible POIs and the total number of POIs.

### 20.3 Error

Display a persistent error panel if Leaflet is unavailable, JSON fails to
load, validation fails, or map initialization throws. The message tells the
operator to check the browser console and confirms that the page must be
served over HTTP.

Do not catch and ignore individual marker errors. Data is validated before
rendering so a render failure indicates an implementation defect and should be
visible.

Missing individual tiles use Leaflet's error behavior and are reported in the
console. A future enhancement may provide a local error tile, but that is not
required for prototype acceptance.

## 21. Performance considerations

The current source contains many thousands of POIs. The shared canvas avoids a
DOM element per marker, but construction and hit testing still have a cost.
The prototype implementation follows this staged policy:

1. Implement canvas markers and type-layer grouping, then measure load time
   with the complete generated dataset.
2. If initial marker construction exceeds two seconds on a representative
   desktop browser, create markers in batches using animation frames so the UI
   remains responsive.
3. If panning remains visibly unresponsive, create markers only for types that
   are currently visible and discard them when their type is hidden.
4. If that remains insufficient, design a spatial index and viewport culling
   strategy as a follow-up. This is a measured optimization, not an unplanned
   change to the JSON contract.

Clustering is not the default because it obscures the primary prototype goal:
visually validating individual coordinate placement. Labels beyond the pin
and click tooltip are also avoided because thousands of permanent text labels
would obscure the map.

The design keeps the data contract and filter model independent of the marker
renderer, so a rendering optimization does not require regenerating POI data.

## 22. Testing strategy

### 22.1 Converter unit tests

Use Python's [`unittest`](https://docs.python.org/3/library/unittest.html).
Tests cover:

- Extraction of all supported allowlisted assignments.
- Nested objects and brackets inside strings.
- Rejection of missing, duplicate, or non-JSON assignments.
- HTML-to-text conversion and whitespace normalization.
- Raw and Paldex coordinate conversions.
- Y-axis inversion.
- Map-boundary points.
- Missing, invalid, boolean, NaN, and infinite coordinates.
- Canonical identity construction for records with upstream IDs.
- Canonical identity construction for records without upstream IDs.
- Exact first-six-byte, unpadded-base64url ID encoding.
- Compact-ID stability across array reordering.
- Compact-ID stability when comments or display names change.
- Truncated-hash collision and ambiguous-duplicate failure.
- Identical-record deduplication.
- Deterministic POI and type ordering.
- Source hashing and data-version construction.
- Null game version and supplied game version.
- Atomic output behavior when conversion fails.

Fixtures must be small hand-written source files. Unit tests must not download
PalDB data.

### 22.2 Tile generator tests

Create a small synthetic square image with distinct colored quadrants. Tests
verify:

- A missing `magick` executable produces an actionable error.
- ImageMagick 6 and a build without WebP read/write support are rejected.
- Input-dimension validation.
- Expected zoom directories and tile counts.
- Correct tile X/Y orientation.
- Exact output dimensions.
- Lossless WebP encoding and quality 100 recorded in the manifest.
- Manifest fields, source digest, and reported ImageMagick version.
- Repeated generation removes stale files.
- ImageMagick failure diagnostics are propagated without publishing staging
  output.
- A failed run leaves the previous complete output intact.

Tests use a temporary directory and never overwrite repository assets.
Generate the synthetic fixture with ImageMagick. Tests verify structural
output and recorded encoder settings; they do not independently prove the
pixel-level behavior of ImageMagick's lossless encoder.

### 22.3 JSON artifact validation

After generating real data, run the converter in strict mode for release
candidates. Review any non-strict warnings before accepting an upstream
update. Automated validation checks:

- Every ID is unique.
- Every POI references an existing type.
- Every position is finite and inside bounds.
- Type and POI arrays are sorted.
- Summary counts match actual arrays.
- The recorded source digest matches the input snapshot.

### 22.4 Browser integration checklist

Serve the repository with a static server, for example:

```shell
python3 -m http.server 8000
```

Then verify in each supported browser:

1. The initial map fits in the viewport.
2. All map edges are reachable through panning.
3. The user cannot lose the map irretrievably outside the viewport.
4. Wheel, control-button, keyboard, and touch zoom work where applicable.
5. Tiles remain correctly oriented at every zoom level.
6. `Show all` and `Hide all` update pins and counts.
7. Each individual type checkbox affects only its type.
8. Clicking a pin opens an anchored tooltip.
9. Tooltip name and type match the source record.
10. Optional details appear only when present.
11. Hiding the selected type closes its tooltip.
12. No runtime request is made to PalDB, a CDN, or a hosted map service.
13. Reloading resets filters to all-visible as designed.
14. Narrow-screen layout leaves the map usable.

### 22.5 Coordinate acceptance test

The prototype passes coordinate validation only when:

- At least ten geographically distributed calibration records pass their
  automated numeric tolerance.
- The same records pass a visual inspection at native zoom.
- At least two calibration records use source `ipos` coordinates.
- At least two use source `pos` coordinates.
- At least two represent newer outlying land areas.
- There is no consistent axis inversion, rotation, scale, or offset error.

Record the reviewed calibration IDs and result in the prototype completion
notes.

## 23. Operational workflow

### 23.1 Initial preparation

1. Install ImageMagick 7 with WebP read/write support and verify `magick` is
   available on `PATH`.
2. Obtain and record a local PalDB source snapshot.
3. Run `process_poi.py` with complete provenance arguments.
4. Review warnings and summary counts.
5. Run converter and artifact tests.
6. Run `generate_tiles.py` against `world_map.webp`.
7. Verify the tile manifest and tests.
8. Serve the repository over HTTP.
9. Complete browser and coordinate acceptance checks.

### 23.2 Updating PalDB data

1. Download the new source to a new temporary or source-snapshot path.
2. Calculate and compare its SHA-256 digest with the current JSON metadata.
3. If identical, do not regenerate or change the data version.
4. If different, run the converter with the new provenance metadata.
5. Review added, removed, changed, excluded, and deduplicated counts.
6. Investigate every stable-ID collision or parser failure.
7. Compare representative existing IDs to ensure progress compatibility.
8. Repeat coordinate calibration, particularly for new regions.
9. Replace `poi_data.json` only after validation succeeds.

The converter should eventually provide a comparison report, but a dedicated
diff command is not required for the prototype.

## 24. Security and privacy

The prototype stores no user data and sends no application telemetry.

Primary security controls are:

- Never execute the upstream JavaScript.
- Permit only expected JSON-compatible assignments.
- Convert all upstream markup to plain text during preparation.
- Use `textContent` for runtime rendering of upstream strings.
- Vendor runtime dependencies instead of loading mutable remote scripts.
- Keep source and generated coordinates numeric and finite.
- Restrict output replacement to explicit, validated paths.
- Invoke ImageMagick with an argument list and `shell=False`.

The HTTP server remains responsible for normal static-site headers. A strict
Content Security Policy is desirable after vendored Leaflet behavior and CSS
requirements are known, but it is not a prototype acceptance blocker.

## 25. Accessibility

The prototype must satisfy these baseline behaviors:

- Every filter is a labeled native checkbox.
- All buttons have visible text or an accessible name.
- Keyboard focus is visible.
- Tooltips use readable text contrast and do not depend only on color.
- The map has an accessible label explaining that it is interactive.
- The filter panel remains operable at 200 percent browser zoom.

An interactive image map cannot convey every spatial relationship to a screen
reader in the prototype. Canvas POI pins are pointer and touch targets, not
individual keyboard focus targets. A future searchable, keyboard-operable POI
list would provide equivalent access but is outside this milestone.

## 26. Alternatives considered

### 26.1 Loading one full image

Leaflet can display `world_map.webp` through an image overlay. This is simpler,
but a tile pyramid gives predictable incremental loading and matches the
intended production direction. Tile generation is therefore included in the
prototype preparation workflow.

### 26.2 Mapbox, MapLibre, or OpenLayers

These libraries can display custom tiles. Mapbox may introduce service tokens
or licensing concerns depending on the products used. MapLibre and OpenLayers
are capable alternatives but provide more surface area than this simple image
coordinate map needs. Leaflet is selected for the smallest straightforward
implementation, not as a permanent product constraint.

### 26.3 Parsing with Node.js

Executing or importing PalDB JavaScript through Node.js would conflict with
the project's Node-free goal and would execute an upstream program. A narrow
Python data extractor is safer and easier to validate.

### 26.4 Runtime coordinate transformation

The browser could transform every source coordinate. This would duplicate
source-specific logic in the runtime and make generated artifacts harder to
inspect. Precomputing map positions keeps the runtime contract simple while
retaining original coordinates for diagnostics.

### 26.5 IDs based on array indexes

Indexes are easy to generate but change whenever PalDB inserts or reorders
records. They would invalidate future user progress. Deterministic semantic
IDs are required despite the additional converter logic.

### 26.6 Pillow for tile generation

Pillow can perform the required WebP decoding, resizing, cropping, and
encoding directly inside Python. It would also make pixel assertions easy to
write. It was not selected because it adds a third-party Python package solely
for preparation-time image operations. Using the established ImageMagick
command-line interface keeps both Python utilities standard-library-only and
makes image processing independently usable from the command line.

## 27. Risks and mitigations

### 27.1 Upstream format changes

Risk: PalDB changes variable names or stops using JSON-compatible literals.

Mitigation: Fail conversion loudly, retain the previous generated JSON, and
update the parser only after reviewing the new source structure.

### 27.2 Coordinate drift

Risk: New regions or map artwork use bounds different from the config values.

Mitigation: Preserve both coordinate systems, maintain distributed calibration
fixtures, and require visual checks after data or map updates.

### 27.3 Stable identity changes

Risk: PalDB changes raw coordinates or upstream IDs for an existing POI.

Mitigation: Prefer upstream IDs, avoid derived display fields, compare IDs
between releases, and add an explicit ID migration table during the MVP if
real-world updates demonstrate that it is needed.

### 27.4 Marker volume

Risk: Thousands of canvas paths and associated Leaflet layers cause slow
loading, hit testing, or panning.

Mitigation: Group by type, measure with the complete dataset, lazily create
markers if needed, and design spatial indexing only when measurements justify
it.

### 27.5 Ambiguous POI categories

Risk: `iconLookup` lacks an entry or changes category names.

Mitigation: Preserve the exact POI type, default missing categories to
`Other`, and generate filter controls from the normalized dataset rather than
hard-coding the current list.

### 27.6 ImageMagick output differences

Risk: Different ImageMagick or WebP delegate versions produce different file
bytes or resized pixels even with equivalent settings.

Mitigation: Record the exact ImageMagick version, quality setting, and source
digest in the manifest, and review unexpected tile changes when preparation
environments change. Byte-for-byte equality of compressed WebP files is not a
requirement.

## 28. Prototype acceptance criteria

The prototype is complete when all of these statements are true:

1. A documented Python command converts a local PalDB script into valid,
   deterministic `poi_data.json` without executing JavaScript.
2. The JSON contains schema, data, source digest, retrieval, and optional game
   version metadata.
3. Every emitted POI has a unique stable ID and both source and map positions.
4. A documented Python command generates a complete local lossless-WebP tile
   pyramid and manifest from `world_map.webp` without a second lossy encoding.
5. The application makes no runtime request outside its static-file origin.
6. The map can be viewed, panned, and zoomed on desktop and touch layouts.
7. Exact POI types can be independently shown and hidden.
8. Clicking or touching a pin opens an anchored tooltip containing at least
   its name and type.
9. Calibration records meet the numeric and visual acceptance rules.
10. Converter, tile-generator, and artifact tests pass.
11. The browser checklist passes in current Firefox, Chromium, and Safari.
12. The complete output works through a generic static HTTP server without
    Node.js, server-side code, or deployment-time processing.

## 29. Implementation sequence

Implement in this order because each step validates an assumption required by
the next:

1. Add small PalDB fixtures and the bracket-aware extractor.
2. Add plain-text normalization and source-field validation.
3. Add stable identity generation and its collision tests.
4. Add coordinate conversion and calibration fixtures.
5. Add JSON serialization, provenance, summaries, and atomic output.
6. Generate and review the first complete POI artifact.
7. Implement and test the tile generator.
8. Vendor Leaflet and build the basic tiled map.
9. Add normalized JSON loading and validation.
10. Add markers, per-type layer groups, and filters.
11. Add anchored tooltips and optional details.
12. Add responsive layout, loading states, and error states.
13. Measure full-dataset marker performance and optimize only if required.
14. Complete automated, browser, and visual-coordinate acceptance testing.

This sequence makes coordinate and data correctness observable before UI work
can accidentally hide conversion defects.
