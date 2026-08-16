import {typePin} from "./pin_catalog.js";
import {isPoiId} from "./poi_id.js";


const MAP_SIZE = 256;
const TRANSPARENT_TILE =
    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";


function tooltipContent(poi, completed, on_change)
{
    const root = document.createElement("section");
    root.className = "poi-tooltip";
    const heading = document.createElement("h2");
    heading.textContent = poi.name;
    root.append(heading);
    const type = document.createElement("p");
    type.textContent = poi.type_name;
    root.append(type);
    const fields = [
        ["Level", poi.details.level],
        ["Comment", poi.details.comment],
        ["Available", poi.details.availability],
    ];
    for(const [label, value] of fields)
    {
        if(value !== null)
        {
            const detail = document.createElement("p");
            detail.textContent = `${label}: ${value}`;
            root.append(detail);
        }
    }
    const completion = document.createElement("label");
    completion.className = "poi-completion";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = completed;
    checkbox.addEventListener("change", () => on_change(checkbox.checked));
    completion.append(checkbox);
    const completion_text = document.createElement("span");
    completion_text.textContent = "Done";
    completion.append(completion_text);
    root.append(completion);
    L.DomEvent.disableClickPropagation(root);
    return Object.freeze({root, checkbox});
}


function createLocalTileLayer()
{
    const LocalTiles = L.TileLayer.extend({
        getTileUrl(coordinates)
        {
            const native_zoom = Math.min(coordinates.z, 5);
            const scale = 2 ** (coordinates.z - native_zoom);
            const tile_x = Math.floor(coordinates.x / scale);
            const leaflet_y = Math.floor(coordinates.y / scale);
            const tile_y = leaflet_y + 2 ** native_zoom;
            const limit = 2 ** native_zoom;
            if(tile_x < 0 || tile_x >= limit || tile_y < 0
                || tile_y >= limit)
            {
                return TRANSPARENT_TILE;
            }
            return `tiles/${native_zoom}/${tile_x}/${tile_y}.webp`;
        },
    });
    return new LocalTiles("", {
        tileSize: 256,
        minZoom: 0,
        maxZoom: 7,
        maxNativeZoom: 5,
        noWrap: true,
        bounds: [[0, 0], [MAP_SIZE, MAP_SIZE]],
        attribution: "Map imagery extracted from Palworld",
    });
}


function markerRadius(zoom)
{
    return Math.min(5, Math.max(1.25, (zoom - 1) * 0.75));
}


function markerWeight(zoom)
{
    return zoom >= 5 ? 1.5 : 0.75;
}


function poiIcon(poi, portrait_pins)
{
    let pin;
    if(poi.type_name === "Alpha Pal"
        && Object.hasOwn(portrait_pins, poi.name))
    {
        pin = {
            url: portrait_pins[poi.name],
            size: [32, 32],
        };
    }
    else
    {
        pin = typePin(poi.type_name);
    }
    if(pin === undefined)
    {
        return null;
    }
    return L.icon({
        iconUrl: pin.url,
        iconSize: pin.size,
        iconAnchor: [pin.size[0] / 2, pin.size[1] / 2],
    });
}


function applyCompletionStyle(marker, completed)
{
    if(marker instanceof L.CircleMarker)
    {
        marker.setStyle({
            fillOpacity: completed ? 0.25 : 0.8,
            opacity: completed ? 0.5 : 1,
        });
    }
    else
    {
        marker.setOpacity(completed ? 0.45 : 1);
    }
}


/** Creates and returns the Palmap map view. */
export function createMapView(element, options = {})
{
    if(typeof L === "undefined")
    {
        throw new Error("Leaflet did not load.");
    }
    const bounds = L.latLngBounds([[0, 0], [MAP_SIZE, MAP_SIZE]]);
    const portrait_pins = options.portraitPins ?? Object.freeze({});
    const on_completion_request = options.onCompletionRequest ?? (() => {});
    if(typeof on_completion_request !== "function")
    {
        throw new TypeError("onCompletionRequest must be a function.");
    }
    const map = L.map(element, {
        crs: L.CRS.Simple,
        minZoom: 0,
        maxZoom: 7,
        zoomSnap: 1,
        maxBounds: bounds.pad(0.2),
        maxBoundsViscosity: 1.0,
    });
    createLocalTileLayer().addTo(map);
    const renderer = L.canvas({padding: 0.5});
    const tooltip = L.tooltip({
        permanent: false,
        direction: "top",
        offset: [0, -7],
        interactive: true,
    });
    const groups = new Map();
    const markers = new Map();
    const pois = new Map();
    const completed_ids = new Set();
    let selected_id = null;
    let selected_checkbox = null;
    let visible_types = new Set();

    function closeTooltip()
    {
        map.closeTooltip(tooltip);
        selected_id = null;
        selected_checkbox = null;
    }

    map.on("click", closeTooltip);
    map.on("zoomend", () =>
    {
        const zoom = map.getZoom();
        for(const marker of markers.values())
        {
            if(marker instanceof L.CircleMarker)
            {
                marker.setRadius(markerRadius(zoom));
                marker.setStyle({weight: markerWeight(zoom)});
            }
        }
    });
    map.fitBounds(bounds);

    function setPois(items, types)
    {
        closeTooltip();
        groups.forEach((group) => map.removeLayer(group));
        groups.clear();
        markers.clear();
        pois.clear();
        const colors = new Map(types.map((type) => [type.id, type.pin_color]));
        for(const poi of items)
        {
            let group = groups.get(poi.type_id);
            if(group === undefined)
            {
                group = L.layerGroup();
                groups.set(poi.type_id, group);
            }
            const position = [
                MAP_SIZE - poi.map_position.y,
                poi.map_position.x,
            ];
            const icon = poiIcon(poi, portrait_pins);
            const marker = icon === null
                ? L.circleMarker(position, {
                    renderer,
                    radius: options.markerRadius
                        ?? markerRadius(map.getZoom()),
                    color: "#ffffff",
                    weight: markerWeight(map.getZoom()),
                    fillColor: colors.get(poi.type_id),
                    fillOpacity: 0.8,
                    bubblingMouseEvents: false,
                })
                : L.marker(position, {
                    icon,
                    bubblingMouseEvents: false,
                });
            marker.on("click", () =>
            {
                selected_id = poi.id;
                const content = tooltipContent(
                    poi, completed_ids.has(poi.id), (completed) =>
                    {
                        try
                        {
                            on_completion_request(poi.id, completed);
                        }
                        finally
                        {
                            if(selected_id === poi.id
                                && selected_checkbox !== null)
                            {
                                selected_checkbox.checked =
                                    completed_ids.has(poi.id);
                            }
                        }
                    }
                );
                selected_checkbox = content.checkbox;
                tooltip.setLatLng(position).setContent(content.root);
                tooltip.openOn(map);
            });
            applyCompletionStyle(marker, completed_ids.has(poi.id));
            marker.addTo(group);
            markers.set(poi.id, marker);
            pois.set(poi.id, poi);
        }
        visible_types = new Set(groups.keys());
        groups.forEach((group) => group.addTo(map));
    }

    function setVisibleTypes(type_ids)
    {
        const next = new Set(type_ids);
        if(selected_id !== null)
        {
            const selected = pois.get(selected_id);
            if(selected !== undefined && !next.has(selected.type_id))
            {
                closeTooltip();
            }
        }
        groups.forEach((group, type_id) =>
        {
            const visible = map.hasLayer(group);
            if(next.has(type_id) && !visible)
            {
                group.addTo(map);
            }
            else if(!next.has(type_id) && visible)
            {
                map.removeLayer(group);
            }
        });
        visible_types = next;
    }

    function setCompletedIds(ids)
    {
        const next = new Set();
        for(const id of ids)
        {
            if(!isPoiId(id))
            {
                throw new TypeError("Completed IDs contain an invalid POI ID.");
            }
            next.add(id);
        }
        completed_ids.clear();
        for(const id of next)
        {
            completed_ids.add(id);
        }
        for(const [id, marker] of markers)
        {
            applyCompletionStyle(marker, completed_ids.has(id));
        }
        if(selected_id !== null && selected_checkbox !== null)
        {
            selected_checkbox.checked = completed_ids.has(selected_id);
        }
    }

    function setPoiCompleted(poi_id, completed)
    {
        if(!isPoiId(poi_id) || typeof completed !== "boolean")
        {
            throw new TypeError("A valid POI ID and boolean are required.");
        }
        if(completed)
        {
            completed_ids.add(poi_id);
        }
        else
        {
            completed_ids.delete(poi_id);
        }
        const marker = markers.get(poi_id);
        if(marker !== undefined)
        {
            applyCompletionStyle(marker, completed);
        }
        if(selected_id === poi_id && selected_checkbox !== null)
        {
            selected_checkbox.checked = completed;
        }
    }

    return Object.freeze({
        /** Replaces every POI and type definition in the view. */
        setPois,
        /** Updates the set of visible exact type IDs. */
        setVisibleTypes,
        /** Replaces the complete visual completion set. */
        setCompletedIds,
        /** Updates one POI's visual completion state. */
        setPoiCompleted,
        /** Fits the full source image into the viewport. */
        fitBounds: () => map.fitBounds(bounds),
        /** Recalculates map dimensions after a layout change. */
        invalidateSize: () => map.invalidateSize(),
        /** Returns the number of currently visible POIs. */
        visibleCount: () => [...pois.values()].filter(
            (poi) => visible_types.has(poi.type_id)
        ).length,
    });
}
