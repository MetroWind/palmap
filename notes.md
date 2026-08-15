# Palmap

## Prototype completion notes

- The calibration fixture contains 12 distributed locations, including 10
  `ipos` records and 2 `pos` records, with newer-island coverage.
- Numeric calibration checks pass with a 16-native-pixel tolerance.
- The initial visual review exposed a raw-axis swap in the projection. The
  converter now maps raw-world Y to image X and inverted raw-world X to image
  Y, matching the Palworld map coordinate convention.
- The current generated artifact contains 13,810 POIs from 13,876 source
  records; 33 identical records were deduplicated and no records were outside
  the extracted game texture's bounds.
- The artifact records data version `2026-08-13-042e8f3a` and source digest
  `042e8f3a98689cdad622fea4417144a13fdd170aa1db206dfaeab270a67186ba`.
- The browser repository validator was executed under Node's native module
  loader with a mocked local fetch and froze the generated POI dataset.
- The original Wiki image required alternate image bounds to register pins
  with its shifted crop. After replacing it with `T_WorldMap.png` extracted
  from the game, the converter again uses the map bounds in the validated
  source configuration. The separate native-pixel fine-correction hook
  remains available but is currently `0,0`, pending in-game calibration.
- Browser review found and corrected a CRS boundary issue: Leaflet requested
  negative tile rows and the pins used top-down image rows as upward-positive
  `CRS.Simple` latitudes. The map view now translates local tile rows and uses
  `[256 - map_position.y, map_position.x]` for marker coordinates.
- Portable Chromium acceptance testing now loads 256-pixel tiles, exercises
  all 70 filters, opens a real canvas-pin tooltip, closes it when its type is
  hidden, zooms the map, and verifies the mobile layout. Its only remote
  requests are the two pinned Leaflet CDN assets.
- Chromium checks now show 82 Alpha Pals and 137 dungeons with the image-bound
  projection and no page errors.
- A Firefox 152.0.3 headless smoke test could not start its renderer in this
  environment (`RenderCompositorSWGL failed mapping default framebuffer`),
  before it issued an HTTP request.
