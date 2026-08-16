import {
    MAX_PROGRESS_IDS,
    ProgressFormatError,
    parseProgressFile,
    serializeProgressFile,
} from "./progress_codec.js";


/** Maximum accepted progress-file size in bytes. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;


/** Identifies a failure to read or download progress data. */
export class ProgressTransferError extends Error
{
    /** Creates a user-safe transfer error. */
    constructor(message, options)
    {
        super(message, options);
        this.name = "ProgressTransferError";
    }
}


/** Reads and validates one user-selected progress file. */
export async function readProgressFile(file)
{
    if(file === null || typeof file !== "object"
        || !Number.isFinite(file.size) || file.size < 0
        || typeof file.text !== "function")
    {
        throw new ProgressTransferError(
            "The selected progress file is invalid."
        );
    }
    if(file.size > MAX_IMPORT_BYTES)
    {
        throw new ProgressFormatError(
            "The selected progress file is larger than 2 MiB."
        );
    }
    let text;
    try
    {
        text = await file.text();
    }
    catch(error)
    {
        throw new ProgressTransferError(
            "The selected progress file could not be read.", {cause: error}
        );
    }
    if(typeof text !== "string")
    {
        throw new ProgressTransferError(
            "The selected progress file could not be read."
        );
    }
    if(text.startsWith("\uFEFF"))
    {
        text = text.slice(1);
    }
    return parseProgressFile(text);
}


/** Downloads the current progress as a versioned JSON file. */
export function downloadProgress(completed_ids, poi_data_version, options = {})
{
    const DateImplementation = options.DateImplementation ?? Date;
    const document_implementation = options.document ?? document;
    const url_implementation = options.URL ?? URL;
    const BlobImplementation = options.Blob ?? Blob;
    const set_timeout = options.setTimeout ?? setTimeout;
    const exported_at = new DateImplementation().toISOString();
    const content = serializeProgressFile(
        completed_ids, poi_data_version, exported_at
    );
    const blob = new BlobImplementation([content], {
        type: "application/json;charset=utf-8",
    });
    let object_url;
    try
    {
        object_url = url_implementation.createObjectURL(blob);
        const anchor = document_implementation.createElement("a");
        anchor.href = object_url;
        anchor.download = `palmap-progress-${exported_at.slice(0, 10)}.json`;
        document_implementation.body.append(anchor);
        try
        {
            anchor.click();
        }
        finally
        {
            anchor.remove();
        }
        set_timeout(() => url_implementation.revokeObjectURL(object_url), 0);
    }
    catch(error)
    {
        if(object_url !== undefined)
        {
            url_implementation.revokeObjectURL(object_url);
        }
        throw new ProgressTransferError(
            "Progress could not be exported.", {cause: error}
        );
    }
}


// Keep both documented bounds visible to importers of this adaptation module.
export {MAX_PROGRESS_IDS};
