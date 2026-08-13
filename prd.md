# Palmap

Palmap is a web app of an interactive map for the video game Palworld.
It is a static webpage that contains a zoomable map
(think Google Maps) of the Palworld world map, with places of interest
on it.

## Data

- World map image: `world_map.webp`. Source:
  https://palworld.wiki.gg/wiki/File:World_Map.webp
- Geo data: https://paldb.cc/js/map_data_en.js
- Coordinates transformation:
  https://github.com/palworldlol/palworld-coord/raw/refs/heads/main/DEV.md

The source geo data are processed by a Python utility during development or
release preparation. The utility produces a normalized JSON file that the web
app can load directly. Processing includes:

- Extracting the required places of interest from the source JavaScript
- Normalizing fields and place types
- Assigning each place a stable, unique ID
- Transforming source coordinates into map coordinates
- Validating records and reporting malformed or unsupported data

IDs should use stable identifiers from the source data when available. When
the source has no suitable identifier, the utility should generate a
deterministic ID from stable source attributes, including the original source
coordinates. IDs must not depend on array order or transformed map
coordinates, so saved user progress remains valid when data are regenerated
or the map projection changes.

The generated JSON format must have a schema version. The source data used to
generate it should be recorded so upstream changes can be identified.

## Deployment

The deployed application consists entirely of static files and can be served
by a generic HTTP server. It must not require Node.js, server-side processing,
or a deployment-time build step.

Development and release preparation may use Python utilities to normalize
source data, transform coordinates, and generate map tiles. The generated
JSON, map tiles, and other required assets are included in the deployed static
files.

## Project milestones

- Prototype: a proof of concept of the geo data and the coordinate
  transformation. Shows that the geo data are pinned on the map
  correctly
- MVP

## Prototype requirements

- User can view, pan, zoom the map
- Places of interest are labeled on the map as pins
- User can hide/show different types of places
- A representative set of known locations across the map is used to verify
  that transformed coordinates place pins correctly
- The generated project can be hosted on an HTTP server as static
  files
- User can click on a pin to open a tooltip anchored to that pin
- The tooltip displays the place name and type. It may display other relevant
  details available in the source data at the implementor's discretion

## MVP requirements

- User can mark a place of interest as “done”, meaning they have
  visited/finished the place
- User’s progress is saved in the browser’s local storage using stable place
  IDs
- User can export and import their progress as files
- The progress file format is versioned, and imported data are validated
  before they replace or modify saved progress
- Places of interest have appropriate icons
