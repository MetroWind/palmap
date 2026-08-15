import {createMapView} from "./map_view.js";
import {loadPoiData} from "./poi_repository.js";
import {
    createTypeFilter,
    defaultVisibleTypeIds,
} from "./type_filter.js";


function requireElement(id)
{
    const element = document.getElementById(id);
    if(element === null)
    {
        throw new Error(`Required page element #${id} is missing.`);
    }
    return element;
}


async function start()
{
    const status = requireElement("status");
    const map_element = requireElement("map");
    const filters = requireElement("filters");
    const panel_toggle = requireElement("panel-toggle");
    try
    {
        status.textContent = "Loading map data...";
        const data = await loadPoiData("data/poi_data.json");
        const default_visible = defaultVisibleTypeIds(data.types);
        const view = createMapView(map_element);
        view.setPois(data.pois, data.types);
        const update = (visible) =>
        {
            view.setVisibleTypes(visible);
            status.textContent = `${view.visibleCount().toLocaleString()} of `
                + `${data.pois.length.toLocaleString()} places visible`;
        };
        createTypeFilter(
            filters, data.types, data.pois, update, default_visible
        );
        update(default_visible);
        panel_toggle.addEventListener("click", () =>
        {
            const panel = requireElement("filter-panel");
            const collapsed = panel.classList.toggle("is-collapsed");
            panel_toggle.setAttribute("aria-expanded", String(!collapsed));
            requestAnimationFrame(() => view.invalidateSize());
        });
        window.addEventListener("resize", () => view.invalidateSize());
    }
    catch(error)
    {
        console.error(error);
        status.className = "status error";
        status.textContent = "Palmap could not start. Check the browser "
            + "console "
            + "and make sure this page is served over HTTP.";
    }
}


start();
