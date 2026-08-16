const POI_ID_PATTERN = /^[A-Za-z0-9_-]{8}$/;


/** Returns whether a value is a normalized Palmap POI ID. */
export function isPoiId(value)
{
    return typeof value === "string" && POI_ID_PATTERN.test(value);
}
