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
const DEFAULT_CATEGORIES = new Set(["Collectibles", "Eggs"]);


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
    for(const poi of pois)
    {
        counts.set(poi.type_id, counts.get(poi.type_id) + 1);
    }
    const visible = new Set(initial_visible);
    const inputs = new Map();
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
        const swatch = document.createElement("span");
        swatch.className = "type-swatch";
        swatch.style.backgroundColor = type.pin_color;
        const label = document.createElement("label");
        label.htmlFor = input.id;
        label.textContent = `${type.name} (${counts.get(type.id)})`;
        row.append(input, swatch, label);
        fieldset.append(row);
        inputs.set(type.id, input);
    }
    return Object.freeze({
        /** Returns a copy of the currently visible type IDs. */
        visibleTypes: () => new Set(visible),
    });
}
