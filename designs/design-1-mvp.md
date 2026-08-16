# Palmap MVP Technical Design

## 1. Document status

- Status: Proposed
- Scope: MVP milestone
- Product requirements: [`prd.md`](../prd.md)
- Predecessor: [`design-0-prototype.md`](design-0-prototype.md)
- Runtime language: browser-native JavaScript
- Runtime deployment model: static files served over HTTP
- Preparation language: Python 3

This document defines the implementation required to advance the completed
Palmap prototype to the MVP milestone. The prototype already proves map
rendering, coordinate transformation, POI filtering, anchored tooltips,
stable POI IDs, static deployment, and custom pin rendering. The MVP adds
durable per-POI completion state and portable progress files without changing
the map-data or coordinate contracts.

The design is intentionally implementation-specific. Module boundaries,
public functions, JSON fields, validation rules, state transitions, error
behavior, and test cases are specified so implementation does not require
inventing additional product behavior.

## 2. Existing baseline

The implementation begins from the current prototype, not from the original
prototype proposal. The following behavior is complete and remains in place:

- `web/data/poi_data.json` contains stable eight-character POI IDs.
- `web/js/poi_repository.js` validates the normalized POI dataset.
- `web/js/map_view.js` creates markers, groups them by exact type, and owns
  the shared anchored tooltip.
- `web/js/type_filter.js` renders the type filter sidebar.
- `web/js/pin_catalog.js` maps POI types to local pin assets.
- Alpha Pal markers use locally generated portrait pins with level labels.
- Types without shared artwork use deterministic colored circle markers.
- All runtime files are static assets below `web/`.

The PRD's requirement that POIs have appropriate icons is considered
satisfied by this baseline. The MVP must preserve and regression-test these
icons, but it must not source new icons, redesign existing icons, change icon
generation, or replace generic markers. Additional icon work is outside this
design.

## 3. Goals

The MVP must provide all of the following:

1. Let the user mark any POI as done or not done from its anchored tooltip.
2. Show the current done state whenever that POI's tooltip is open.
3. Give completed markers a visible, consistent map treatment.
4. Persist completion state in browser `localStorage` using stable POI IDs.
5. Restore persisted completion state on the next page load.
6. Export all saved completion IDs to a versioned JSON file.
7. Import a versioned JSON progress file selected by the user.
8. Validate an imported file completely before changing memory or storage.
9. Ask for confirmation before imported progress replaces current progress.
10. Preserve well-formed IDs that do not exist in the current POI dataset.
11. Keep the application usable for the current session when local storage is
    unavailable, while clearly warning that changes are not durable.
12. Continue to deploy as static files without Node.js, a backend, accounts,
    or a deployment-time build.

## 4. Non-goals

The MVP will not provide:

- More icon research, downloads, generation, or visual redesign.
- User accounts, cloud synchronization, or server-side storage.
- Authentication, authorization, or sharing links.
- Real-time collaboration.
- Progress synchronization between different browsers or devices except
  through explicit export and import.
- Multiple named profiles or save slots.
- Per-type bulk completion controls.
- A clear-all button. A validated empty import can replace progress, but a
  dedicated destructive control is not required.
- Automatic merging during import. MVP import has explicit replacement
  semantics.
- Notes, timestamps, completion order, or completion percentages by type.
- Migration of one stable POI ID to another. Unknown IDs are preserved so a
  future migration feature can recover them.
- Changes to `process_poi.py`, the normalized POI schema, coordinate
  transformation, map tiles, or Alpha Pal generation.
- A JavaScript package manager, bundler, or application framework.

## 5. Requirements traceability

| PRD requirement | Design response |
|---|---|
| Mark a POI done | Labeled checkbox in the existing anchored tooltip |
| Save progress locally | Versioned state under one `localStorage` key |
| Use stable IDs | State stores only validated normalized POI IDs |
| Export progress | User-triggered JSON `Blob` download |
| Import progress | File picker, bounded read, parse, validate, confirm |
| Version file format | Required `format` and `schema_version` fields |
| Validate before mutation | Parser returns normalized data or throws first |
| Appropriate icons | Existing type catalog and Alpha portraits retained |
| Static deployment | Browser APIs only; no runtime or deploy-time server |

## 6. Design principles

### 6.1 One source of truth for progress

The progress store owns the complete set of done POI IDs. The map, tooltip,
summary text, import control, and export control consume store snapshots. They
must not keep independent authoritative sets.

This prevents the map from showing a marker as done while export writes it as
not done. UI components may cache references needed for rendering, but every
state change originates in the store and produces one notification.

### 6.2 Store stable identity, not display data

Persist only POI IDs. Do not store names, types, transformed coordinates,
array indexes, marker URLs, or complete POI records. Those fields can change
without changing the logical place. The prototype deliberately created IDs
that are independent of array order and transformed map coordinates for this
purpose.

### 6.3 Validate before effects

Progress-file parsing is a pure operation. It must finish all structure,
version, size, ID, and duplicate checks before it calls `localStorage`, changes
the in-memory set, updates a marker, or opens a confirmation prompt.

The confirmation prompt occurs after validation because its counts must be
trustworthy. Cancellation has no side effects.

### 6.4 Preserve unknown IDs

A valid ID can be absent from the currently loaded dataset because the user
exported progress against another data version or an upstream POI temporarily
disappeared. Dropping that ID would silently destroy progress.

The store and exported file therefore retain all syntactically valid IDs. The
map uses the intersection between stored IDs and current dataset IDs. The UI
reports how many stored IDs are unavailable in the current map.

### 6.5 Fail soft without claiming persistence

Browsers can deny storage access or exhaust quota. The map must remain usable
in a volatile in-memory mode. It must also show a persistent warning that
changes will not survive reload. It must never report a failed write as saved.

### 6.6 Deterministic serialization

Sort completed IDs by their exact ASCII value before writing storage or an
export file. Serialize with two-space indentation and one trailing newline for
exports. Deterministic output makes files reviewable and avoids meaningless
changes when the user toggles IDs in a different order.

## 7. System overview

The MVP adds three state-oriented modules and one UI module:

```text
poi_data.json ---------------------> poi_repository.js
                                             |
                                             v
                                       current POI IDs

localStorage <----> progress_store.js <----> app.js
                         ^                    |  |
                         |                    |  +--> map_view.js
                         |                    |       - done checkbox
                         |                    |       - marker treatment
                         |                    |
                         |                    +-----> progress_controls.js
                         |                             - summary
                         |                             - import/export actions
                         v
                 progress_codec.js
                         ^
                         |
                 progress_transfer.js
                    ^             |
                    |             v
             selected JSON    downloaded JSON
```

`progress_codec.js` contains pure validation and serialization. Both storage
and file transfer use it, ensuring the ID and version rules cannot drift.

## 8. Browser platform choices

### 8.1 Local storage

Use the browser's
[`localStorage`](https://html.spec.whatwg.org/dev/webstorage.html) because the
state is small, synchronous, origin-scoped, and naturally survives browser
restarts. The state is a single JSON value, so one `setItem()` replaces the
complete previous value rather than exposing partially updated keys.

Local storage is appropriate here because the current dataset has about
14,000 POIs. Even if every ID is complete, compact state remains far below
normal browser quotas. IndexedDB would add asynchronous transactions and a
larger API surface without solving an MVP requirement.

### 8.2 File input and Blob download

Use a native `<input type="file">` for explicit user selection. Read the
selected [`File`](https://www.w3.org/TR/FileAPI/) with `File.text()`, which is
asynchronous and avoids blocking on file-system I/O.

Use a UTF-8 JSON `Blob`, `URL.createObjectURL()`, and a temporary anchor with
the `download` attribute for export. Revoke the object URL after triggering
the download so the browser can release its backing memory.

### 8.3 JSON

Progress files follow [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259).
Export UTF-8 without a byte-order mark. Import may strip one leading U+FEFF so
files rewritten by common text editors remain usable; a BOM anywhere else is
invalid JSON.

### 8.4 Leaflet

Continue using the existing shared `L.tooltip`. Enable its `interactive`
option so the native done checkbox can receive pointer and keyboard input.
Use Leaflet's marker opacity and circle style methods documented in the
[Leaflet API reference](https://leafletjs.com/reference.html).

## 9. Repository layout

The MVP adds these files while retaining the existing structure:

```text
web/
|-- index.html
|-- css/
|   `-- palmap.css
`-- js/
    |-- app.js
    |-- map_view.js
    |-- poi_id.js
    |-- progress_codec.js
    |-- progress_controls.js
    |-- progress_store.js
    |-- progress_transfer.js
    `-- ...existing modules...

tests/
`-- js/
    |-- progress_codec.test.mjs
    `-- progress_store.test.mjs
```

`poi_id.js` centralizes the eight-character ID predicate currently embedded
in `poi_repository.js`. Both POI-data validation and progress validation must
import it.

No generated file belongs in `web/data/` for user progress. Progress is
created in the user's browser and is never committed or deployed.

## 10. Terminology and invariants

- **Current ID**: a validated POI ID present in the loaded dataset.
- **Completed ID**: an ID in the progress store's set.
- **Recognized completion**: a completed ID that is also a current ID.
- **Unavailable completion**: a completed ID absent from the current dataset.
- **Persistent mode**: state can be read from and written to local storage.
- **Volatile mode**: state exists only for the current page lifetime.
- **Replacement import**: the imported ID set becomes the entire new set;
  current IDs not present in the file become not done.

The following invariants hold after every successful state transition:

1. Every completed ID is a string matching `^[A-Za-z0-9_-]{8}$`.
2. No completed ID appears more than once.
3. The in-memory representation is a `Set`.
4. Any serialized representation is a sorted JSON array.
5. Completion never changes POI data objects, which remain deeply frozen.
6. Unknown IDs remain in the set until an explicit replacement omits them.
7. A failed or canceled import changes nothing.

## 11. Shared POI ID validation

Create `web/js/poi_id.js`:

```javascript
const POI_ID_PATTERN = /^[A-Za-z0-9_-]{8}$/;


/** Returns whether a value is a normalized Palmap POI ID. */
export function isPoiId(value)
{
    return typeof value === "string" && POI_ID_PATTERN.test(value);
}
```

`poi_repository.js` must replace its private pattern with this function.
`progress_codec.js` must use the same function. Keeping one predicate prevents
a progress file from accepting an ID the dataset loader would reject.

Do not export the mutable `RegExp` object. Exporting only the predicate keeps
callers from changing `lastIndex` or coupling themselves to the exact regular
expression implementation.

## 12. Local-storage contract

### 12.1 Storage key

Use exactly:

```text
palmap.progress.v1
```

The version suffix prevents a future incompatible state representation from
being confused with version 1. It does not replace the version inside the
JSON; both are intentional. The key selects the broad reader, while the field
allows that reader to reject corrupt or unexpected content.

### 12.2 Stored JSON

The value has this exact required shape:

```json
{
  "schema_version": 1,
  "completed_poi_ids": [
    "EnZc1kqJ",
    "abc_DEF-"
  ]
}
```

Required fields:

- `schema_version`: integer `1`; booleans are not integers for this contract.
- `completed_poi_ids`: array of unique valid POI ID strings.

Unknown object fields are ignored for forward-compatible additive metadata.
Missing required fields, duplicate IDs, invalid IDs, arrays at the root, or
unsupported schema versions make the stored value invalid.

Do not store `data_version`. Progress intentionally survives data updates.
Do not store timestamps because the MVP does not expose completion chronology.

### 12.3 Empty state

An absent key means a valid empty state, not an error. It is equivalent to:

```json
{"schema_version":1,"completed_poi_ids":[]}
```

The implementation may defer writing this empty object until the first
change. Merely opening Palmap must not create storage data.

## 13. Progress file contract

### 13.1 Version 1 document

The exported file has this shape:

```json
{
  "format": "palmap-progress",
  "schema_version": 1,
  "exported_at": "2026-08-15T20:15:30.000Z",
  "poi_data_version": "2026-08-14-f7f85133",
  "completed_poi_ids": [
    "EnZc1kqJ",
    "abc_DEF-"
  ]
}
```

Required fields:

- `format`: exact string `palmap-progress`.
- `schema_version`: integer `1`.
- `exported_at`: a valid canonical UTC timestamp produced by
  `Date.prototype.toISOString()`.
- `poi_data_version`: non-empty string no longer than 128 code units.
- `completed_poi_ids`: unique valid IDs, sorted on export.

The format marker prevents a random JSON file with a coincidental
`schema_version` and array from being accepted. The data version is diagnostic
only. A mismatch warns the user but does not block import.

Unknown fields are ignored when schema version 1 is otherwise valid. This
allows a future writer to add optional descriptive metadata without breaking
the MVP reader.

### 13.2 File name and MIME type

Export with MIME type `application/json;charset=utf-8` and filename:

```text
palmap-progress-YYYY-MM-DD.json
```

The date is derived from the same UTC `exported_at` value. The filename does
not include user input or POI data, avoiding invalid path characters and
privacy leaks.

### 13.3 Import bounds

Define:

```javascript
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_PROGRESS_IDS = 50000;
```

Reject a file larger than 2 MiB before calling `File.text()`. After parsing,
reject more than 50,000 IDs. These limits are comfortably above the current
complete dataset while bounding memory, parse time, duplicate checks, and
confirmation-message counts for an untrusted local file.

Do not trust `File.type`; operating systems often leave it empty or infer it
from the extension. `accept="application/json,.json"` is only a picker hint.
Actual acceptance depends on content validation.

## 14. `progress_codec.js`

This module is pure: it accesses no DOM, storage, clock, network, or file
object. That makes every data rule directly unit-testable.

Public interface:

```javascript
/** Parses and validates a local-storage progress value. */
export function parseStoredProgress(text) {}

/** Serializes IDs for local storage in deterministic order. */
export function serializeStoredProgress(completed_ids) {}

/** Parses and validates an imported progress document. */
export function parseProgressFile(text) {}

/** Serializes a version 1 progress export. */
export function serializeProgressFile(
    completed_ids, poi_data_version, exported_at
) {}
```

Each parser returns a frozen plain record containing a new `Set`. It never
returns an array owned by the parsed JSON object. Each serializer accepts any
iterable, validates it with the same rules as import, sorts it, and returns a
string.

### 14.1 Root-object validation

A root object is valid only when it is non-null, has type `object`, and is not
an array. Read only explicitly named properties. Do not spread, merge, or
assign the imported root into an application object. This avoids treating
special names such as `__proto__` as configuration.

### 14.2 ID-array algorithm

Validate `completed_poi_ids` in this order:

1. Require an actual array.
2. Reject if length exceeds `MAX_PROGRESS_IDS`.
3. Create an empty `Set`.
4. For each array entry in order, require `isPoiId(entry)`.
5. Reject if the set already contains the entry.
6. Add the entry.
7. Return the set only after the loop completes.

Rejecting duplicates catches malformed generators and makes counts
unambiguous. Silently deduplicating would conceal input defects.

### 14.3 Timestamp validation

Require the timestamp to be a string and satisfy both:

```javascript
const date = new Date(value);
Number.isFinite(date.valueOf()) && date.toISOString() === value
```

This accepts the canonical millisecond UTC form written by Palmap and rejects
rollover dates, local-zone strings, and ambiguous formats.

### 14.4 Error type

Define `ProgressFormatError extends Error` and export it. Its public message is
safe to show through `textContent`. Messages identify the failed field but
must not echo the entire file or arbitrary imported strings.

Examples:

- `Progress file is not valid JSON.`
- `This is not a Palmap progress file.`
- `Progress schema version 2 is not supported.`
- `completed_poi_ids[14] is not a valid POI ID.`
- `Progress file contains duplicate POI ID EnZc1kqJ.`

The parser may include one validated eight-character ID in an error. It must
not include arbitrary objects or long values.

## 15. `progress_store.js`

### 15.1 Responsibilities

The store:

- loads and validates local state;
- owns the in-memory `Set`;
- persists complete snapshots when possible;
- exposes mutation methods;
- notifies subscribers after state changes;
- listens for changes from another tab on the same origin; and
- reports persistence failures without crashing the map.

The store does not know the current POI dataset, create UI, read files, or
download exports.

### 15.2 Constructor API

```javascript
/** Creates the browser progress store and loads its initial state. */
export function createProgressStore(options = {}) {}
```

Options:

- `storage`: defaults to `window.localStorage`; tests inject a fake object.
- `event_target`: defaults to `window`; tests inject an `EventTarget` or null.
- `onWarning(message)`: receives user-facing persistence warnings.

The returned frozen interface provides:

```javascript
{
    completedIds(),
    isCompleted(id),
    setCompleted(id, completed),
    replace(completed_ids),
    subscribe(listener),
    persistenceMode(),
    dispose()
}
```

Every public item receives an intention comment in the implementation.

### 15.3 State snapshots

`completedIds()` returns a new `Set`; callers cannot mutate store state.
`isCompleted()` validates its ID argument and returns a boolean.

Subscribers receive a frozen event:

```javascript
{
    completed_ids: new Set(...),
    changed_ids: new Set(...),
    source: "local" | "import" | "storage",
    persistence_mode: "persistent" | "volatile" | "incompatible"
}
```

The sets are fresh snapshots. A subscriber must not retain and mutate them.
`changed_ids` is the symmetric difference between old and new state. Local
single-ID changes therefore update one marker rather than all markers.

`subscribe(listener)` returns an unsubscribe function. `dispose()` removes
the storage-event listener and clears subscribers.

### 15.4 Persistence modes

The store has three modes:

1. `persistent`: local storage loaded successfully and accepts writes.
2. `volatile`: storage is inaccessible or a write failed; in-memory changes
   continue but are not guaranteed after reload.
3. `incompatible`: the key contains invalid or unsupported data. The store
   preserves that raw value and refuses to overwrite it through ordinary
   checkbox changes.

For an absent or valid stored value, start in persistent mode. For a thrown
`SecurityError` while obtaining or reading storage, start empty in volatile
mode. For parse or schema errors, start empty in incompatible mode and show a
warning explaining that existing browser progress was not overwritten.

A confirmed import is explicit replacement authority. `replace()` may attempt
to overwrite incompatible state. If successful, mode becomes persistent. If
it fails, imported state remains available in memory in volatile mode and the
user receives a warning.

### 15.5 Mutation algorithm

For `setCompleted(id, completed)`:

1. Validate `id` and require `completed` to be boolean.
2. Return without notification if state already has the requested value.
3. Clone the current set and add or delete the ID.
4. Serialize the complete clone before changing store state.
5. In persistent mode, call `storage.setItem()` once.
6. If writing throws, switch to volatile mode and call `onWarning()`.
7. In incompatible mode, skip storage and retain that mode.
8. Commit the clone to memory.
9. Notify subscribers with source `local` and the one changed ID.

Serialization happens before state mutation so an internal validation defect
cannot leave a partially updated in-memory store.

`replace(ids)` follows the same steps but validates the complete iterable,
calculates a symmetric difference, and labels the event source `import`.

### 15.6 Cross-tab updates

Listen for the HTML `storage` event. Process an event only when:

- `event.storageArea` is the configured storage;
- `event.key` equals `palmap.progress.v1`; and
- the event came from another document, as guaranteed by the platform.

If `newValue` is null, treat it as an empty valid state. Otherwise parse it
with `parseStoredProgress()`. A valid value replaces memory without writing it
back and emits source `storage`. Invalid external content is ignored and
reported; it must not clear the current in-memory state.

Cross-tab support prevents a stale tab from remaining visibly inconsistent.
Concurrent writes still use last-writer-wins semantics because local storage
does not provide compare-and-swap transactions. Collaborative editing is not
an MVP goal.

## 16. `progress_transfer.js`

This module adapts browser file APIs to the pure codec.

Public interface:

```javascript
/** Reads and validates one user-selected progress file. */
export async function readProgressFile(file) {}

/** Downloads the current progress as a versioned JSON file. */
export function downloadProgress(
    completed_ids, poi_data_version, options = {}
) {}
```

### 16.1 Import read algorithm

1. Require `file` to be a `File`-like object with numeric `size` and a
   `text()` function.
2. Reject `size > MAX_IMPORT_BYTES` before reading.
3. Await `file.text()` inside `try/catch`.
4. Remove exactly one leading U+FEFF if present.
5. Pass the complete string to `parseProgressFile()`.
6. Return the codec's normalized result.

Wrap file-system read failures as `ProgressTransferError` with message
`The selected progress file could not be read.` Preserve the original error
as `cause` for console diagnostics.

### 16.2 Export algorithm

1. Capture one `Date` and call `toISOString()` once.
2. Serialize with `serializeProgressFile()`.
3. Construct a UTF-8 JSON `Blob`.
4. Create an object URL.
5. Create an anchor, set its `href` and deterministic `download` filename.
6. Append it to `document.body`, invoke `click()`, and remove it.
7. Schedule `URL.revokeObjectURL()` after the click task.

Dependencies such as clock, document, and URL implementation may be injected
through `options` for tests. Export never reads or writes local storage; the
caller passes one store snapshot.

## 17. `progress_controls.js`

This module owns the progress summary and import/export controls, not progress
state. It receives callbacks and snapshots from `app.js`.

Public constructor:

```javascript
/** Binds progress transfer controls and returns their update interface. */
export function createProgressControls(element, options) {}
```

Required options:

- `onExport()`: called by the export button.
- `onImport(file)`: asynchronous callback returning an import preview.
- `onConfirmImport(preview)`: applies a previously validated preview.

Returned methods:

- `setCounts(done, total, unavailable)`.
- `setPersistenceMode(mode)`.
- `showMessage(message, kind)`.
- `setEnabled(enabled)`.

The implementation may instead bind fixed child IDs, but state and callbacks
must follow this boundary.

## 18. HTML structure

Add a compact progress section between `.panel-header` and `.filters`:

```html
<section id="progress-panel" class="progress-panel"
         aria-labelledby="progress-heading">
    <h2 id="progress-heading">Progress</h2>
    <p id="progress-summary" aria-live="polite">0 places done</p>
    <div class="progress-actions">
        <button id="export-progress" type="button">Export progress</button>
        <label class="button" for="import-progress">Import progress</label>
        <input id="import-progress" class="visually-hidden" type="file"
               accept="application/json,.json">
    </div>
    <p id="progress-message" class="progress-message" role="status"></p>
</section>
```

The styled label activates a real file input. It must retain the input's
keyboard and screen-reader accessibility. `.visually-hidden` hides visually
without `display: none`, which would remove it from accessibility behavior in
some combinations of browser and assistive technology.

Controls are disabled until POI data, portrait pins, progress store, and map
view initialize successfully.

## 19. Progress summary

Compute counts from:

```text
recognized_done = size(completed IDs intersect current dataset IDs)
unavailable = size(completed IDs minus current dataset IDs)
total = current dataset POI count
```

Display:

```text
123 of 13,808 places done
```

When unavailable is nonzero, append:

```text
 · 4 saved places unavailable in this map version
```

Use `toLocaleString()` for displayed counts. Count computation may iterate
the completed set and test a `Set` of current IDs, making it O(number of saved
IDs) rather than O(all POIs).

The unavailable suffix explains why export count can exceed visible done
count. It also proves unknown IDs were preserved rather than discarded.

## 20. Import interaction

### 20.1 Selection and validation

On file-input change:

1. Read the first selected file; multiple selection is disabled.
2. Disable both transfer controls while reading.
3. Clear the previous transient message.
4. Call `readProgressFile(file)`.
5. Calculate recognized and unavailable imported counts against current IDs.
6. Compare `poi_data_version` with the loaded dataset version.
7. Construct a validated preview object.
8. Re-enable controls in `finally`.
9. Reset `input.value = ""` so selecting the same file again fires `change`.

No store method is called during these steps.

### 20.2 Confirmation

Use `window.confirm()` for the MVP rather than introducing a custom modal.
The message contains only validated values:

```text
Replace current progress with this file?

120 places match this map.
3 saved IDs are unavailable and will be preserved.
The file was exported from data version 2026-08-14-f7f85133.

This replaces 42 currently saved IDs.
```

If data versions match, omit the version warning. If the imported set is
empty, state clearly that confirmation will clear current progress.

Canceling ends the operation with a neutral `Import canceled.` message.
Confirming calls `store.replace(imported.completed_ids)` exactly once.

### 20.3 Success and failure messages

After replacement, show:

```text
Imported 123 saved places; 120 are available on this map.
```

If the store is volatile, append that imported progress is available only for
this session. Parsing, validation, read, and size errors appear in the
progress message with error styling and are logged with their causes. Current
progress remains unchanged.

Do not use `alert()` for errors; the persistent inline status is less
disruptive and remains available for review.

## 21. Export interaction

When the user activates export:

1. Take one snapshot from `store.completedIds()`.
2. Read `data.data_version` from the validated POI dataset.
3. Call `downloadProgress()` with both values.
4. Show `Exported N saved places.` on success.
5. Show an error message if Blob creation or download setup throws.

Export includes unavailable IDs because they are still valid saved progress.
It is permitted when the store is volatile; exporting is the user's way to
preserve session-only progress.

Disable export only while an import read or another export setup is in
progress. An empty set is valid and exports a usable empty progress file.

## 22. `map_view.js` changes

### 22.1 Completion callback

Add an option to `createMapView()`:

```javascript
onCompletionRequest(poi_id, completed)
```

The map calls it when the tooltip checkbox changes. The map does not update
the progress store directly and does not assume persistence succeeded.

### 22.2 Public completion methods

Extend the returned interface:

```javascript
/** Replaces the complete visual completion set. */
setCompletedIds(completed_ids)

/** Updates one POI's visual completion state. */
setPoiCompleted(poi_id, completed)
```

`setCompletedIds()` is used during startup, import, and cross-tab replacement.
It validates every ID, stores a private set, and updates every existing
marker. Unknown IDs remain in the private set but have no marker.

`setPoiCompleted()` is used for granular notifications. It updates the
private set, the one marker if present, and the open tooltip checkbox if that
POI is selected.

### 22.3 Marker-state helper

Implement one named function rather than duplicating marker checks:

```javascript
function applyCompletionStyle(marker, completed) {}
```

For `L.Marker` image pins, call `marker.setOpacity(completed ? 0.45 : 1)`.
For `L.CircleMarker`, retain existing fill color and use:

```text
completed: fillOpacity 0.25, opacity 0.5
open:      fillOpacity 0.8,  opacity 1
```

Zoom-dependent radius and weight remain controlled by the existing zoom
handler. Completion styling must not reset radius or weight.

Completed markers are muted rather than replaced. This keeps custom artwork
recognizable and avoids adding another asset or marker layer for every POI.
The tooltip's native checkbox communicates state without relying on opacity
or color alone.

### 22.4 Marker creation

Immediately apply the current completion state after each marker is created.
This matters if `setCompletedIds()` runs before a future lazy marker creation
optimization. Marker creation and completion state must be order-independent.

## 23. Tooltip changes

Append a progress control after the existing details:

```html
<label class="poi-completion">
    <input type="checkbox">
    <span>Done</span>
</label>
```

The checkbox is checked from the map view's private completion set. On
`change`, call `onCompletionRequest(poi.id, input.checked)`.

Configure the shared tooltip with `interactive: true`. Call
`L.DomEvent.disableClickPropagation(root)` on its root content so clicking the
checkbox does not immediately trigger the map's close handler. Map clicks
outside the tooltip continue to close it.

When the store notification returns, `setPoiCompleted()` sets the checkbox to
the authoritative state. This also corrects the checkbox if a callback rejects
an invalid request or cross-tab state arrives while the tooltip is open.

All POI-derived text continues to use `textContent`. The completion label is
static application text.

## 24. `app.js` orchestration

Startup proceeds in this order:

1. Resolve all required DOM elements.
2. Show `Loading map data...` and disable progress controls.
3. Load POI data and Alpha Pal pin manifest concurrently.
4. Build a `Set` of current POI IDs.
5. Create the progress store with a warning callback.
6. Create the map view with `onCompletionRequest` bound to
   `store.setCompleted()`.
7. Populate POIs and types.
8. Apply `store.completedIds()` through `view.setCompletedIds()`.
9. Create type filters and apply default visibility.
10. Bind import and export controls.
11. Subscribe to store changes.
12. Render initial progress and visibility summaries.
13. Enable controls.

The subscription handler performs these steps:

1. For each `changed_id`, call `view.setPoiCompleted()` using membership in
   the event snapshot.
2. Recalculate recognized and unavailable counts.
3. Update the progress summary.
4. Update persistence warnings if mode changed.

On fatal startup failure, preserve existing behavior: show the application
error, leave transfer controls disabled, and log the original error.

Register a page lifecycle cleanup that calls `store.dispose()` only if the
application already has a suitable cleanup path. Adding unload work solely to
dispose a page-lifetime listener is optional because the document and listener
are collected together.

## 25. Styling and responsive layout

Add styles for:

- `.progress-panel`: compact border-bottom section below the header.
- `.progress-actions`: wrapping flex row for import and export.
- `.button`: shared visual treatment for button-like labels.
- `.visually-hidden`: standard one-pixel clipped accessible hiding.
- `.progress-message.error`: high-contrast error color.
- `.progress-message.warning`: high-contrast warning color.
- `.poi-completion`: spaced, clickable checkbox row in the tooltip.

On narrow screens, keep the progress section inside the collapsible sidebar
so it does not cover the map independently. Collapsing the panel hides both
filters and progress controls, or the existing collapse selector must be
expanded from `.filters` to a wrapper containing both.

Buttons and the import label must wrap rather than overflow at 200 percent
zoom. Do not reduce native checkbox target size.

## 26. Dataset updates and compatibility

Stable IDs are the compatibility boundary. On a new POI dataset:

- IDs still present retain completion automatically.
- New IDs begin not done.
- Removed IDs become unavailable but stay saved and exported.
- A later dataset that restores an ID restores its done state automatically.

`poi_data_version` in an export informs the user about mismatch but never
changes this algorithm. The date or digest must not be used to discard state.

If a future source update changes an ID for the same logical POI, MVP cannot
infer equivalence. The old ID remains unavailable. A future explicit migration
table may map old ID to new ID, but heuristic matching by name or coordinates
is prohibited because it could mark the wrong place done.

## 27. Error handling

### 27.1 Invalid stored state

Show a persistent warning:

```text
Saved progress uses an unsupported or invalid format. It was not overwritten.
Import a valid progress file to replace it.
```

Start with empty in-memory state in incompatible mode. Ordinary checkbox
changes are session-only and do not destroy the raw stored value.

### 27.2 Storage unavailable

Catch errors from accessing `window.localStorage`, `getItem()`, and
`setItem()`. Show:

```text
Progress storage is unavailable. Changes will last only for this tab.
```

Do not disable completion controls or export.

### 27.3 Import errors

Differentiate:

- file too large;
- file read failure;
- invalid JSON;
- wrong format marker;
- unsupported schema;
- invalid timestamp or data version;
- invalid or duplicate ID; and
- excessive ID count.

All failures occur before confirmation and state replacement.

### 27.4 Export errors

If serialization or browser download setup fails, leave state untouched and
show `Progress could not be exported.` Log the cause. Always attempt object URL
revocation in cleanup once a URL exists.

## 28. Accessibility

The done control is a labeled native checkbox. This exposes checked state,
keyboard operation, and a large click target without custom ARIA state.

The progress summary uses `aria-live="polite"`; routine toggles do not
interrupt current speech. The message element uses `role="status"` for import,
export, and persistence results. Do not place `role="alert"` on every progress
message because repeated toggles would be disruptive.

Import is a native file input activated by a visible label. Export is a native
button. Focus indicators must match existing controls. Disabling controls
must use their native `disabled` property; visual opacity alone is
insufficient.

Completed map markers are muted, but the state is also exposed through the
tooltip checkbox and progress text. This follows the principle behind
[WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html):
visual color or intensity is not the sole state communication.

After import, focus remains on the import control. Do not move focus to the
map. Native `confirm()` manages its own focus while open.

## 29. Security and privacy

Progress is private local data. The application must not transmit, fetch,
beacon, or log the completed ID list. Export occurs only after a user gesture,
and import reads only the explicitly selected file.

Security controls:

- Bound file size before reading.
- Parse with `JSON.parse()`; never evaluate file text.
- Read only expected root fields.
- Validate every ID and reject duplicates.
- Never insert imported strings through `innerHTML`.
- Do not use an imported filename as a download name or HTML fragment.
- Validate fully before mutation.
- Confirm before replacement.
- Revoke Blob URLs after export.
- Do not include POI names, coordinates, or source metadata beyond the public
  dataset version in a progress file.

Local storage is scoped to the page origin, as defined by the HTML storage
model. Serving Palmap from a different origin, port, or protocol creates a
different progress area. Clearing site data removes progress. The UI and
README must state these limitations so export is understood as the backup and
transfer mechanism.

## 30. Performance

Expected state size is small:

- At roughly 14,000 IDs, raw ID characters total about 112 KiB.
- JSON punctuation and indentation keep storage and export comfortably below
  the 2 MiB import limit.
- `Set.has()` gives expected constant-time tooltip and marker checks.

Startup performs one O(P) POI-ID set construction and one O(C) completion
intersection, where P is current POIs and C is completed IDs. Applying initial
marker styles is O(P), already dominated by marker creation.

A single checkbox change updates one store entry, serializes O(C) IDs for the
atomic storage snapshot, and restyles one marker. Sorting up to 14,000 short
strings is acceptable for an explicit user action. Do not rewrite all marker
styles for a single toggle.

Import replacement may update every changed marker. Disable transfer controls
during application and update in one synchronous pass. If measurement shows a
visible pause over 100 ms, batch marker restyling with animation frames as a
follow-up without changing store or file contracts.

## 31. Testing strategy

### 31.1 Test environment

Use Node's built-in
[`node:test`](https://nodejs.org/api/test.html) runner for pure JavaScript
modules. This adds no npm package, bundle, or deployed dependency. Node is a
development test tool only; the application still runs and deploys without it.

Keep the existing Python `unittest` suite for generated artifacts and Python
tools.

### 31.2 Codec unit tests

`progress_codec.test.mjs` covers:

- Empty valid storage state.
- Sorted deterministic storage serialization.
- Storage round trip.
- Export round trip.
- Exact format and schema acceptance.
- Null, scalar, and array roots rejected.
- Missing required fields rejected.
- Boolean schema version rejected.
- Future schema version rejected.
- Invalid timestamp rejected.
- Empty or overlong data version rejected.
- Non-array completed IDs rejected.
- Invalid ID type, length, and characters rejected.
- Duplicate ID rejected.
- Exactly `MAX_PROGRESS_IDS` accepted.
- More than `MAX_PROGRESS_IDS` rejected.
- Unknown extra fields ignored.
- One leading BOM accepted by transfer adaptation, not codec JSON itself.
- No state object is mutated by parsing or serialization.

Inject a fixed date so expected export bytes are exact.

### 31.3 Store unit tests

Use a small fake Storage implementation and injected event target. Cover:

- Absent key starts empty and persistent without writing.
- Valid key restores all IDs, including IDs unknown to any dataset.
- Invalid stored JSON enters incompatible mode and is not overwritten by a
  normal checkbox change.
- Unsupported stored schema behaves the same way.
- Storage getter or `getItem()` failure starts volatile.
- `setCompleted()` adds, removes, persists, and emits exact changed IDs.
- Idempotent set emits and writes nothing.
- `setItem()` failure switches to volatile while retaining session state.
- Confirmed replacement overwrites incompatible state when storage succeeds.
- Replacement emits the symmetric difference.
- Valid storage event replaces state without writing it back.
- Null storage-event value means empty state.
- Invalid storage event is ignored and warned.
- Unsubscribe and dispose stop notifications.
- Returned sets cannot mutate internal state.

### 31.4 Transfer unit tests

With injected File-like objects and browser dependencies, cover:

- Size checked before `text()` is called.
- File read rejection becomes `ProgressTransferError`.
- Leading BOM removal.
- Blob type, filename date, and exact JSON bytes.
- Anchor is appended, clicked once, and removed.
- Object URL is revoked on success and cleanup paths.

### 31.5 Existing artifact tests

Retain all current icon-artifact tests. Add a lightweight assertion that every
catalog URL points to a checked-in image with declared dimensions. No new icon
assets are required by MVP.

### 31.6 Browser integration checklist

Run in current Firefox, Chromium, and Safari:

1. Mark a generic circle POI done and confirm it becomes muted.
2. Mark a custom icon POI done and confirm it becomes muted.
3. Mark an Alpha Pal done and confirm its portrait becomes muted.
4. Close and reopen the tooltip; checkbox state remains checked.
5. Reload the page; state is restored.
6. Unmark the POI; reload confirms removal persisted.
7. Export empty, partial, and all-current progress.
8. Import the exported file and confirm exact restoration.
9. Cancel import confirmation and confirm no change.
10. Import invalid JSON and confirm no change.
11. Import wrong format and future schema and confirm no change.
12. Import a file with duplicate and malformed IDs and confirm no change.
13. Import a file with unknown IDs; confirm they are reported and re-exported.
14. Import an empty file state and confirm replacement clears progress.
15. Simulate denied storage and confirm volatile warning plus working export.
16. Change state in a second tab and confirm the first tab updates.
17. Verify type filtering does not change completion.
18. Verify done tooltip controls work with keyboard only.
19. Verify progress controls remain usable at 200 percent zoom and mobile
    width.
20. Confirm no progress data appears in network requests.

## 32. Operational behavior

No preparation command changes for the MVP. `process_poi.py`, tile generation,
and pin generation continue as documented in `README.md`.

Before deploying:

1. Run Python tests.
2. Run JavaScript unit tests.
3. Serve `web/` through a local HTTP server.
4. Complete the browser integration checklist.
5. Export progress from the previous deployed version as a safety check.
6. Deploy the complete `web/` directory atomically when practical.
7. Verify the deployed origin is unchanged if existing local progress is
   expected to remain available.

Changing the hostname, scheme, or port changes the storage origin. If a move
is unavoidable, users must export from the old origin and import at the new
origin.

## 33. Alternatives considered

### 33.1 One local-storage key per POI

Rejected because thousands of keys are difficult to enumerate, version, and
export consistently. A crash during bulk import could leave a partial mix.
One versioned JSON snapshot is simpler and atomically replaced by `setItem()`.

### 33.2 Storing full POI records

Rejected because names, coordinates, levels, and artwork are public dataset
state rather than user progress. Duplicating them increases storage, creates
staleness, and weakens stable-ID compatibility.

### 33.3 IndexedDB

Rejected for MVP because state is a small set and replacement is naturally
represented by one local-storage string. IndexedDB becomes relevant only if
progress gains large per-POI notes, attachments, or transaction-heavy data.

### 33.4 Merge-only import

Rejected because users cannot restore an exact backup or intentionally clear
items. Replacement has predictable backup semantics. A future UI may offer
separate `Replace` and `Merge` choices, but version 1 import is replacement.

### 33.5 Dropping unknown IDs

Rejected because temporary source removal would permanently erase completion.
Preservation costs little and supports future restoration or migration.

### 33.6 Custom import modal

Rejected for MVP because it adds focus trapping, escape handling, backdrop,
and accessibility work. Native `confirm()` is blocking but provides clear,
cross-browser confirmation with no dependency.

### 33.7 Encoding done state in POI JSON

Rejected because generated POI data is shared and immutable while progress is
private per browser. Mixing them would prevent static caching and require
regenerating public data for user actions.

### 33.8 New completed-marker artwork

Rejected because current icons are accepted and icon work is complete.
Opacity retains recognizable artwork and avoids another asset matrix.

## 34. Risks and mitigations

### 34.1 Stable IDs change upstream

Risk: a logical POI receives a new ID after source-coordinate or upstream-ID
changes.

Mitigation: preserve old IDs as unavailable, include data version in exports,
and never guess identity from names. Add an explicit migration table only
after verified real examples exist.

### 34.2 Storage is cleared or partitioned

Risk: browser privacy settings, site-data clearing, or origin changes remove
progress.

Mitigation: provide prominent export/import and document origin scope. The
application cannot guarantee browser-managed persistence.

### 34.3 Malformed import destroys progress

Risk: parsing or partial application replaces valid current state.

Mitigation: size bound, pure full validation, preview, confirmation, and one
store replacement only after success.

### 34.4 Quota or security errors

Risk: local storage throws.

Mitigation: catch every storage boundary, continue in volatile mode, warn
persistently, and keep export available.

### 34.5 Marker completion is hard to distinguish

Risk: muted and normal pins look too similar on some map regions.

Mitigation: use a substantial opacity difference, expose exact state through
the checkbox and progress summary, and test custom, portrait, and circle pins.
If testing fails, add a CSS check badge as a separate scoped enhancement; do
not replace icon assets.

### 34.6 Large imports pause the page

Risk: malicious or oversized JSON consumes memory or CPU.

Mitigation: 2 MiB pre-read limit, 50,000-ID post-parse limit, iterative
validation, and no recursive traversal of arbitrary imported content.

### 34.7 Two tabs overwrite each other

Risk: simultaneous last-writer-wins snapshots lose one tab's recent action.

Mitigation: storage events keep idle tabs synchronized and reduce the window.
True conflict-free merging is outside MVP; explicit export remains backup.

## 35. MVP acceptance criteria

The MVP is complete only when all statements are true:

1. Every current POI can be marked done and not done from its tooltip.
2. Done state is visibly reflected on circle, type-image, and Alpha Pal pins.
3. Reloading the same origin restores completion from local storage.
4. State contains stable POI IDs and no duplicated POI display data.
5. A user can export a deterministic version 1 JSON progress file.
6. A user can import that file and exactly replace progress after confirmation.
7. Invalid, unsupported, oversized, unreadable, duplicate-ID, and canceled
   imports leave progress unchanged.
8. Unknown valid IDs survive storage, import, and export and are reported.
9. Storage failure does not break the map and produces an accurate warning.
10. Another tab's valid storage update is reflected without reload.
11. Current pin assets and sidebar icons remain unchanged and functional.
12. Python tests, JavaScript unit tests, and browser checklist pass.
13. Deployment remains a copy of static `web/` files with no Node.js,
    backend, account, or deployment-time build.

## 36. Implementation sequence

Implement in this order because each layer depends only on completed earlier
contracts:

1. Add `poi_id.js` and make POI repository validation use it.
2. Implement `progress_codec.js` and its complete unit tests.
3. Implement `progress_store.js` with fake-storage unit tests.
4. Implement `progress_transfer.js` and transfer tests.
5. Add progress HTML and CSS in a disabled loading state.
6. Implement `progress_controls.js` with validated preview and confirmation.
7. Extend `map_view.js` with completion state and tooltip checkbox.
8. Wire store, map, controls, counts, and warnings in `app.js`.
9. Add cross-tab storage-event handling.
10. Run the existing artifact suite to prove icon and POI regressions did not
    occur.
11. Run JavaScript unit tests and the complete browser checklist.
12. Update `README.md` with progress behavior, storage scope, import/export
    instructions, test commands, and backup guidance.

Do not begin icon work during this sequence. Any newly discovered icon issue
is recorded separately and does not block MVP progress functionality unless
it is a regression caused by these changes.
