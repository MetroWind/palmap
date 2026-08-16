import {typePin} from "./pin_catalog.js";
import {isPoiId} from "./poi_id.js";


const DEFAULT_TYPE_NAMES = new Set([
    "Alpha Pal",
    "Bounty",
    "Dungeon",
    "Enemy Camp",
    "Fast Travel",
    "Tower",
    "Treasure Map",
    "Watchtower",
]);
const DEFAULT_CATEGORIES = new Set(["Collectibles"]);


/** Returns the type IDs shown when the application first loads. */
export function defaultVisibleTypeIds(types)
{
    return new Set(types.filter((type) =>
        DEFAULT_TYPE_NAMES.has(type.name)
        || DEFAULT_CATEGORIES.has(type.category)
    ).map((type) => type.id));
}


/** Renders accessible grouped POI filters and owns their visible state. */
export function createTypeFilter(
    element, types, pois, onChange, initial_visible
)
{
    const counts = new Map(types.map((type) => [type.id, 0]));
    const type_names = new Map(types.map((type) => [type.id, type.name]));
    const poi_types = new Map();
    const done_counts = new Map(types.map((type) => [type.id, 0]));
    for(const poi of pois)
    {
        counts.set(poi.type_id, counts.get(poi.type_id) + 1);
        poi_types.set(poi.id, poi.type_id);
    }
    const visible = new Set(initial_visible);
    const completed_ids = new Set();
    const inputs = new Map();
    const labels = new Map();
    const categories = new Map();
    element.replaceChildren();

    function emit()
    {
        onChange(new Set(visible));
    }

    function setAll(is_visible)
    {
        for(const [type_id, input] of inputs)
        {
            input.checked = is_visible;
            if(is_visible)
            {
                visible.add(type_id);
            }
            else
            {
                visible.delete(type_id);
            }
        }
        emit();
    }

    function labelText(type_id, done_count)
    {
        const done = done_count.toLocaleString();
        const total = counts.get(type_id).toLocaleString();
        return `${type_names.get(type_id)} (${done}/${total} done)`;
    }

    function updateCompletedLabels()
    {
        for(const type of types)
        {
            done_counts.set(type.id, 0);
        }
        for(const id of completed_ids)
        {
            const type_id = poi_types.get(id);
            if(type_id !== undefined)
            {
                done_counts.set(type_id, done_counts.get(type_id) + 1);
            }
        }
        for(const [type_id, label] of labels)
        {
            label.textContent = labelText(type_id, done_counts.get(type_id));
        }
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
        updateCompletedLabels();
    }

    function setPoiCompleted(poi_id, completed)
    {
        if(!isPoiId(poi_id) || typeof completed !== "boolean")
        {
            throw new TypeError("A valid POI ID and boolean are required.");
        }
        if(completed_ids.has(poi_id) === completed)
        {
            return;
        }
        if(completed)
        {
            completed_ids.add(poi_id);
        }
        else
        {
            completed_ids.delete(poi_id);
        }
        const type_id = poi_types.get(poi_id);
        if(type_id === undefined)
        {
            return;
        }
        const difference = completed ? 1 : -1;
        const done_count = done_counts.get(type_id) + difference;
        done_counts.set(type_id, done_count);
        labels.get(type_id).textContent = labelText(type_id, done_count);
    }

    const actions = document.createElement("div");
    actions.className = "filter-actions";
    for(const [text, value] of [["Show all", true], ["Hide all", false]])
    {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", () => setAll(value));
        actions.append(button);
    }
    element.append(actions);

    for(const type of types)
    {
        let fieldset = categories.get(type.category);
        if(fieldset === undefined)
        {
            fieldset = document.createElement("fieldset");
            const legend = document.createElement("legend");
            legend.textContent = type.category;
            fieldset.append(legend);
            categories.set(type.category, fieldset);
            element.append(fieldset);
        }
        const row = document.createElement("div");
        row.className = "filter-row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = `type-${type.id}`;
        input.checked = visible.has(type.id);
        input.addEventListener("change", () =>
        {
            if(input.checked)
            {
                visible.add(type.id);
            }
            else
            {
                visible.delete(type.id);
            }
            emit();
        });
        const symbol = document.createElement("span");
        symbol.className = "type-symbol";
        const pin = typePin(type.name);
        if(pin === undefined)
        {
            const swatch = document.createElement("span");
            swatch.className = "type-swatch";
            swatch.style.backgroundColor = type.pin_color;
            symbol.append(swatch);
        }
        else
        {
            const image = document.createElement("img");
            image.className = "type-pin";
            image.src = pin.url;
            image.width = pin.size[0];
            image.height = pin.size[1];
            image.alt = "";
            symbol.append(image);
        }
        const label = document.createElement("label");
        label.htmlFor = input.id;
        label.textContent = labelText(type.id, 0);
        row.append(input, symbol, label);
        fieldset.append(row);
        inputs.set(type.id, input);
        labels.set(type.id, label);
    }
    return Object.freeze({
        /** Returns a copy of the currently visible type IDs. */
        visibleTypes: () => new Set(visible),
        /** Replaces the completion set shown in every type label. */
        setCompletedIds,
        /** Updates one POI's contribution to its type's done count. */
        setPoiCompleted,
    });
}
