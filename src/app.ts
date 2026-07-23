namespace ICPDrawingLab {
  class DrawingLabApplication {
    private readonly store = new EditorStore();
    private readonly renderer = new DrawingRenderer(this.store);
    private readonly planInput = assertElement<HTMLInputElement>("#planFileInput");
    private readonly projectInput = assertElement<HTMLInputElement>("#projectFileInput");
    private readonly projectName = assertElement<HTMLInputElement>("#projectName");
    private readonly analyseButton = assertElement<HTMLButtonElement>("#analyseButton");
    private readonly analysisProgress = assertElement<HTMLProgressElement>("#analysisProgress");
    private readonly roomPatternInput = assertElement<HTMLInputElement>("#roomPattern");
    private readonly forceOcrInput = assertElement<HTMLInputElement>("#forceOcr");
    private readonly boundariesInput = assertElement<HTMLInputElement>("#createBoundaries");
    private readonly darkThresholdInput = assertElement<HTMLInputElement>("#darkThreshold");
    private readonly usePdfLayersInput = assertElement<HTMLInputElement>("#usePdfLayers");
    private readonly pdfLayerSection = assertElement<HTMLElement>("#pdfLayerSection");
    private readonly areaLayerSelect = assertElement<HTMLSelectElement>("#areaLayerSelect");
    private readonly labelLayerSelect = assertElement<HTMLSelectElement>("#labelLayerSelect");
    private readonly pdfLayerSummary = assertElement<HTMLElement>("#pdfLayerSummary");

    constructor() {
      this.roomPatternInput.value = DEFAULT_ROOM_PATTERN;
      this.projectName.value = this.store.project.name;
      this.bindActions();
      void this.loadSample();
    }

    private bindActions(): void {
      assertElement<HTMLButtonElement>("#uploadPlanButton").addEventListener("click", () => this.planInput.click());
      this.planInput.addEventListener("change", () => void this.handlePlanFiles());
      assertElement<HTMLButtonElement>("#loadSampleButton").addEventListener("click", () => void this.loadSample());
      this.analyseButton.addEventListener("click", () => void this.analyseActivePage());
      assertElement<HTMLButtonElement>("#selectAnalysisAreaButton").addEventListener("click", () => {
        this.store.setTool(this.store.tool === "analysis-area" ? "select" : "analysis-area");
        setStatus(this.store.tool === "analysis-area" ? "Drag over the drawing to define the recognition area." : "Area selection cancelled.");
      });
      assertElement<HTMLButtonElement>("#clearAnalysisAreaButton").addEventListener("click", () => {
        this.store.clearAnalysisArea();
        setStatus("Recognition area cleared. The whole page will be analysed.", "success");
      });
      assertElement<HTMLButtonElement>("#clearAutomaticButton").addEventListener("click", () => this.clearAutomaticSuggestions());
      assertElement<HTMLButtonElement>("#saveProjectButton").addEventListener("click", () => this.saveProject());
      assertElement<HTMLButtonElement>("#loadProjectButton").addEventListener("click", () => this.projectInput.click());
      this.projectInput.addEventListener("change", () => void this.loadProject());

      this.areaLayerSelect.addEventListener("change", () => this.updateSelectedLayers("area"));
      this.labelLayerSelect.addEventListener("change", () => this.updateSelectedLayers("label"));
      this.usePdfLayersInput.addEventListener("change", () => this.renderPdfLayerControls());

      document.querySelectorAll<HTMLButtonElement>("[data-editor-tool]").forEach((button) => {
        button.addEventListener("click", () => {
          const tool = button.dataset.editorTool as EditorTool | undefined;
          if (tool) this.store.setTool(tool);
        });
      });

      assertElement<HTMLButtonElement>("#undoButton").addEventListener("click", () => this.store.undo());
      assertElement<HTMLButtonElement>("#redoButton").addEventListener("click", () => this.store.redo());
      assertElement<HTMLButtonElement>("#zoomInButton").addEventListener("click", () => this.renderer.zoomBy(1.2));
      assertElement<HTMLButtonElement>("#zoomOutButton").addEventListener("click", () => this.renderer.zoomBy(0.83));
      assertElement<HTMLButtonElement>("#fitButton").addEventListener("click", () => this.renderer.fitToViewport());
      assertElement<HTMLButtonElement>("#finishDraftButton").addEventListener("click", () => {
        const label = assertElement<HTMLInputElement>("#draftRoomLabel").value;
        this.store.finishDraft(label);
      });
      assertElement<HTMLButtonElement>("#cancelDraftButton").addEventListener("click", () => this.store.cancelDraft());

      this.projectName.addEventListener("change", () => {
        this.store.project.name = this.projectName.value.trim() || "ICP Drawing Recognition Test";
        this.store.notify();
      });
      this.store.subscribe(() => {
        if (document.activeElement !== this.projectName) this.projectName.value = this.store.project.name;
        this.renderPdfLayerControls();
      });

      window.addEventListener("keydown", (event) => this.handleKeyboard(event));
      window.addEventListener("resize", debounce(() => {
        if (this.store.activePage && this.store.view.scale === 1) this.renderer.fitToViewport();
      }, 150));
    }

    private recognitionSettings(): RecognitionSettings {
      return {
        roomPattern: this.roomPatternInput.value.trim() || DEFAULT_ROOM_PATTERN,
        forceOcr: this.forceOcrInput.checked,
        createBoundarySuggestions: this.boundariesInput.checked,
        darkThreshold: clamp(Number(this.darkThresholdInput.value) || 155, 50, 245),
        usePdfLayers: this.usePdfLayersInput.checked,
        useColourRegions: true,
        colourTolerance: 58,
        colourSaturationFloor: 0.14,
      };
    }

    private selectedOptions(select: HTMLSelectElement): string[] {
      return Array.from(select.selectedOptions).map((option) => option.value);
    }

    private updateSelectedLayers(kind: "area" | "label"): void {
      const page = this.store.activePage;
      if (!page || page.sourceType !== "pdf") return;
      if (kind === "area") page.selectedAreaLayerIds = this.selectedOptions(this.areaLayerSelect);
      else page.selectedLabelLayerIds = this.selectedOptions(this.labelLayerSelect);
      this.store.notify();
    }

    private renderLayerOptions(select: HTMLSelectElement, layers: PdfLayerInfo[], selectedIds: string[]): void {
      if (document.activeElement === select) return;
      const selected = new Set(selectedIds);
      select.innerHTML = layers.map((layer) => `
        <option value="${escapeHtml(layer.id)}" ${selected.has(layer.id) ? "selected" : ""}>
          ${escapeHtml(layer.name)}${layer.visibleByDefault ? " · visible" : ""}
        </option>`).join("");
    }

    private renderPdfLayerControls(): void {
      const page = this.store.activePage;
      const isLayeredPdf = page?.sourceType === "pdf" && page.pdfLayers.length > 0;
      this.pdfLayerSection.hidden = !isLayeredPdf;
      if (!page || !isLayeredPdf) return;
      this.renderLayerOptions(this.areaLayerSelect, page.pdfLayers, page.selectedAreaLayerIds);
      this.renderLayerOptions(this.labelLayerSelect, page.pdfLayers, page.selectedLabelLayerIds);
      const sourceReady = hasRegisteredPdfSource(page.pdfSourceKey);
      this.pdfLayerSummary.textContent = `${page.pdfLayers.length} layers detected · ${page.selectedAreaLayerIds.length} area · ${page.selectedLabelLayerIds.length} label${sourceReady ? "" : " · re-upload PDF required"}`;
      this.areaLayerSelect.disabled = !this.usePdfLayersInput.checked || !sourceReady;
      this.labelLayerSelect.disabled = !this.usePdfLayersInput.checked || !sourceReady;
    }

    private async handlePlanFiles(): Promise<void> {
      const files = Array.from(this.planInput.files ?? []);
      this.planInput.value = "";
      if (!files.length) return;
      this.setBusy(true);
      try {
        const pages = await loadDrawingFiles(files, this.recognitionSettings().roomPattern, (message) => setStatus(message));
        const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `Drawing test · ${files.length} files`;
        this.store.replacePages(pages, name);
        this.store.resetHistory();
        const layerCount = pages.reduce((maximum, page) => Math.max(maximum, page.pdfLayers.length), 0);
        setStatus(
          layerCount
            ? `${pages.length} page${pages.length === 1 ? "" : "s"} loaded. ${layerCount} PDF layers detected; review the suggested area and label layers.`
            : `${pages.length} drawing page${pages.length === 1 ? "" : "s"} loaded.`,
          "success",
        );
        window.requestAnimationFrame(() => this.renderer.fitToViewport());
      } catch (error) {
        console.error(error);
        setStatus(error instanceof Error ? error.message : "The drawing could not be loaded.", "error");
      } finally {
        this.setBusy(false);
      }
    }

    private async loadSample(): Promise<void> {
      this.setBusy(true);
      try {
        const page = await loadSamplePage(this.recognitionSettings().roomPattern);
        this.store.replacePages([page], "ICP Drawing Recognition Sample");
        this.store.resetHistory();
        setStatus(`${page.labels.length} labels read from the sample SVG. Run Recognize & Suggest.`, "success");
        window.requestAnimationFrame(() => this.renderer.fitToViewport());
      } catch (error) {
        console.error(error);
        setStatus(error instanceof Error ? error.message : "The sample drawing could not be loaded.", "error");
      } finally {
        this.setBusy(false);
      }
    }

    private async analyseActivePage(): Promise<void> {
      const page = this.store.activePage;
      if (!page) {
        setStatus("Upload a drawing before running recognition.", "warning");
        return;
      }
      const settings = this.recognitionSettings();
      try {
        compileRoomPattern(settings.roomPattern);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
        return;
      }
      if (settings.usePdfLayers && page.sourceType === "pdf" && page.pdfLayers.length && !page.selectedAreaLayerIds.length) {
        setStatus("Select at least one PDF area layer before running layer-aware recognition.", "warning");
        return;
      }
      this.setBusy(true);
      this.analysisProgress.hidden = false;
      this.analysisProgress.value = 0;
      const before = this.store.startTransaction();
      try {
        const summary = await analysePage(page, settings, (message, progress) => {
          setStatus(message);
          if (progress !== undefined) this.analysisProgress.value = progress;
        });
        this.store.commitTransaction(before);
        const areaMessage = page.analysisArea ? " inside the selected area" : "";
        const colourMessage = summary.colourRegionsFound
          ? ` ${summary.colourRegionsFound} coloured regions found, ${summary.colourRoomsSuggested} converted to room suggestions, and ${summary.unlabelledRegionsSuggested} left unassigned.`
          : "";
        const vectorMessage = summary.vectorRegionsFound
          ? ` ${summary.vectorRegionsFound} vector regions traced and ${summary.vectorRoomsSuggested} linked to labels.`
          : "";
        setStatus(
          `Recognition complete${areaMessage}: ${summary.labelsFound} labels and ${summary.roomsSuggested} room suggestions.${colourMessage}${vectorMessage} ${summary.boundariesFailed} labels still need manual geometry.`,
          summary.boundariesFailed ? "warning" : "success",
        );
      } catch (error) {
        console.error(error);
        setStatus(error instanceof Error ? error.message : "Recognition could not be completed.", "error");
      } finally {
        this.analysisProgress.hidden = true;
        this.setBusy(false);
      }
    }

    private clearAutomaticSuggestions(): void {
      const page = this.store.activePage;
      if (!page) return;
      const automaticCount = page.rooms.filter((room) => room.source !== "manual").length;
      if (!automaticCount) {
        setStatus("There are no automatic suggestions to clear.", "warning");
        return;
      }
      if (!confirm(`Clear ${automaticCount} automatic room suggestion${automaticCount === 1 ? "" : "s"}? Manual rooms will remain.`)) return;
      const before = this.store.startTransaction();
      const removedIds = new Set(page.rooms.filter((room) => room.source !== "manual").map((room) => room.id));
      page.rooms = page.rooms.filter((room) => room.source === "manual");
      page.labels.forEach((label) => {
        if (label.consumedByRoomId && removedIds.has(label.consumedByRoomId)) label.consumedByRoomId = null;
      });
      this.store.selectedRoomId = null;
      this.store.commitTransaction(before);
      setStatus("Automatic suggestions cleared.", "success");
    }

    private saveProject(): void {
      const project = this.store.exportProject();
      project.name = this.projectName.value.trim() || project.name;
      const json = JSON.stringify(project, null, 2);
      const sizeMb = new Blob([json]).size / 1024 / 1024;
      if (sizeMb > 45 && !confirm(`This project JSON is ${sizeMb.toFixed(1)} MB because it contains embedded drawing images. Continue?`)) return;
      downloadBlob(`${safeFileName(project.name)}.icp-drawing.json`, new Blob([json], { type: "application/json" }));
      setStatus("Project JSON downloaded. Re-upload the source PDF later to run layer recognition again.", "success");
    }

    private async loadProject(): Promise<void> {
      const file = this.projectInput.files?.[0];
      this.projectInput.value = "";
      if (!file) return;
      try {
        const parsed: unknown = JSON.parse(await readFileAsText(file));
        validateProject(parsed);
        this.store.importProject(parsed);
        setStatus(`Project loaded: ${parsed.pages.length} page${parsed.pages.length === 1 ? "" : "s"}. Re-upload original PDFs before rerunning layer recognition.`, "success");
        window.requestAnimationFrame(() => this.renderer.fitToViewport());
      } catch (error) {
        console.error(error);
        setStatus(error instanceof Error ? error.message : "The project JSON could not be loaded.", "error");
      }
    }

    private handleKeyboard(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) this.store.redo();
        else this.store.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        this.store.redo();
        return;
      }
      if (typing) return;
      if (event.key === "Escape") this.store.cancelDraft();
      if (event.key === "Enter" && this.store.tool === "draw") {
        event.preventDefault();
        this.store.finishDraft(assertElement<HTMLInputElement>("#draftRoomLabel").value);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && this.store.selectedRoom) {
        event.preventDefault();
        if (confirm("Delete the selected room geometry?")) this.store.deleteSelectedRoom();
      }
      const shortcuts: Record<string, EditorTool> = {
        v: "select", d: "draw", a: "add-vertex", x: "delete-vertex", h: "pan", r: "analysis-area",
      };
      const tool = shortcuts[event.key.toLowerCase()];
      if (tool) this.store.setTool(tool);
    }

    private setBusy(busy: boolean): void {
      this.analyseButton.disabled = busy;
      assertElement<HTMLButtonElement>("#uploadPlanButton").disabled = busy;
      assertElement<HTMLButtonElement>("#loadSampleButton").disabled = busy;
      assertElement<HTMLButtonElement>("#selectAnalysisAreaButton").disabled = busy;
      assertElement<HTMLButtonElement>("#clearAnalysisAreaButton").disabled = busy;
      this.areaLayerSelect.disabled = busy || !this.usePdfLayersInput.checked;
      this.labelLayerSelect.disabled = busy || !this.usePdfLayersInput.checked;
      document.body.classList.toggle("is-busy", busy);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    try {
      new DrawingLabApplication();
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "The application could not start.", "error");
    }
  });
}