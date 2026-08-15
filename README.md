# Palmap prototype

Palmap is a static, interactive map for Palworld. The prototype uses a local
tile pyramid and normalized local POI data. Leaflet 1.9.4 is the only runtime
dependency loaded from a CDN.

## Prepare POI data

Obtain `map_data_en.js` deliberately and retain its response metadata. The
converter parses only five JSON-compatible assignments and never executes the
source JavaScript:

```shell
python3 tools/process_poi.py \
    --input source/map_data_en.js \
    --output web/data/poi_data.json \
    --source-url https://paldb.cc/js/map_data_en.js \
    --retrieved-at 2026-08-14T12:00:00Z
```

## Prepare map tiles

ImageMagick 7 with WebP read/write support is required:
Export `T_WorldMap.png` from the game into the repository root. This local
source texture is ignored by Git; only its generated tiles are committed.

```shell
python3 tools/generate_tiles.py \
    --input T_WorldMap.png \
    --output-dir web/tiles
```

## Prepare Pal portrait pins

Canonical portrait URLs for every current Alpha Pal are recorded in
`source/alpha_pal_portrait_urls.json`.

Download and process a wiki portrait into a 32-by-32 circular pin with a black
background and one-pixel white outline:

```shell
python3 tools/create_pal_pin.py \
    --url 'https://palworld.wiki.gg/images/Chillet_icon.png?format=original' \
    --level 11 \
    --output web/images/pal_pins/chillet.png
```

The tool requires `curl` and ImageMagick 7. It performs all image processing
in one ImageMagick command. Generate the complete checked-in pin set and its
runtime mapping with:

```shell
python3 tools/create_alpha_pal_pins.py \
    --manifest source/alpha_pal_portrait_urls.json \
    --poi-data web/data/poi_data.json \
    --output-dir web/images/pal_pins \
    --runtime-manifest web/data/alpha_pal_pin_urls.json
```

## Serve the map

The generated directories are deployable static assets. Browser modules and
JSON loading are not supported through `file://`:

```shell
python3 -m http.server 8000 --directory web
```

Then open `http://localhost:8000/`. For deployment, copy the contents of
`web/` to the HTTP hosting directory. Run the offline unit tests with:

```shell
python3 -m unittest discover -s tests -v
```

Coordinate conversion is checked at three levels: exact boundary and midpoint
anchors, axis-direction invariants, and a checked-in calibration fixture. A
real-data release must extend the fixture to at least ten recognizable,
distributed locations and visually inspect them at native zoom as specified in
the design.
