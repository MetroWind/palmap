const MAP_SIZE = 256;
const TRANSPARENT_TILE =
    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";


function tooltipContent(poi)
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
    return root;
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
        attribution: "Palworld map imagery via Palworld Wiki",
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


/** Creates and returns the Palmap map view. */
export function createMapView(element, options = {})
{
    if(typeof L === "undefined")
    {
        throw new Error("Leaflet did not load.");
    }
    const bounds = L.latLngBounds([[0, 0], [MAP_SIZE, MAP_SIZE]]);
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
    });
    const groups = new Map();
    const markers = new Map();
    const pois = new Map();
    let selected_id = null;
    let visible_types = new Set();

    function closeTooltip()
    {
        map.closeTooltip(tooltip);
        selected_id = null;
    }

    map.on("click", closeTooltip);
    map.on("zoomend", () =>
    {
        const zoom = map.getZoom();
        for(const marker of markers.values())
        {
            marker.setRadius(markerRadius(zoom));
            marker.setStyle({weight: markerWeight(zoom)});
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
            const marker = L.circleMarker(position, {
                renderer,
                radius: options.markerRadius ?? markerRadius(map.getZoom()),
                color: "#ffffff",
                weight: markerWeight(map.getZoom()),
                fillColor: colors.get(poi.type_id),
                fillOpacity: 0.8,
                bubblingMouseEvents: false,
            });
            marker.on("click", () =>
            {
                selected_id = poi.id;
                tooltip.setLatLng(position).setContent(tooltipContent(poi));
                tooltip.openOn(map);
            });
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

    return Object.freeze({
        /** Replaces every POI and type definition in the view. */
        setPois,
        /** Updates the set of visible exact type IDs. */
        setVisibleTypes,
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
