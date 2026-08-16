import assert from "node:assert/strict";
import test from "node:test";

import {createMapView} from "../../web/js/map_view.js";


class FakeElement
{
    constructor(tag_name)
    {
        this.tagName = tag_name.toUpperCase();
        this.children = [];
        this.listeners = new Map();
        this.checked = false;
        this.className = "";
        this.textContent = "";
        this.type = "";
    }

    append(...children)
    {
        this.children.push(...children);
    }

    addEventListener(type, listener)
    {
        this.listeners.set(type, listener);
    }

    dispatch(type)
    {
        this.listeners.get(type)?.();
    }
}


class FakeGroup
{
    constructor()
    {
        this.markers = [];
    }

    addTo(map)
    {
        map.layers.add(this);
        return this;
    }
}


class FakeMarker
{
    constructor(position, options)
    {
        this.position = position;
        this.options = options;
        this.listeners = new Map();
        this.opacity = 1;
    }

    on(type, listener)
    {
        this.listeners.set(type, listener);
        return this;
    }

    addTo(group)
    {
        group.markers.push(this);
        return this;
    }

    setOpacity(opacity)
    {
        this.opacity = opacity;
    }

    trigger(type)
    {
        this.listeners.get(type)?.();
    }
}


class FakeCircleMarker extends FakeMarker
{
    constructor(position, options)
    {
        super(position, options);
        this.styles = {...options};
        this.radius = options.radius;
    }

    setStyle(style)
    {
        Object.assign(this.styles, style);
    }

    setRadius(radius)
    {
        this.radius = radius;
    }
}


function findElement(root, tag_name)
{
    if(root.tagName === tag_name.toUpperCase())
    {
        return root;
    }
    for(const child of root.children)
    {
        const found = findElement(child, tag_name);
        if(found !== null)
        {
            return found;
        }
    }
    return null;
}


function installBrowserFakes()
{
    const markers = [];
    const fake_map = {
        events: new Map(),
        layers: new Set(),
        zoom: 4,
        closeTooltip: () => {},
        fitBounds: () => {},
        getZoom()
        {
            return this.zoom;
        },
        hasLayer(layer)
        {
            return this.layers.has(layer);
        },
        invalidateSize: () => {},
        on(type, listener)
        {
            this.events.set(type, listener);
        },
        removeLayer(layer)
        {
            this.layers.delete(layer);
        },
    };
    const tooltip = {
        content: null,
        openOn: () => {},
        setContent(content)
        {
            this.content = content;
            return this;
        },
        setLatLng()
        {
            return this;
        },
    };
    class FakeTileLayer
    {
        addTo()
        {
            return this;
        }

        static extend(definition)
        {
            return class extends FakeTileLayer
            {
                getTileUrl(coordinates)
                {
                    return definition.getTileUrl.call(this, coordinates);
                }
            };
        }
    }
    globalThis.document = {
        createElement: (name) => new FakeElement(name),
    };
    globalThis.L = {
        CRS: {Simple: {}},
        CircleMarker: FakeCircleMarker,
        DomEvent: {disableClickPropagation: () => {}},
        TileLayer: FakeTileLayer,
        canvas: () => ({}),
        circleMarker: (position, options) =>
        {
            const marker = new FakeCircleMarker(position, options);
            markers.push(marker);
            return marker;
        },
        icon: (options) => options,
        latLngBounds: () => ({pad: () => ({})}),
        layerGroup: () => new FakeGroup(),
        map: () => fake_map,
        marker: (position, options) =>
        {
            const marker = new FakeMarker(position, options);
            markers.push(marker);
            return marker;
        },
        tooltip: (options) =>
        {
            tooltip.options = options;
            return tooltip;
        },
    };
    return {fake_map, markers, tooltip};
}


function poi(id, type_id, type_name, name)
{
    return {
        id,
        type_id,
        type_name,
        name,
        map_position: {x: 100, y: 100},
        details: {level: null, comment: null, availability: null},
    };
}


test("completion styles all marker kinds and drives the tooltip", () =>
{
    const browser = installBrowserFakes();
    const requests = [];
    const view = createMapView({}, {
        portraitPins: {Chillet: "images/pal_pins/chillet.png"},
        onCompletionRequest: (id, completed) =>
        {
            requests.push([id, completed]);
        },
    });
    const types = [
        {id: "generic", pin_color: "#123456"},
        {id: "bounty", pin_color: "#123456"},
        {id: "alpha", pin_color: "#123456"},
    ];
    view.setPois([
        poi("Generic1", "generic", "Generic", "Generic place"),
        poi("Bounty01", "bounty", "Bounty", "Bounty place"),
        poi("Alpha001", "alpha", "Alpha Pal", "Chillet"),
    ], types);
    assert.equal(browser.tooltip.options.interactive, true);
    assert.equal(browser.markers.length, 3);

    view.setCompletedIds(["Generic1", "Bounty01", "Alpha001", "Unknown1"]);
    assert.equal(browser.markers[0].styles.fillOpacity, 0.25);
    assert.equal(browser.markers[0].styles.opacity, 0.5);
    assert.equal(browser.markers[1].opacity, 0.45);
    assert.equal(browser.markers[2].opacity, 0.45);

    browser.fake_map.zoom = 6;
    browser.fake_map.events.get("zoomend")();
    assert.equal(browser.markers[0].styles.fillOpacity, 0.25);
    assert.equal(browser.markers[0].styles.opacity, 0.5);

    browser.markers[1].trigger("click");
    const checkbox = findElement(browser.tooltip.content, "input");
    assert.equal(checkbox.checked, true);
    checkbox.checked = false;
    checkbox.dispatch("change");
    assert.deepEqual(requests, [["Bounty01", false]]);
    view.setPoiCompleted("Bounty01", false);
    assert.equal(checkbox.checked, false);
    assert.equal(browser.markers[1].opacity, 1);
});


test("completion state applies before later marker creation", () =>
{
    const browser = installBrowserFakes();
    const view = createMapView({});
    view.setCompletedIds(["Generic1"]);
    view.setPois([
        poi("Generic1", "generic", "Generic", "Generic place"),
    ], [{id: "generic", pin_color: "#123456"}]);
    assert.equal(browser.markers[0].styles.fillOpacity, 0.25);
    assert.throws(() => view.setPoiCompleted("bad", true), TypeError);
});
