namespace ICPDrawingLab {
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

  function ensureStageHitArea(overlay: SVGSVGElement, canvas: HTMLCanvasElement): void {
    const width = canvas.width || Number(overlay.getAttribute("width")) || 0;
    const height = canvas.height || Number(overlay.getAttribute("height")) || 0;
    if (width <= 0 || height <= 0) return;

    let hitArea = overlay.querySelector<SVGRectElement>("[data-stage-hit-area]");
    if (!hitArea) {
      hitArea = document.createElementNS(SVG_NAMESPACE, "rect");
      hitArea.dataset.stageHitArea = "true";
      hitArea.setAttribute("fill", "transparent");
      hitArea.setAttribute("pointer-events", "all");
      hitArea.setAttribute("aria-hidden", "true");
      overlay.insertBefore(hitArea, overlay.firstChild);
    }

    hitArea.setAttribute("x", "0");
    hitArea.setAttribute("y", "0");
    hitArea.setAttribute("width", String(width));
    hitArea.setAttribute("height", String(height));

    if (overlay.firstChild !== hitArea) {
      overlay.insertBefore(hitArea, overlay.firstChild);
    }
  }

  function updateRecognitionAreaButton(button: HTMLButtonElement): void {
    const active = document.body.classList.contains("is-selecting-area");
    button.textContent = active ? "Drag on drawing…" : "Select recognition area";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.style.background = active ? "var(--deep)" : "";
    button.style.borderColor = active ? "var(--deep)" : "";
    button.style.color = active ? "white" : "";
  }

  window.addEventListener("DOMContentLoaded", () => {
    const overlay = document.querySelector<SVGSVGElement>("#drawingOverlay");
    const canvas = document.querySelector<HTMLCanvasElement>("#drawingCanvas");
    const button = document.querySelector<HTMLButtonElement>("#selectAnalysisAreaButton");
    if (!overlay || !canvas || !button) return;

    const ensureInteractionSurface = (): void => ensureStageHitArea(overlay, canvas);
    const updateButton = (): void => updateRecognitionAreaButton(button);

    const overlayObserver = new MutationObserver(ensureInteractionSurface);
    overlayObserver.observe(overlay, { childList: true });

    const bodyObserver = new MutationObserver(updateButton);
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    button.addEventListener("click", () => window.requestAnimationFrame(updateButton));
    window.addEventListener("pointerup", () => window.requestAnimationFrame(updateButton));

    ensureInteractionSurface();
    updateButton();
  });
}
