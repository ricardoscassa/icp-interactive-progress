namespace ICPDrawingLab {
  function installFloatingLayerPanel(): void {
    const panel = document.querySelector<HTMLElement>("#pdfLayerSection");
    const viewport = document.querySelector<HTMLElement>("#stageViewport");
    const toolbar = document.querySelector<HTMLElement>(".toolbar");
    const visibleSelect = document.querySelector<HTMLSelectElement>("#visibleLayerSelect");
    const usePdfLayers = document.querySelector<HTMLInputElement>("#usePdfLayers");
    const areaLayerSelect = document.querySelector<HTMLSelectElement>("#areaLayerSelect");
    const labelLayerSelect = document.querySelector<HTMLSelectElement>("#labelLayerSelect");
    if (!panel || !viewport || !toolbar || !visibleSelect || !usePdfLayers || !areaLayerSelect || !labelLayerSelect) return;

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "./layer-panel.css";
    document.head.append(stylesheet);

    const toggleButton = document.createElement("button");
    toggleButton.id = "layerPanelToggleButton";
    toggleButton.type = "button";
    toggleButton.className = "tool-button layer-panel-toggle";
    toggleButton.textContent = "Layers";
    toggleButton.hidden = panel.hidden;

    const rightTools = toolbar.querySelector<HTMLElement>(".tool-group.align-right");
    toolbar.insertBefore(toggleButton, rightTools ?? null);

    const header = document.createElement("div");
    header.className = "floating-layer-header";
    header.innerHTML = `
      <div>
        <span>PDF drawing</span>
        <strong>Layers</strong>
      </div>
      <button type="button" class="layer-panel-close" aria-label="Hide layers panel">×</button>
    `;
    panel.insertBefore(header, panel.firstChild);

    const visibleField = visibleSelect.closest<HTMLElement>("label.field");
    const checklist = document.createElement("div");
    checklist.className = "layer-checklist";
    checklist.setAttribute("role", "group");
    checklist.setAttribute("aria-label", "Visible PDF layers");

    const bulkActions = document.createElement("div");
    bulkActions.className = "layer-bulk-actions";
    bulkActions.innerHTML = `
      <button type="button" data-layer-action="all">Show all</button>
      <button type="button" data-layer-action="none">Hide all</button>
    `;

    if (visibleField) {
      visibleField.insertBefore(bulkActions, visibleSelect);
      visibleField.insertBefore(checklist, visibleSelect);
    }

    const advanced = document.createElement("details");
    advanced.className = "layer-advanced";
    advanced.innerHTML = "<summary>Recognition layer mapping</summary>";
    const useLayerRow = usePdfLayers.closest<HTMLElement>("label.check-row");
    const areaField = areaLayerSelect.closest<HTMLElement>("label.field");
    const labelField = labelLayerSelect.closest<HTMLElement>("label.field");
    if (useLayerRow) advanced.append(useLayerRow);
    if (areaField) advanced.append(areaField);
    if (labelField) advanced.append(labelField);
    panel.append(advanced);

    panel.classList.add("floating-layer-panel");
    viewport.append(panel);

    let userClosed = false;
    let openedOnce = false;

    const setOpen = (open: boolean): void => {
      panel.classList.toggle("is-layer-panel-closed", !open);
      toggleButton.classList.toggle("is-active", open);
      toggleButton.setAttribute("aria-expanded", String(open));
      if (open) userClosed = false;
    };

    const visibleSuffixPattern = /\s*·\s*visible\s*$/i;
    const optionDisplayName = (option: HTMLOptionElement): string => {
      const candidates = [
        option.dataset.layerName,
        option.label,
        option.text,
        option.textContent,
        option.getAttribute("aria-label"),
        option.title,
        option.value,
      ];
      const resolved = candidates.find((candidate) => candidate?.trim())?.trim() ?? "Unnamed layer";
      return resolved.replace(visibleSuffixPattern, "").trim() || option.value || "Unnamed layer";
    };

    const syncChecklist = (): void => {
      const options = Array.from(visibleSelect.options);
      checklist.replaceChildren(...options.map((option) => {
        const row = document.createElement("label");
        row.className = "layer-check-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = option.selected;
        checkbox.disabled = visibleSelect.disabled;
        checkbox.addEventListener("change", () => {
          option.selected = checkbox.checked;
          visibleSelect.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const displayName = optionDisplayName(option);
        const name = document.createElement("span");
        name.textContent = displayName;
        name.title = displayName;
        row.setAttribute("aria-label", displayName);
        row.append(checkbox, name);
        return row;
      }));

      const selectedCount = options.filter((option) => option.selected).length;
      toggleButton.textContent = options.length ? `Layers ${selectedCount}/${options.length}` : "Layers";
      toggleButton.hidden = panel.hidden || options.length === 0;
    };

    bulkActions.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-layer-action]");
      if (!target || visibleSelect.disabled) return;
      const selectAll = target.dataset.layerAction === "all";
      Array.from(visibleSelect.options).forEach((option) => {
        option.selected = selectAll;
      });
      visibleSelect.dispatchEvent(new Event("change", { bubbles: true }));
      syncChecklist();
    });

    toggleButton.addEventListener("click", () => {
      setOpen(panel.classList.contains("is-layer-panel-closed"));
    });

    header.querySelector<HTMLButtonElement>(".layer-panel-close")?.addEventListener("click", () => {
      userClosed = true;
      setOpen(false);
    });

    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    panel.addEventListener("wheel", (event) => event.stopPropagation());
    visibleSelect.addEventListener("change", syncChecklist);

    const selectObserver = new MutationObserver(syncChecklist);
    selectObserver.observe(visibleSelect, {
      attributes: true,
      attributeFilter: ["disabled"],
      childList: true,
      characterData: true,
      subtree: true,
    });

    const panelObserver = new MutationObserver(() => {
      toggleButton.hidden = panel.hidden || visibleSelect.options.length === 0;
      if (!panel.hidden && visibleSelect.options.length && !openedOnce && !userClosed) {
        openedOnce = true;
        setOpen(true);
      }
      syncChecklist();
    });
    panelObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] });

    setOpen(false);
    syncChecklist();
  }

  window.addEventListener("DOMContentLoaded", installFloatingLayerPanel);
}
