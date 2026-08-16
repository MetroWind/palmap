function requireChild(element, selector)
{
    const child = element.querySelector(selector);
    if(child === null)
    {
        throw new Error(`Required progress control ${selector} is missing.`);
    }
    return child;
}


function importConfirmation(preview)
{
    const lines = [
        "Replace current progress with this file?",
        "",
        `${preview.recognized.toLocaleString()} places match this map.`,
        `${preview.unavailable.toLocaleString()} saved IDs are unavailable `
            + "and will be preserved.",
    ];
    if(preview.version_mismatch)
    {
        lines.push(`The file was exported from data version `
            + `${preview.poi_data_version}.`, "");
    }
    else
    {
        lines.push("");
    }
    if(preview.completed_ids.size === 0)
    {
        lines.push("This will clear all current progress.");
    }
    else
    {
        lines.push(`This replaces ${preview.current_saved.toLocaleString()} `
            + "currently saved IDs.");
    }
    return lines.join("\n");
}


/** Binds progress transfer controls and returns their update interface. */
export function createProgressControls(element, options)
{
    const summary = requireChild(element, "#progress-summary");
    const message = requireChild(element, "#progress-message");
    const export_button = requireChild(element, "#export-progress");
    const import_input = requireChild(element, "#import-progress");
    const import_label = requireChild(element, "label[for='import-progress']");
    const confirm_import = options.confirm ?? ((text) => window.confirm(text));
    let enabled = false;
    let busy = false;
    let persistence_notice = false;

    function updateDisabled()
    {
        const disabled = !enabled || busy;
        export_button.disabled = disabled;
        import_input.disabled = disabled;
        import_label.classList.toggle("disabled", disabled);
        import_label.setAttribute("aria-disabled", String(disabled));
    }

    function showMessage(text, kind = "")
    {
        persistence_notice = false;
        message.textContent = text;
        message.className = "progress-message";
        if(kind !== "")
        {
            message.classList.add(kind);
        }
    }

    export_button.addEventListener("click", async () =>
    {
        if(!enabled || busy)
        {
            return;
        }
        busy = true;
        updateDisabled();
        try
        {
            await options.onExport();
        }
        finally
        {
            busy = false;
            updateDisabled();
        }
    });

    import_input.addEventListener("change", async () =>
    {
        const file = import_input.files?.[0];
        if(file === undefined || !enabled || busy)
        {
            import_input.value = "";
            return;
        }
        busy = true;
        updateDisabled();
        showMessage("");
        try
        {
            const preview = await options.onImport(file);
            if(!confirm_import(importConfirmation(preview)))
            {
                showMessage("Import canceled.");
                return;
            }
            await options.onConfirmImport(preview);
        }
        catch(error)
        {
            console.error(error);
            showMessage(error.message ?? "Progress could not be imported.",
                "error");
        }
        finally
        {
            busy = false;
            import_input.value = "";
            updateDisabled();
        }
    });

    updateDisabled();
    return Object.freeze({
        /** Updates recognized, total, and unavailable progress counts. */
        setCounts: (done, total, unavailable) =>
        {
            let text = `${done.toLocaleString()} of `
                + `${total.toLocaleString()} places done`;
            if(unavailable !== 0)
            {
                text += ` · ${unavailable.toLocaleString()} saved places `
                    + "unavailable in this map version";
            }
            summary.textContent = text;
        },
        /** Reflects whether progress is durable in browser storage. */
        setPersistenceMode: (mode) =>
        {
            if(mode === "volatile")
            {
                showMessage("Progress storage is unavailable. Changes will "
                    + "last only for this tab.", "warning");
                persistence_notice = true;
            }
            else if(mode === "incompatible")
            {
                showMessage("Saved progress uses an unsupported or invalid "
                    + "format. It was not overwritten. Import a valid "
                    + "progress file to replace it.", "warning");
                persistence_notice = true;
            }
            else if(persistence_notice)
            {
                showMessage("");
            }
        },
        /** Shows a safe status message with an optional presentation kind. */
        showMessage,
        /** Enables or disables import and export actions. */
        setEnabled: (next_enabled) =>
        {
            enabled = Boolean(next_enabled);
            updateDisabled();
        },
    });
}
