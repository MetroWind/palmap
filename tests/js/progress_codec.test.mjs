import assert from "node:assert/strict";
import test from "node:test";

import {
    MAX_PROGRESS_IDS,
    ProgressFormatError,
    parseProgressFile,
    parseStoredProgress,
    serializeProgressFile,
    serializeStoredProgress,
} from "../../web/js/progress_codec.js";


const EXPORTED_AT = "2026-08-15T20:15:30.000Z";
const DATA_VERSION = "2026-08-14-f7f85133";
const IDS = ["EnZc1kqJ", "abc_DEF-"];


function progressFile(overrides = {})
{
    return JSON.stringify({
        format: "palmap-progress",
        schema_version: 1,
        exported_at: EXPORTED_AT,
        poi_data_version: DATA_VERSION,
        completed_poi_ids: IDS,
        ...overrides,
    });
}


function assertFormatError(callback, pattern)
{
    assert.throws(callback, (error) =>
    {
        assert(error instanceof ProgressFormatError);
        assert.match(error.message, pattern);
        return true;
    });
}


test("stored progress accepts empty state and round trips", () =>
{
    const parsed = parseStoredProgress(
        '{"schema_version":1,"completed_poi_ids":[]}'
    );
    assert.deepEqual([...parsed.completed_ids], []);
    assert(Object.isFrozen(parsed));
    const serialized = serializeStoredProgress(["abc_DEF-", "EnZc1kqJ"]);
    assert.equal(serialized, '{"schema_version":1,'
        + '"completed_poi_ids":["EnZc1kqJ","abc_DEF-"]}');
    assert.deepEqual(
        [...parseStoredProgress(serialized).completed_ids],
        ["EnZc1kqJ", "abc_DEF-"]
    );
});


test("progress export has exact deterministic bytes and round trips", () =>
{
    const input = new Set(["abc_DEF-", "EnZc1kqJ"]);
    const before = [...input];
    const text = serializeProgressFile(input, DATA_VERSION, EXPORTED_AT);
    assert.equal(text, JSON.stringify({
        format: "palmap-progress",
        schema_version: 1,
        exported_at: EXPORTED_AT,
        poi_data_version: DATA_VERSION,
        completed_poi_ids: ["EnZc1kqJ", "abc_DEF-"],
    }, null, 2) + "\n");
    const parsed = parseProgressFile(text);
    assert.deepEqual([...parsed.completed_ids], ["EnZc1kqJ", "abc_DEF-"]);
    assert.equal(parsed.exported_at, EXPORTED_AT);
    assert.equal(parsed.poi_data_version, DATA_VERSION);
    assert.deepEqual([...input], before);
});


test("progress parser rejects non-object and wrong-format roots", () =>
{
    for(const text of ["null", "12", "[]", '"text"'])
    {
        assertFormatError(() => parseProgressFile(text), /Palmap progress/);
    }
    assertFormatError(
        () => parseProgressFile(progressFile({format: "other"})),
        /Palmap progress/
    );
    assertFormatError(() => parseProgressFile("{"), /not valid JSON/);
});


test("progress parser requires exact schema version", () =>
{
    for(const schema_version of [undefined, true, 0, 2, "1"])
    {
        assertFormatError(
            () => parseProgressFile(progressFile({schema_version})),
            /schema version/
        );
    }
});


test("progress parser validates timestamp and data version", () =>
{
    for(const exported_at of [null, "2026-08-15", "2026-02-30T00:00:00.000Z"])
    {
        assertFormatError(
            () => parseProgressFile(progressFile({exported_at})),
            /exported_at/
        );
    }
    for(const poi_data_version of [null, "", "x".repeat(129)])
    {
        assertFormatError(
            () => parseProgressFile(progressFile({poi_data_version})),
            /poi_data_version/
        );
    }
});


test("progress parser validates the completed ID array", () =>
{
    for(const completed_poi_ids of [null, {}, "EnZc1kqJ"])
    {
        assertFormatError(
            () => parseProgressFile(progressFile({completed_poi_ids})),
            /must be an array/
        );
    }
    for(const invalid of [12, "short", "too-long-1", "bad$id!!"])
    {
        assertFormatError(() => parseProgressFile(progressFile({
            completed_poi_ids: [invalid],
        })), /not a valid POI ID/);
    }
    assertFormatError(() => parseProgressFile(progressFile({
        completed_poi_ids: ["EnZc1kqJ", "EnZc1kqJ"],
    })), /duplicate POI ID EnZc1kqJ/);
});


test("progress parser enforces the completed ID count bound", () =>
{
    const ids = Array.from({length: MAX_PROGRESS_IDS}, (_, index) =>
        index.toString(36).padStart(8, "0")
    );
    assert.equal(parseProgressFile(progressFile({
        completed_poi_ids: ids,
    })).completed_ids.size, MAX_PROGRESS_IDS);
    assertFormatError(() => parseProgressFile(progressFile({
        completed_poi_ids: [...ids, "ZZZZZZZZ"],
    })), /more than 50000/);
});


test("unknown fields are ignored and inputs are not mutated", () =>
{
    const root = {
        format: "palmap-progress",
        schema_version: 1,
        exported_at: EXPORTED_AT,
        poi_data_version: DATA_VERSION,
        completed_poi_ids: [...IDS],
        unknown: {nested: true},
    };
    const before = structuredClone(root);
    const parsed = parseProgressFile(JSON.stringify(root));
    assert.equal(parsed.completed_ids.size, 2);
    assert.deepEqual(root, before);
});


test("the codec does not accept a byte-order mark", () =>
{
    assertFormatError(
        () => parseProgressFile(`\uFEFF${progressFile()}`),
        /not valid JSON/
    );
});
