import {isPoiId} from "./poi_id.js";
import {
    ProgressFormatError,
    parseStoredProgress,
    serializeStoredProgress,
} from "./progress_codec.js";


const STORAGE_KEY = "palmap.progress.v1";
const STORAGE_WARNING = "Progress storage is unavailable. Changes will "
    + "last only for this tab.";
const INCOMPATIBLE_WARNING = "Saved progress uses an unsupported or invalid "
    + "format. It was not overwritten. Import a valid progress file to "
    + "replace it.";


function changedIds(previous, next)
{
    const changed = new Set();
    for(const id of previous)
    {
        if(!next.has(id))
        {
            changed.add(id);
        }
    }
    for(const id of next)
    {
        if(!previous.has(id))
        {
            changed.add(id);
        }
    }
    return changed;
}


function validateId(id)
{
    if(!isPoiId(id))
    {
        throw new TypeError("id must be a valid POI ID.");
    }
}


/** Creates the browser progress store and loads its initial state. */
export function createProgressStore(options = {})
{
    const on_warning = options.onWarning ?? (() => {});
    let storage = options.storage;
    let event_target = options.event_target;
    let completed_ids = new Set();
    let persistence_mode = "persistent";
    const subscribers = new Set();
    let disposed = false;

    try
    {
        if(storage === undefined)
        {
            storage = window.localStorage;
        }
        if(event_target === undefined)
        {
            event_target = window;
        }
        const stored = storage.getItem(STORAGE_KEY);
        if(stored !== null)
        {
            completed_ids = parseStoredProgress(stored).completed_ids;
        }
    }
    catch(error)
    {
        if(error instanceof ProgressFormatError)
        {
            persistence_mode = "incompatible";
            on_warning(INCOMPATIBLE_WARNING);
        }
        else
        {
            persistence_mode = "volatile";
            storage = null;
            on_warning(STORAGE_WARNING);
        }
    }

    function notify(previous, source)
    {
        const event = Object.freeze({
            completed_ids: new Set(completed_ids),
            changed_ids: changedIds(previous, completed_ids),
            source,
            persistence_mode,
        });
        for(const subscriber of subscribers)
        {
            subscriber(event);
        }
    }

    function persist(next, is_replacement)
    {
        const serialized = serializeStoredProgress(next);
        if(persistence_mode !== "persistent" && !is_replacement)
        {
            return;
        }
        if(storage === null)
        {
            return;
        }
        try
        {
            storage.setItem(STORAGE_KEY, serialized);
            if(is_replacement)
            {
                persistence_mode = "persistent";
            }
        }
        catch(error)
        {
            persistence_mode = "volatile";
            on_warning(STORAGE_WARNING);
        }
    }

    function setCompleted(id, completed)
    {
        validateId(id);
        if(typeof completed !== "boolean")
        {
            throw new TypeError("completed must be a boolean.");
        }
        if(completed_ids.has(id) === completed)
        {
            return;
        }
        const previous = completed_ids;
        const next = new Set(previous);
        if(completed)
        {
            next.add(id);
        }
        else
        {
            next.delete(id);
        }
        persist(next, false);
        completed_ids = next;
        notify(previous, "local");
    }

    function replace(ids)
    {
        const serialized = serializeStoredProgress(ids);
        const next = parseStoredProgress(serialized).completed_ids;
        const previous = completed_ids;
        if(changedIds(previous, next).size === 0
            && persistence_mode !== "incompatible")
        {
            return;
        }
        persist(next, true);
        completed_ids = next;
        notify(previous, "import");
    }

    function handleStorage(event)
    {
        if(event.storageArea !== storage || event.key !== STORAGE_KEY)
        {
            return;
        }
        let next;
        try
        {
            next = event.newValue === null ? new Set()
                : parseStoredProgress(event.newValue).completed_ids;
        }
        catch(error)
        {
            on_warning("Progress changed in another tab, but the new value "
                + "is invalid and was ignored.");
            return;
        }
        const previous = completed_ids;
        const previous_mode = persistence_mode;
        completed_ids = next;
        persistence_mode = "persistent";
        if(changedIds(previous, next).size === 0
            && previous_mode === persistence_mode)
        {
            return;
        }
        notify(previous, "storage");
    }

    if(event_target !== null
        && typeof event_target?.addEventListener === "function")
    {
        event_target.addEventListener("storage", handleStorage);
    }

    return Object.freeze({
        /** Returns a new snapshot of every completed POI ID. */
        completedIds: () => new Set(completed_ids),
        /** Returns whether one validated POI ID is completed. */
        isCompleted: (id) =>
        {
            validateId(id);
            return completed_ids.has(id);
        },
        /** Sets one validated POI ID's completion state. */
        setCompleted,
        /** Replaces all progress with a validated iterable of IDs. */
        replace,
        /** Subscribes to state changes and returns an unsubscribe function. */
        subscribe: (listener) =>
        {
            if(typeof listener !== "function")
            {
                throw new TypeError("listener must be a function.");
            }
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        /** Returns the current durability mode. */
        persistenceMode: () => persistence_mode,
        /** Releases event listeners and subscribers owned by this store. */
        dispose: () =>
        {
            if(disposed)
            {
                return;
            }
            disposed = true;
            if(event_target !== null
                && typeof event_target?.removeEventListener === "function")
            {
                event_target.removeEventListener("storage", handleStorage);
            }
            subscribers.clear();
        },
    });
}
