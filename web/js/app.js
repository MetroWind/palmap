import {createMapView} from "./map_view.js";
import {
    loadAlphaPalPins,
    loadPoiData,
} from "./poi_repository.js";
import {createProgressControls} from "./progress_controls.js";
import {createProgressStore} from "./progress_store.js";
import {
    downloadProgress,
    readProgressFile,
} from "./progress_transfer.js";
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


function progressCounts(completed_ids, current_ids)
{
    let recognized = 0;
    let unavailable = 0;
    for(const id of completed_ids)
    {
        if(current_ids.has(id))
        {
            ++recognized;
        }
        else
        {
            ++unavailable;
        }
    }
    return Object.freeze({recognized, unavailable});
}


async function start()
{
    const status = requireElement("status");
    const map_element = requireElement("map");
    const filters = requireElement("filters");
    const panel_toggle = requireElement("panel-toggle");
    const progress_panel = requireElement("progress-panel");
    let data = null;
    let store = null;
    let view = null;
    let current_ids = new Set();

    const controls = createProgressControls(progress_panel, {
        onExport: async () =>
        {
            const snapshot = store.completedIds();
            try
            {
                downloadProgress(snapshot, data.data_version);
                controls.showMessage(
                    `Exported ${snapshot.size.toLocaleString()} saved places.`
                );
            }
            catch(error)
            {
                console.error(error);
                controls.showMessage(
                    "Progress could not be exported.", "error"
                );
            }
        },
        onImport: async (file) =>
        {
            const imported = await readProgressFile(file);
            const counts = progressCounts(
                imported.completed_ids, current_ids
            );
            return Object.freeze({
                ...imported,
                recognized: counts.recognized,
                unavailable: counts.unavailable,
                current_saved: store.completedIds().size,
                version_mismatch:
                    imported.poi_data_version !== data.data_version,
            });
        },
        onConfirmImport: async (preview) =>
        {
            store.replace(preview.completed_ids);
            let message = `Imported `
                + `${preview.completed_ids.size.toLocaleString()} saved `
                + `places; ${preview.recognized.toLocaleString()} are `
                + "available on this map.";
            if(store.persistenceMode() === "volatile")
            {
                message += " Imported progress is available only for this "
                    + "session.";
            }
            controls.showMessage(message,
                store.persistenceMode() === "volatile" ? "warning" : "");
        },
    });

    try
    {
        status.textContent = "Loading map data...";
        controls.setEnabled(false);
        const [loaded_data, portrait_pins] = await Promise.all([
            loadPoiData("data/poi_data.json"),
            loadAlphaPalPins("data/alpha_pal_pin_urls.json"),
        ]);
        data = loaded_data;
        current_ids = new Set(data.pois.map((poi) => poi.id));
        store = createProgressStore({
            onWarning: (message) =>
            {
                controls.showMessage(message, "warning");
            },
        });
        view = createMapView(map_element, {
            portraitPins: portrait_pins,
            onCompletionRequest: (id, completed) =>
            {
                store.setCompleted(id, completed);
            },
        });
        view.setPois(data.pois, data.types);
        view.setCompletedIds(store.completedIds());

        const default_visible = defaultVisibleTypeIds(data.types);
        const updateVisibility = (visible) =>
        {
            view.setVisibleTypes(visible);
            status.textContent = `${view.visibleCount().toLocaleString()} of `
                + `${data.pois.length.toLocaleString()} places visible`;
        };
        const type_filter = createTypeFilter(
            filters, data.types, data.pois, updateVisibility, default_visible
        );
        type_filter.setCompletedIds(store.completedIds());
        updateVisibility(default_visible);

        function updateProgress(completed_ids)
        {
            const counts = progressCounts(completed_ids, current_ids);
            controls.setCounts(
                counts.recognized, data.pois.length, counts.unavailable
            );
        }

        store.subscribe((event) =>
        {
            for(const id of event.changed_ids)
            {
                const completed = event.completed_ids.has(id);
                view.setPoiCompleted(id, completed);
                type_filter.setPoiCompleted(id, completed);
            }
            updateProgress(event.completed_ids);
            controls.setPersistenceMode(event.persistence_mode);
        });
        updateProgress(store.completedIds());
        controls.setPersistenceMode(store.persistenceMode());
        controls.setEnabled(true);

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
        controls.setEnabled(false);
        status.className = "status error";
        status.textContent = "Palmap could not start. Check the browser "
            + "console and make sure this page is served over HTTP.";
    }
}


start();
