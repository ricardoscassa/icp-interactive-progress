namespace ICPDrawingLab {
  interface PdfTextRun {
    text: string;
    box: BoundingBox;
    confidence: number | null;
    source: LabelSource;
    fontHeight: number;
    angle: number;
  }

  function pdfRenderScale(width: number, height: number): number {
    const longestEdge = Math.max(width, height) || MAX_RENDER_EDGE;
    return Math.min(3, MAX_RENDER_EDGE / longestEdge);
  }

  function rawTextRunsFromPdf(
    textContent: PdfTextContentLike,
    viewport: PdfViewportLike,
    pdfjs: PdfJsModule,
  ): PdfTextRun[] {
    const runs: PdfTextRun[] = [];
    for (const item of textContent.items ?? []) {
      const text = String(item.str ?? "").trim();
      const transform = item.transform;
      if (!text || !Array.isArray(transform) || transform.length < 6) continue;
      const transformed = pdfjs.Util.transform(viewport.transform, transform);
      const fontHeight = Math.max(7, Math.hypot(Number(transformed[2]) || 0, Number(transformed[3]) || 0));
      const width = Math.max(text.length * fontHeight * 0.42, Math.abs(Number(item.width) || 0));
      runs.push({
        text,
        box: {
          x: transformed[4],
          y: transformed[5] - fontHeight,
          width,
          height: fontHeight,
        },
        confidence: null,
        source: "pdf-text",
        fontHeight,
        angle: Math.atan2(Number(transformed[1]) || 0, Number(transformed[0]) || 1),
      });
    }
    return runs;
  }

  function combinedPdfTextRuns(runs: PdfTextRun[]): PdfTextRun[] {
    const combined = runs.slice();
    const nearest = runs.map((run) => runs
      .filter((candidate) => candidate !== run)
      .map((candidate) => {
        const runCenter = { x: run.box.x + run.box.width / 2, y: run.box.y + run.box.height / 2 };
        const candidateCenter = { x: candidate.box.x + candidate.box.width / 2, y: candidate.box.y + candidate.box.height / 2 };
        return { candidate, distance: Math.hypot(candidateCenter.x - runCenter.x, candidateCenter.y - runCenter.y) };
      })
      .filter(({ candidate, distance }) => {
        const scale = Math.max(run.fontHeight, candidate.fontHeight);
        const angleDelta = Math.abs(run.angle - candidate.angle);
        return distance <= scale * 8 && Math.min(angleDelta, Math.abs(Math.PI - angleDelta)) <= 0.3;
      })
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3));

    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      for (const { candidate } of nearest[index]) {
        const ordered = [run, candidate].sort((left, right) => {
          const horizontal = Math.abs(Math.cos(run.angle)) >= Math.abs(Math.sin(run.angle));
          return horizontal ? left.box.x - right.box.x : left.box.y - right.box.y;
        });
        const x = Math.min(...ordered.map((item) => item.box.x));
        const y = Math.min(...ordered.map((item) => item.box.y));
        const maximumX = Math.max(...ordered.map((item) => item.box.x + item.box.width));
        const maximumY = Math.max(...ordered.map((item) => item.box.y + item.box.height));
        combined.push({
          text: ordered.map((item) => item.text).join(" "),
          box: { x, y, width: maximumX - x, height: maximumY - y },
          confidence: null,
          source: "pdf-text",
          fontHeight: Math.max(run.fontHeight, candidate.fontHeight),
          angle: run.angle,
        });
      }
    }
    return combined;
  }

  function textRunsFromPdf(
    textContent: PdfTextContentLike,
    viewport: PdfViewportLike,
    pdfjs: PdfJsModule,
  ): Array<{ text: string; box: BoundingBox; confidence: number | null; source: LabelSource }> {
    return combinedPdfTextRuns(rawTextRunsFromPdf(textContent, viewport, pdfjs));
  }

  export async function loadPdfFile(
    file: File,
    roomPattern: string,
    onProgress: (message: string) => void,
  ): Promise<DrawingPage[]> {
    const pdfjs = await getPdfModule();
    const sourceData = await file.arrayBuffer();
    const sourceKey = uid("pdf-source");
    registerPdfSource(sourceKey, sourceData);
    const pdf = await pdfjs.getDocument({ data: sourceData.slice(0) }).promise;
    const pages: DrawingPage[] = [];
    const baseName = file.name.replace(/\.[^.]+$/, "");
    let layers: PdfLayerInfo[] = [];
    try {
      const optionalContentConfig = await pdf.getOptionalContentConfig?.({ intent: "any" });
      layers = pdfLayerInfos(optionalContentConfig ?? null);
      const suggestedLayers = suggestPdfLayerSelections(layers);
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        onProgress(`Rendering PDF page ${pageNumber} of ${pdf.numPages}…`);
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: pdfRenderScale(baseViewport.width, baseViewport.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is not supported by this browser.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, background: "white" }).promise;

        let labels: DetectedLabel[] = [];
        try {
          const textContent = await page.getTextContent({ includeMarkedContent: true });
          labels = labelsFromTextRuns(
            textRunsFromPdf(textContent, viewport, pdfjs),
            roomPattern,
            canvas.width,
            canvas.height,
          );
        } catch (error) {
          console.warn(`Could not extract text from PDF page ${pageNumber}.`, error);
        }

        pages.push({
          id: uid("page"),
          name: pdf.numPages > 1 ? `${baseName} · Page ${pageNumber}` : baseName,
          sourceType: "pdf",
          width: canvas.width,
          height: canvas.height,
          imageDataUrl: canvas.toDataURL("image/png"),
          labels,
          rooms: [],
          analysisArea: null,
          pdfSourceKey: sourceKey,
          pdfPageNumber: pageNumber,
          pdfLayers: layers,
          selectedAreaLayerIds: suggestedLayers.areaLayerIds,
          selectedLabelLayerIds: suggestedLayers.labelLayerIds,
        });
      }
    } finally {
      if (typeof pdf.destroy === "function") await pdf.destroy();
    }
    return pages;
  }

  function sanitizeSvg(svgText: string): string {
    const parser = new DOMParser();
    const documentValue = parser.parseFromString(svgText, "image/svg+xml");
    if (documentValue.querySelector("parsererror")) throw new Error("The SVG file is not valid XML.");
    documentValue.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
    documentValue.querySelectorAll<HTMLElement>("*").forEach((node) => {
      for (const attribute of Array.from(node.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on")) node.removeAttribute(attribute.name);
        if ((name === "href" || name === "xlink:href") && /^(?:https?:|javascript:|data:text\/html)/i.test(value)) {
          node.removeAttribute(attribute.name);
        }
      }
    });
    return new XMLSerializer().serializeToString(documentValue.documentElement);
  }

  function svgTextRuns(svgText: string, targetWidth: number, targetHeight: number): Array<{
    text: string;
    box: BoundingBox;
    confidence: number | null;
    source: LabelSource;
  }> {
    const parser = new DOMParser();
    const documentValue = parser.parseFromString(svgText, "image/svg+xml");
    const root = documentValue.documentElement;
    const viewBox = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    const svgWidth = viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : Number(root.getAttribute("width")) || targetWidth;
    const svgHeight = viewBox.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : Number(root.getAttribute("height")) || targetHeight;
    const offsetX = viewBox.length === 4 && Number.isFinite(viewBox[0]) ? viewBox[0] : 0;
    const offsetY = viewBox.length === 4 && Number.isFinite(viewBox[1]) ? viewBox[1] : 0;
    const scaleX = targetWidth / Math.max(1, svgWidth);
    const scaleY = targetHeight / Math.max(1, svgHeight);

    const runs: Array<{ text: string; box: BoundingBox; confidence: number | null; source: LabelSource }> = [];
    for (const element of Array.from(documentValue.querySelectorAll("text"))) {
      const text = String(element.textContent ?? "").trim();
      const x = Number((element.getAttribute("x") ?? "0").split(/[\s,]+/)[0]);
      const y = Number((element.getAttribute("y") ?? "0").split(/[\s,]+/)[0]);
      const fontSize = Number(element.getAttribute("font-size")) || 18;
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      runs.push({
        text,
        box: {
          x: (x - offsetX) * scaleX,
          y: (y - offsetY - fontSize) * scaleY,
          width: Math.max(fontSize * 0.5 * text.length * scaleX, 8),
          height: Math.max(fontSize * scaleY, 8),
        },
        confidence: null,
        source: "svg-text",
      });
    }
    return runs;
  }

  function nonPdfPageDefaults(): Pick<DrawingPage, "pdfSourceKey" | "pdfPageNumber" | "pdfLayers" | "selectedAreaLayerIds" | "selectedLabelLayerIds"> {
    return {
      pdfSourceKey: null,
      pdfPageNumber: null,
      pdfLayers: [],
      selectedAreaLayerIds: [],
      selectedLabelLayerIds: [],
    };
  }

  export async function loadImageFile(file: File, roomPattern: string): Promise<DrawingPage[]> {
    const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (isSvg) {
      const sanitized = sanitizeSvg(await file.text());
      const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
      const rasterized = await rasterizeImage(source);
      return [{
        id: uid("page"),
        name: file.name.replace(/\.[^.]+$/, ""),
        sourceType: "svg",
        width: rasterized.width,
        height: rasterized.height,
        imageDataUrl: rasterized.dataUrl,
        labels: labelsFromTextRuns(svgTextRuns(sanitized, rasterized.width, rasterized.height), roomPattern, rasterized.width, rasterized.height),
        rooms: [],
        analysisArea: null,
        ...nonPdfPageDefaults(),
      }];
    }

    const source = await readFileAsDataUrl(file);
    const rasterized = await rasterizeImage(source);
    return [{
      id: uid("page"),
      name: file.name.replace(/\.[^.]+$/, ""),
      sourceType: "image",
      width: rasterized.width,
      height: rasterized.height,
      imageDataUrl: rasterized.dataUrl,
      labels: [],
      rooms: [],
      analysisArea: null,
      ...nonPdfPageDefaults(),
    }];
  }

  export async function loadDrawingFiles(
    files: File[],
    roomPattern: string,
    onProgress: (message: string) => void,
  ): Promise<DrawingPage[]> {
    const pages: DrawingPage[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      onProgress(`Loading ${index + 1} of ${files.length}: ${file.name}`);
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) pages.push(...await loadPdfFile(file, roomPattern, onProgress));
      else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg)$/i.test(file.name)) pages.push(...await loadImageFile(file, roomPattern));
      else throw new Error(`Unsupported drawing type: ${file.name}`);
    }
    return pages;
  }

  export async function loadSamplePage(roomPattern: string): Promise<DrawingPage> {
    const response = await fetch("./sample-floor.svg", { cache: "no-store" });
    if (!response.ok) throw new Error("The bundled sample drawing could not be loaded.");
    const svgText = await response.text();
    const sanitized = sanitizeSvg(svgText);
    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
    const rasterized = await rasterizeImage(source);
    return {
      id: uid("page"),
      name: "Sample · Building 1A · Level 01",
      sourceType: "sample",
      width: rasterized.width,
      height: rasterized.height,
      imageDataUrl: rasterized.dataUrl,
      labels: labelsFromTextRuns(svgTextRuns(sanitized, rasterized.width, rasterized.height), roomPattern, rasterized.width, rasterized.height),
      rooms: [],
      analysisArea: null,
      ...nonPdfPageDefaults(),
    };
  }
}