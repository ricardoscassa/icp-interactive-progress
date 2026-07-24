namespace ICPDrawingLab {
  class SemanticDiagnosticsPanel {
    private readonly trigger = assertElement<HTMLButtonElement>("#semanticDiagnosticsButton");
    private readonly panel = assertElement<HTMLElement>("#semanticDiagnosticsPanel");
    private readonly closeButton = assertElement<HTMLButtonElement>("#closeSemanticDiagnosticsButton");
    private readonly runButton = assertElement<HTMLButtonElement>("#runSemanticDiagnosticsButton");
    private readonly clearButton = assertElement<HTMLButtonElement>("#clearSemanticDiagnosticsButton");
    private readonly summary = assertElement<HTMLElement>("#semanticDiagnosticsSummary");
    private readonly drawingCanvas = assertElement<HTMLCanvasElement>("#drawingCanvas");
    private readonly diagnosticCanvas = assertElement<HTMLCanvasElement>("#semanticDiagnosticCanvas");
    private readonly darkThreshold = assertElement<HTMLInputElement>("#darkThreshold");
    private result: SemanticDiagnosticResult | null = null;

    constructor() {
      this.bind();
      this.clear();
    }

    private bind(): void {
      this.trigger.addEventListener("click", () => {
        this.panel.hidden = !this.panel.hidden;
        this.trigger.classList.toggle("is-active", !this.panel.hidden);
        this.trigger.setAttribute("aria-pressed", String(!this.panel.hidden));
      });
      this.closeButton.addEventListener("click", () => {
        this.panel.hidden = true;
        this.trigger.classList.remove("is-active");
        this.trigger.setAttribute("aria-pressed", "false");
      });
      this.runButton.addEventListener("click", () => void this.run());
      this.clearButton.addEventListener("click", () => this.clear());
      this.layerInputs().forEach((input) => input.addEventListener("change", () => this.draw()));

      document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("[data-page-id], #uploadPlanButton, #loadSampleButton, #applyLayerPreviewButton, #resetLayerPreviewButton")) {
          window.setTimeout(() => this.clear(), 0);
        }
      }, true);
    }

    private layerInputs(): HTMLInputElement[] {
      return Array.from(document.querySelectorAll<HTMLInputElement>("[data-semantic-diagnostic-layer]"));
    }

    private selectedLayers(): Set<SemanticDiagnosticLayer> {
      return new Set(this.layerInputs()
        .filter((input) => input.checked)
        .map((input) => input.dataset.semanticDiagnosticLayer as SemanticDiagnosticLayer));
    }

    private analysisBounds(scale: number): BoundingBox | null {
      const rect = document.querySelector<SVGRectElement>(".analysis-area-rect");
      if (!rect) return null;
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      const width = Number(rect.getAttribute("width"));
      const height = Number(rect.getAttribute("height"));
      if (![x, y, width, height].every(Number.isFinite) || width < 4 || height < 4) return null;
      return {
        x: x * scale,
        y: y * scale,
        width: width * scale,
        height: height * scale,
      };
    }

    private async run(): Promise<void> {
      if (!this.drawingCanvas.width || !this.drawingCanvas.height) {
        setStatus("Upload or load a drawing before running semantic diagnostics.", "warning");
        return;
      }
      this.runButton.disabled = true;
      this.summary.textContent = "Analysing the current drawing view…";
      setStatus("Building room, wall, door, junction and polygon diagnostic layers…");
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      try {
        const maximumEdge = 1200;
        const scale = Math.min(1, maximumEdge / Math.max(this.drawingCanvas.width, this.drawingCanvas.height));
        const analysisCanvas = document.createElement("canvas");
        analysisCanvas.width = Math.max(1, Math.round(this.drawingCanvas.width * scale));
        analysisCanvas.height = Math.max(1, Math.round(this.drawingCanvas.height * scale));
        const context = analysisCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
        if (!context) throw new Error("Canvas diagnostics are not supported by this browser.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, analysisCanvas.width, analysisCanvas.height);
        context.drawImage(this.drawingCanvas, 0, 0, analysisCanvas.width, analysisCanvas.height);
        const imageData = context.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
        this.result = analyseSemanticFloorplan(imageData, {
          threshold: clamp(Number(this.darkThreshold.value) || 155, 50, 245),
          bounds: this.analysisBounds(scale),
        });
        this.draw();
        this.summary.innerHTML = `
          <strong>${this.result.polygons.length}</strong> candidate rooms ·
          <strong>${this.result.junctions.length}</strong> junctions ·
          <strong>${Math.round(this.result.doorPixelCount / 5)}</strong> opening evidence units
          <small>Heuristic baseline only. These layers diagnose the current recogniser and do not replace approved room geometry.</small>`;
        setStatus("Semantic diagnostics complete. Toggle the overlays to inspect where room recognition is going wrong.", "success");
      } catch (error) {
        console.error(error);
        this.result = null;
        this.clearCanvas();
        this.summary.textContent = error instanceof Error ? error.message : "Semantic diagnostics could not be completed.";
        setStatus(this.summary.textContent, "error");
      } finally {
        this.runButton.disabled = false;
      }
    }

    private draw(): void {
      if (!this.result) {
        this.clearCanvas();
        return;
      }
      const layers = this.selectedLayers();
      const result = this.result;
      const source = document.createElement("canvas");
      source.width = result.width;
      source.height = result.height;
      const context = source.getContext("2d", { alpha: true });
      if (!context) return;
      const pixels = context.createImageData(result.width, result.height);

      for (let index = 0; index < result.wallMask.length; index += 1) {
        const offset = index * 4;
        if (layers.has("rooms") && result.roomMask[index]) {
          pixels.data[offset] = 25;
          pixels.data[offset + 1] = 170;
          pixels.data[offset + 2] = 95;
          pixels.data[offset + 3] = 52;
        }
        if (layers.has("walls") && result.wallMask[index]) {
          pixels.data[offset] = 26;
          pixels.data[offset + 1] = 93;
          pixels.data[offset + 2] = 190;
          pixels.data[offset + 3] = 168;
        }
        if (layers.has("doors") && result.doorMask[index]) {
          pixels.data[offset] = 242;
          pixels.data[offset + 1] = 115;
          pixels.data[offset + 2] = 22;
          pixels.data[offset + 3] = 220;
        }
      }
      context.putImageData(pixels, 0, 0);

      if (layers.has("junctions")) {
        context.fillStyle = "rgba(125, 45, 190, 0.92)";
        for (const point of result.junctions) {
          context.beginPath();
          context.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
          context.fill();
        }
      }

      if (layers.has("polygons")) {
        context.strokeStyle = "rgba(210, 32, 66, 0.95)";
        context.lineWidth = Math.max(1.5, Math.max(result.width, result.height) / 700);
        context.setLineDash([8, 5]);
        for (const region of result.polygons) {
          if (region.points.length < 3) continue;
          context.beginPath();
          context.moveTo(region.points[0].x * result.width, region.points[0].y * result.height);
          for (const point of region.points.slice(1)) context.lineTo(point.x * result.width, point.y * result.height);
          context.closePath();
          context.stroke();
        }
        context.setLineDash([]);
      }

      this.diagnosticCanvas.width = this.drawingCanvas.width;
      this.diagnosticCanvas.height = this.drawingCanvas.height;
      this.diagnosticCanvas.style.width = `${this.drawingCanvas.width}px`;
      this.diagnosticCanvas.style.height = `${this.drawingCanvas.height}px`;
      const target = this.diagnosticCanvas.getContext("2d", { alpha: true });
      if (!target) return;
      target.clearRect(0, 0, this.diagnosticCanvas.width, this.diagnosticCanvas.height);
      target.imageSmoothingEnabled = false;
      target.drawImage(source, 0, 0, this.diagnosticCanvas.width, this.diagnosticCanvas.height);
      this.diagnosticCanvas.hidden = layers.size === 0;
    }

    private clearCanvas(): void {
      const context = this.diagnosticCanvas.getContext("2d", { alpha: true });
      context?.clearRect(0, 0, this.diagnosticCanvas.width, this.diagnosticCanvas.height);
      this.diagnosticCanvas.hidden = true;
    }

    private clear(): void {
      this.result = null;
      this.clearCanvas();
      this.summary.innerHTML = "Run diagnostics to compare the <strong>room</strong>, <strong>wall</strong>, <strong>door/opening</strong>, <strong>junction</strong> and <strong>final polygon</strong> layers.";
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    try {
      new SemanticDiagnosticsPanel();
    } catch (error) {
      console.error("Could not initialise semantic diagnostics.", error);
    }
  });
}
