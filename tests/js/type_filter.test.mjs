import assert from "node:assert/strict";
import test from "node:test";

import {createTypeFilter} from "../../web/js/type_filter.js";


class FakeElement
{
    constructor(tag_name)
    {
        this.tagName = tag_name.toUpperCase();
        this.children = [];
        this.listeners = new Map();
        this.style = {};
        this.checked = false;
        this.className = "";
        this.textContent = "";
    }

    append(...children)
    {
        this.children.push(...children);
    }

    addEventListener(type, listener)
    {
        this.listeners.set(type, listener);
    }

    replaceChildren(...children)
    {
        this.children = children;
    }
}


function elementsByTag(root, tag_name)
{
    const matches = root.tagName === tag_name.toUpperCase() ? [root] : [];
    for(const child of root.children)
    {
        matches.push(...elementsByTag(child, tag_name));
    }
    return matches;
}


test("type labels show synchronized done and total counts", () =>
{
    globalThis.document = {
        createElement: (name) => new FakeElement(name),
    };
    const root = new FakeElement("section");
    const types = [
        {
            id: "type_a",
            name: "Type A",
            category: "Category",
            pin_color: "#123456",
        },
        {
            id: "type_b",
            name: "Type B",
            category: "Category",
            pin_color: "#654321",
        },
    ];
    const pois = [
        {id: "PoiA0001", type_id: "type_a"},
        {id: "PoiA0002", type_id: "type_a"},
        {id: "PoiB0001", type_id: "type_b"},
    ];
    const filter = createTypeFilter(
        root, types, pois, () => {}, new Set(["type_a"])
    );
    const labels = elementsByTag(root, "label");
    assert.deepEqual(labels.map((label) => label.textContent), [
        "Type A (0/2 done)",
        "Type B (0/1 done)",
    ]);

    filter.setCompletedIds(["PoiA0001", "Unknown1"]);
    assert.deepEqual(labels.map((label) => label.textContent), [
        "Type A (1/2 done)",
        "Type B (0/1 done)",
    ]);

    filter.setPoiCompleted("PoiA0002", true);
    filter.setPoiCompleted("PoiB0001", true);
    assert.deepEqual(labels.map((label) => label.textContent), [
        "Type A (2/2 done)",
        "Type B (1/1 done)",
    ]);

    filter.setPoiCompleted("PoiA0001", false);
    assert.equal(labels[0].textContent, "Type A (1/2 done)");
    assert.throws(
        () => filter.setPoiCompleted("bad", true), TypeError
    );
});
