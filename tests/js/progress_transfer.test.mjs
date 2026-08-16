import assert from "node:assert/strict";
import test from "node:test";

import {
    MAX_IMPORT_BYTES,
    ProgressTransferError,
    downloadProgress,
    readProgressFile,
} from "../../web/js/progress_transfer.js";


const EXPORTED_AT = "2026-08-15T20:15:30.000Z";


function fileText()
{
    return JSON.stringify({
        format: "palmap-progress",
        schema_version: 1,
        exported_at: EXPORTED_AT,
        poi_data_version: "data-v1",
        completed_poi_ids: ["EnZc1kqJ"],
    });
}


test("file size is checked before reading", async () =>
{
    let reads = 0;
    await assert.rejects(readProgressFile({
        size: MAX_IMPORT_BYTES + 1,
        text: async () =>
        {
            ++reads;
            return fileText();
        },
    }), /larger than 2 MiB/);
    assert.equal(reads, 0);
});


test("file read failures are adapted", async () =>
{
    const cause = new Error("disk failure");
    await assert.rejects(readProgressFile({
        size: 12,
        text: async () => Promise.reject(cause),
    }), (error) =>
    {
        assert(error instanceof ProgressTransferError);
        assert.equal(error.cause, cause);
        return true;
    });
});


test("one leading byte-order mark is removed", async () =>
{
    const parsed = await readProgressFile({
        size: fileText().length + 1,
        text: async () => `\uFEFF${fileText()}`,
    });
    assert.deepEqual([...parsed.completed_ids], ["EnZc1kqJ"]);
});


test("download creates exact blob and temporary anchor", async () =>
{
    let blob_parts;
    let blob_options;
    class FakeBlob
    {
        constructor(parts, options)
        {
            blob_parts = parts;
            blob_options = options;
        }
    }
    let clicked = 0;
    let removed = 0;
    const anchor = {
        click: () => ++clicked,
        remove: () => ++removed,
    };
    let appended;
    const fake_document = {
        body: {append: (element) =>
        {
            appended = element;
        }},
        createElement: (name) =>
        {
            assert.equal(name, "a");
            return anchor;
        },
    };
    let revoked;
    const fake_url = {
        createObjectURL: () => "blob:test",
        revokeObjectURL: (value) =>
        {
            revoked = value;
        },
    };
    class FakeDate
    {
        toISOString()
        {
            return EXPORTED_AT;
        }
    }
    const timeouts = [];
    downloadProgress(
        new Set(["abc_DEF-", "EnZc1kqJ"]), "data-v1", {
            Blob: FakeBlob,
            DateImplementation: FakeDate,
            URL: fake_url,
            document: fake_document,
            setTimeout: (callback) => timeouts.push(callback),
        }
    );
    assert.equal(appended, anchor);
    assert.equal(anchor.href, "blob:test");
    assert.equal(
        anchor.download, "palmap-progress-2026-08-15.json"
    );
    assert.equal(clicked, 1);
    assert.equal(removed, 1);
    assert.equal(blob_options.type, "application/json;charset=utf-8");
    assert.equal(blob_parts.length, 1);
    assert.match(blob_parts[0], /"completed_poi_ids": \[\n    "EnZc1kqJ"/);
    assert(blob_parts[0].endsWith("\n"));
    assert.equal(revoked, undefined);
    timeouts[0]();
    assert.equal(revoked, "blob:test");
});


test("download revokes an object URL on setup failure", () =>
{
    const revoked = [];
    assert.throws(() => downloadProgress([], "data-v1", {
        Blob: class {},
        DateImplementation: class
        {
            toISOString()
            {
                return EXPORTED_AT;
            }
        },
        URL: {
            createObjectURL: () => "blob:test",
            revokeObjectURL: (url) => revoked.push(url),
        },
        document: {
            body: {append: () =>
            {
                throw new Error("append failed");
            }},
            createElement: () => ({}),
        },
    }), ProgressTransferError);
    assert.deepEqual(revoked, ["blob:test"]);
});
