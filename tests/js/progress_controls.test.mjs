import assert from "node:assert/strict";
import test from "node:test";

import {
    createProgressControls,
} from "../../web/js/progress_controls.js";


class FakeClassList
{
    constructor()
    {
        this.values = new Set();
    }

    add(value)
    {
        this.values.add(value);
    }

    toggle(value, force)
    {
        if(force)
        {
            this.values.add(value);
        }
        else
        {
            this.values.delete(value);
        }
    }
}


class FakeControl
{
    constructor()
    {
        this.attributes = new Map();
        this.classList = new FakeClassList();
        this.className = "";
        this.disabled = false;
        this.files = [];
        this.listeners = new Map();
        this.textContent = "";
        this.value = "";
    }

    addEventListener(type, listener)
    {
        this.listeners.set(type, listener);
    }

    setAttribute(name, value)
    {
        this.attributes.set(name, value);
    }

    async dispatch(type)
    {
        await this.listeners.get(type)?.();
    }
}


function fixture()
{
    const elements = {
        "#progress-summary": new FakeControl(),
        "#progress-message": new FakeControl(),
        "#export-progress": new FakeControl(),
        "#import-progress": new FakeControl(),
        "label[for='import-progress']": new FakeControl(),
    };
    return {
        elements,
        panel: {querySelector: (selector) => elements[selector] ?? null},
    };
}


function preview(overrides = {})
{
    return {
        completed_ids: new Set(["EnZc1kqJ", "Unknown1"]),
        recognized: 1,
        unavailable: 1,
        current_saved: 4,
        version_mismatch: true,
        poi_data_version: "old-data",
        ...overrides,
    };
}


test("controls render counts and enforce enabled state", () =>
{
    const {elements, panel} = fixture();
    const controls = createProgressControls(panel, {
        onExport: () => {},
        onImport: () => {},
        onConfirmImport: () => {},
    });
    assert.equal(elements["#export-progress"].disabled, true);
    assert.equal(elements["#import-progress"].disabled, true);
    controls.setCounts(123, 13808, 4);
    assert.match(
        elements["#progress-summary"].textContent,
        /123 of 13,808 places done · 4 saved places unavailable/
    );
    controls.setEnabled(true);
    assert.equal(elements["#export-progress"].disabled, false);
    assert.equal(elements["#import-progress"].disabled, false);
});


test("export invokes its callback once", async () =>
{
    const {elements, panel} = fixture();
    let exports = 0;
    const controls = createProgressControls(panel, {
        onExport: () => ++exports,
        onImport: () => {},
        onConfirmImport: () => {},
    });
    controls.setEnabled(true);
    await elements["#export-progress"].dispatch("click");
    assert.equal(exports, 1);
    assert.equal(elements["#export-progress"].disabled, false);
});


test("a canceled validated import has no replacement effect", async () =>
{
    const {elements, panel} = fixture();
    const confirmations = [];
    let replacements = 0;
    const controls = createProgressControls(panel, {
        confirm: (message) =>
        {
            confirmations.push(message);
            return false;
        },
        onExport: () => {},
        onImport: async () => preview(),
        onConfirmImport: () => ++replacements,
    });
    controls.setEnabled(true);
    elements["#import-progress"].files = [{}];
    elements["#import-progress"].value = "selected";
    await elements["#import-progress"].dispatch("change");
    assert.equal(replacements, 0);
    assert.equal(confirmations.length, 1);
    assert.match(confirmations[0], /1 places match this map/);
    assert.match(confirmations[0], /old-data/);
    assert.match(confirmations[0], /replaces 4 currently saved IDs/);
    assert.equal(
        elements["#progress-message"].textContent, "Import canceled."
    );
    assert.equal(elements["#import-progress"].value, "");
});


test("a confirmed import applies one validated preview", async () =>
{
    const {elements, panel} = fixture();
    let replacement;
    const expected = preview({
        completed_ids: new Set(),
        recognized: 0,
        unavailable: 0,
        version_mismatch: false,
    });
    const controls = createProgressControls(panel, {
        confirm: (message) =>
        {
            assert.match(message, /clear all current progress/);
            assert.doesNotMatch(message, /exported from data version/);
            return true;
        },
        onExport: () => {},
        onImport: async () => expected,
        onConfirmImport: (value) =>
        {
            replacement = value;
        },
    });
    controls.setEnabled(true);
    elements["#import-progress"].files = [{}];
    await elements["#import-progress"].dispatch("change");
    assert.equal(replacement, expected);
});


test("an import error is shown without confirmation", async () =>
{
    const {elements, panel} = fixture();
    let confirmations = 0;
    const original_error = console.error;
    console.error = () => {};
    try
    {
        const controls = createProgressControls(panel, {
            confirm: () =>
            {
                ++confirmations;
                return true;
            },
            onExport: () => {},
            onImport: async () =>
            {
                throw new Error("Invalid progress file.");
            },
            onConfirmImport: () => {},
        });
        controls.setEnabled(true);
        elements["#import-progress"].files = [{}];
        await elements["#import-progress"].dispatch("change");
    }
    finally
    {
        console.error = original_error;
    }
    assert.equal(confirmations, 0);
    assert.equal(
        elements["#progress-message"].textContent,
        "Invalid progress file."
    );
    assert.equal(
        elements["#progress-message"].classList.values.has("error"), true
    );
});
