namespace ICPDrawingLab {
  export function defaultVisiblePdfLayerIds(page: DrawingPage): string[] {
    const defaults = page.pdfLayers.filter((layer) => layer.visibleByDefault).map((layer) => layer.id);
    return defaults.length ? defaults : page.pdfLayers.map((layer) => layer.id);
  }

  export async function renderPdfLayerPreviewDataUrl(
    page: DrawingPage,
    selectedLayerIds: string[],
  ): Promise<string> {
    const rendered = await renderPdfLayers(page, selectedLayerIds, "white");
    const output = document.createElement("canvas");
    output.width = page.width;
    output.height = page.height;
    const context = output.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is not supported by this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(rendered, 0, 0, output.width, output.height);
    return output.toDataURL("image/png");
  }
}
