namespace ICPDrawingLab {
  const PDF_MODULE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_JS_VERSION}/build/pdf.min.mjs`;
  const PDF_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_JS_VERSION}/build/pdf.worker.min.mjs`;

  let pdfModulePromise: Promise<PdfJsModule> | null = null;

  async function getPdfModule(): Promise<PdfJsModule> {
    if (!pdfModulePromise) {
      pdfModulePromise = dynamicImport<PdfJsModule>(PDF_MODULE_URL).then((module) => {
        module.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        return module;
      });
    }
    return pdfModulePromise;
  }

  function pdfRenderScale(width: number, height: number): number {
    const longestEdge = Math.max(width, height) || MAX_RENDER_EDGE;
    return Math.min(3, MAX_RENDER_EDGE / longestEdge);
  }

  function textRunsFromPdf(
    textContent: PdfTextContentLike,
    viewport: PdfViewportLike,
    pdfjs: PdfJsModule,
  ): Array<{ text: string; box: BoundingBox; confidence: number | null; source: LabelSource }> {
    const runs: Array<{ text: string; box: BoundingBox; confidence: number | null; source: LabelSource }> = [];
    for (const item of textContent.items ?? []) {
      const text = String(item.str ?? "").trim();
      const transform = item.transform;
      if (!text || !Array.isArray(transform) || transform.length < 6) continue;
      const transformed = pdfjs.Util.transform(viewport.transform, transform);
      const fontHeight = Math.max(7, Math.abs(Number(item.height) || transformed[3] || 0));
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
      });
    }
    return runs;
  }

  export async function loadPdfFile(
    file: File,
    roomPattern: string,
    onProgress: (message: string) => void,
  ): Promise<DrawingPage[]> {
    const pdfjs = await getPdfModule();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: DrawingPage[] = [];
    const baseName = file.name.replace(/\.[^.]+$/, "");
    try {
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
          const textContent = await page.getTextContent();
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
        labels: labelsFromTextRuns(
          svgTextRuns(sanitized, rasterized.width, rasterized.height),
          roomPattern,
          rasterized.width,
          rasterized.height,
        ),
        rooms: [],
        analysisArea: null,
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
      if (isPdf) {
        pages.push(...await loadPdfFile(file, roomPattern, onProgress));
      } else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
        pages.push(...await loadImageFile(file, roomPattern));
      } else {
        throw new Error(`Unsupported drawing type: ${file.name}`);
      }
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
      labels: labelsFromTextRuns(
        svgTextRuns(sanitized, rasterized.width, rasterized.height),
        roomPattern,
        rasterized.width,
        rasterized.height,
      ),
      rooms: [],
      analysisArea: null,
    };
  }
}
