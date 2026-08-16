import {isPoiId} from "./poi_id.js";


/** Maximum number of completed IDs in one progress document. */
export const MAX_PROGRESS_IDS = 50000;


/** Identifies invalid or unsupported Palmap progress data. */
export class ProgressFormatError extends Error
{
    /** Creates a progress-format error safe to display to a user. */
    constructor(message, options)
    {
        super(message, options);
        this.name = "ProgressFormatError";
    }
}


function parseJson(text, label)
{
    if(typeof text !== "string")
    {
        throw new ProgressFormatError(`${label} must be text.`);
    }
    try
    {
        return JSON.parse(text);
    }
    catch(error)
    {
        throw new ProgressFormatError(`${label} is not valid JSON.`, {
            cause: error,
        });
    }
}


function requireObject(value, message)
{
    if(value === null || typeof value !== "object" || Array.isArray(value))
    {
        throw new ProgressFormatError(message);
    }
}


function validateSchemaVersion(root)
{
    if(root.schema_version !== 1)
    {
        const version = Number.isInteger(root.schema_version)
            ? ` ${root.schema_version}` : "";
        throw new ProgressFormatError(
            `Progress schema version${version} is not supported.`
        );
    }
}


function validateIds(value)
{
    if(!Array.isArray(value))
    {
        throw new ProgressFormatError(
            "completed_poi_ids must be an array."
        );
    }
    if(value.length > MAX_PROGRESS_IDS)
    {
        throw new ProgressFormatError(
            `Progress contains more than ${MAX_PROGRESS_IDS} POI IDs.`
        );
    }
    const completed_ids = new Set();
    for(let index = 0; index < value.length; ++index)
    {
        const id = value[index];
        if(!isPoiId(id))
        {
            throw new ProgressFormatError(
                `completed_poi_ids[${index}] is not a valid POI ID.`
            );
        }
        if(completed_ids.has(id))
        {
            throw new ProgressFormatError(
                `Progress file contains duplicate POI ID ${id}.`
            );
        }
        completed_ids.add(id);
    }
    return completed_ids;
}


function idsFromIterable(completed_ids)
{
    if(completed_ids === null || completed_ids === undefined
        || typeof completed_ids[Symbol.iterator] !== "function")
    {
        throw new ProgressFormatError("Completed POI IDs must be iterable.");
    }
    return validateIds([...completed_ids]);
}


function sortedIds(completed_ids)
{
    return [...idsFromIterable(completed_ids)].sort();
}


function validateDataVersion(value)
{
    if(typeof value !== "string" || value.length === 0
        || value.length > 128)
    {
        throw new ProgressFormatError(
            "poi_data_version must be a non-empty string of at most 128 "
                + "characters."
        );
    }
}


function validateTimestamp(value)
{
    if(typeof value !== "string")
    {
        throw new ProgressFormatError(
            "exported_at must be a canonical UTC timestamp."
        );
    }
    const date = new Date(value);
    if(!Number.isFinite(date.valueOf()) || date.toISOString() !== value)
    {
        throw new ProgressFormatError(
            "exported_at must be a canonical UTC timestamp."
        );
    }
}


/** Parses and validates a local-storage progress value. */
export function parseStoredProgress(text)
{
    const root = parseJson(text, "Saved progress");
    requireObject(root, "Saved progress must be an object.");
    validateSchemaVersion(root);
    return Object.freeze({
        completed_ids: validateIds(root.completed_poi_ids),
    });
}


/** Serializes IDs for local storage in deterministic order. */
export function serializeStoredProgress(completed_ids)
{
    return JSON.stringify({
        schema_version: 1,
        completed_poi_ids: sortedIds(completed_ids),
    });
}


/** Parses and validates an imported progress document. */
export function parseProgressFile(text)
{
    const root = parseJson(text, "Progress file");
    requireObject(root, "This is not a Palmap progress file.");
    if(root.format !== "palmap-progress")
    {
        throw new ProgressFormatError(
            "This is not a Palmap progress file."
        );
    }
    validateSchemaVersion(root);
    validateTimestamp(root.exported_at);
    validateDataVersion(root.poi_data_version);
    return Object.freeze({
        exported_at: root.exported_at,
        poi_data_version: root.poi_data_version,
        completed_ids: validateIds(root.completed_poi_ids),
    });
}


/** Serializes a version 1 progress export. */
export function serializeProgressFile(
    completed_ids, poi_data_version, exported_at
)
{
    validateTimestamp(exported_at);
    validateDataVersion(poi_data_version);
    return JSON.stringify({
        format: "palmap-progress",
        schema_version: 1,
        exported_at,
        poi_data_version,
        completed_poi_ids: sortedIds(completed_ids),
    }, null, 2) + "\n";
}
