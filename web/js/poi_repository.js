import {isPoiId} from "./poi_id.js";


function requireObject(value, label)
{
    if(value === null || typeof value !== "object" || Array.isArray(value))
    {
        throw new Error(`${label} must be an object.`);
    }
}


function deepFreeze(value)
{
    if(value !== null && typeof value === "object" && !Object.isFrozen(value))
    {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}


/** Loads and validates the normalized POI dataset. */
export async function loadPoiData(url)
{
    let response;
    try
    {
        response = await fetch(url);
    }
    catch(error)
    {
        throw new Error("Map data could not be requested.", {cause: error});
    }
    if(!response.ok)
    {
        throw new Error(`Map data request failed (${response.status}).`);
    }
    const data = await response.json();
    requireObject(data, "dataset");
    if(data.schema_version !== 1)
    {
        throw new Error("This map data schema is not supported.");
    }
    if(typeof data.data_version !== "string"
        || data.data_version.length === 0 || data.data_version.length > 128)
    {
        throw new Error("Map data has an invalid data version.");
    }
    if(!Array.isArray(data.types) || !Array.isArray(data.pois))
    {
        throw new Error("Map data is missing types or POIs.");
    }
    requireObject(data.map, "map metadata");
    requireObject(data.source, "source metadata");

    const type_ids = new Set();
    for(const type of data.types)
    {
        requireObject(type, "type");
        if(typeof type.id !== "string" || type_ids.has(type.id)
            || typeof type.name !== "string"
            || typeof type.category !== "string"
            || !/^#[0-9a-fA-F]{6}$/.test(type.pin_color))
        {
            throw new Error("Map data contains an invalid or duplicate type.");
        }
        type_ids.add(type.id);
    }

    const poi_ids = new Set();
    for(const poi of data.pois)
    {
        requireObject(poi, "POI");
        requireObject(poi.map_position, "POI position");
        requireObject(poi.details, "POI details");
        const {x, y} = poi.map_position;
        if(!isPoiId(poi.id) || poi_ids.has(poi.id)
            || !type_ids.has(poi.type_id)
            || typeof poi.name !== "string"
            || typeof poi.type_name !== "string"
            || !Number.isFinite(x) || !Number.isFinite(y)
            || x < 0 || x > 256 || y < 0 || y > 256)
        {
            throw new Error("Map data contains an invalid or duplicate POI.");
        }
        poi_ids.add(poi.id);
    }
    return deepFreeze(data);
}


/** Loads and validates the local Alpha Pal portrait-pin mapping. */
export async function loadAlphaPalPins(url)
{
    let response;
    try
    {
        response = await fetch(url);
    }
    catch(error)
    {
        throw new Error("Alpha Pal pins could not be requested.", {
            cause: error,
        });
    }
    if(!response.ok)
    {
        throw new Error(`Alpha Pal pin request failed (${response.status}).`);
    }
    const data = await response.json();
    requireObject(data, "Alpha Pal pin manifest");
    requireObject(data.pins, "Alpha Pal pins");
    if(data.schema_version !== 1)
    {
        throw new Error("This Alpha Pal pin schema is not supported.");
    }
    const urls = new Set();
    for(const [name, pin_url] of Object.entries(data.pins))
    {
        if(name.length === 0 || typeof pin_url !== "string"
            || !/^images\/pal_pins\/[a-z0-9_]+\.png$/.test(pin_url)
            || urls.has(pin_url))
        {
            throw new Error("Alpha Pal pin manifest contains invalid data.");
        }
        urls.add(pin_url);
    }
    return deepFreeze(data.pins);
}
