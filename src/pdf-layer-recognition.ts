namespace ICPDrawingLab {
  const PDF_MODULE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_JS_VERSION}/build/pdf.min.mjs`;
  const PDF_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_JS_VERSION}/build/pdf.worker.min.mjs`;
  const pdfSourceRegistry = new Map<string, Uint8Array>();
  let pdfModulePromise: Promise<PdfJsModule> | null = null;

  export async function getPdfModule(): Promise<PdfJsModule> {
    if (!pdfModulePromise) {
      pdfModulePromise = dynamicImport<PdfJsModule>(PDF_MODULE_URL).then((module) => {
        module.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        return module;
      });
    }
    return pdfModulePromise;
  }

  export function registerPdfSource(sourceKey: string, data: ArrayBuffer): void {
    pdfSourceRegistry.set(sourceKey, new Uint8Array(data.slice(0)));
  }

  export function hasRegisteredPdfSource(sourceKey: string | null): boolean {
    return Boolean(sourceKey && pdfSourceRegistry.has(sourceKey));
  }

  function registeredPdfData(sourceKey: string | null): ArrayBuffer {
    if (!sourceKey) throw new Error("This drawing page is not linked to an uploaded PDF source.");
    const source = pdfSourceRegistry.get(sourceKey);
    if (!source) throw new Error("Re-upload the original PDF before using layer recognition on this saved project.");
    return source.slice().buffer;
  }

  export function pdfLayerInfos(config: PdfOptionalContentConfigLike | null): PdfLayerInfo[] {
    const groups = config?.getGroups?.() ?? {};
    return Object.entries(groups).map(([id, group]) => ({
      id,
      name: String(group?.name ?? id),
      visibleByDefault: group?.visible !== false,
    }));
  }

  function layerNameScore(name: string, kind: "area" | "label"): number {
    const value = name.toUpperCase();
    if (kind === "area") {
      let score = 0;
      if (value.includes("ERECTION_AREA")) score += 100;
      if (value.includes("AREA")) score += 30;
      if (value.includes("ROOM")) score += 20;
      if (value.includes("HATCH")) score -= 35;
      if (value.includes("NAME") || value.includes("TEXT") || value.includes("TITLE")) score -= 80;
      return score;
    }
    let score = 0;
    if (value.includes("NAME_ERECTION_AREA")) score += 120;
    if (value.includes("NAME")) score += 50;
    if (value.includes("TEXT")) score += 35;
    if (value.includes("ROOM")) score += 25;
    if (value.includes("TITLE_BLOCK")) score -= 100;
    if (value.includes("AREA") && !value.includes("NAME")) score -= 20;
    return score;
  }

  export function suggestPdfLayerSelections(layers: PdfLayerInfo[]): {
    areaLayerIds: string[];
    labelLayerIds: string[];
  } {
    const rankedArea = layers
      .map((layer) => ({ layer, score: layerNameScore(layer.name, "area") }))
      .sort((left, right) => right.score - left.score);
    const rankedLabel = layers
      .map((layer) => ({ layer, score: layerNameScore(layer.name, "label") }))
      .sort((left, right) => right.score - left.score);
    return {
      areaLayerIds: rankedArea[0]?.score > 0 ? [rankedArea[0].layer.id] : [],
      labelLayerIds: rankedLabel[0]?.score > 0 ? [rankedLabel[0].layer.id] : [],
    };
  }

  function configureSelectedLayers(config: PdfOptionalContentConfigLike, selectedLayerIds: string[]): void {
    const groups = config.getGroups?.() ?? {};
    const selected = new Set(selectedLayerIds);
    for (const id of Object.keys(groups)) {
      config.setVisibility?.(id, selected.has(id), false);
    }
  }

  export async function renderPdfLayers(
    drawingPage: DrawingPage,
    selectedLayerIds: string[],
    background = "rgba(0,0,0,0)",
  ): Promise<HTMLCanvasElement> {
    if (drawingPage.sourceType !== "pdf" || drawingPage.pdfPageNumber === null) {
      throw new Error("Layer rendering is only available for uploaded PDF pages.");
    }
    if (!selectedLayerIds.length) throw new Error("Select at least one PDF layer first.");
    const pdfjs = await getPdfModule();
    const pdf = await pdfjs.getDocument({ data: registeredPdfData(drawingPage.pdfSourceKey) }).promise;
    try {
      const page = await pdf.getPage(drawingPage.pdfPageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(drawingPage.width / Math.max(1, baseViewport.width), drawingPage.height / Math.max(1, baseViewport.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
      if (!context) throw new Error("Canvas is not supported by this browser.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      const config = await pdf.getOptionalContentConfig?.({ intent: "any" });
      if (!config) throw new Error("This PDF does not expose an optional-content layer configuration.");
      configureSelectedLayers(config, selectedLayerIds);
      await page.render({
        canvasContext: context,
        viewport,
        background,
        optionalContentConfigPromise: Promise.resolve(config),
      }).promise;
      return canvas;
    } finally {
      if (typeof pdf.destroy === "function") await pdf.destroy();
    }
  }

  interface MaskComponent {
    pixels: number[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  function componentMask(imageData: ImageData): Uint8Array {
    const mask = new Uint8Array(imageData.width * imageData.height);
    for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
      const alpha = imageData.data[offset + 3];
      if (alpha < 18) continue;
      const red = imageData.data[offset];
      const green = imageData.data[offset + 1];
      const blue = imageData.data[offset + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const saturation = maximum - minimum;
      const darkness = 255 - (red + green + blue) / 3;
      if (saturation >= 12 || darkness >= 28) mask[pixel] = 1;
    }
    return mask;
  }

  function connectedComponents(mask: Uint8Array, width: number, height: number): MaskComponent[] {
    const visited = new Uint8Array(mask.length);
    const components: MaskComponent[] = [];
    const queue = new Int32Array(mask.length);
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      const pixels: number[] = [];
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      while (head < tail) {
        const index = queue[head++];
        pixels.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        const neighbours = [index - 1, index + 1, index - width, index + width];
        for (const neighbour of neighbours) {
          if (neighbour < 0 || neighbour >= mask.length || visited[neighbour] || !mask[neighbour]) continue;
          const nx = neighbour % width;
          if (Math.abs(nx - x) > 1) continue;
          visited[neighbour] = 1;
          queue[tail++] = neighbour;
        }
      }
      components.push({ pixels, minX, minY, maxX, maxY });
    }
    return components;
  }

  function cross(origin: PixelPoint, left: PixelPoint, right: PixelPoint): number {
    return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
  }

  function convexHull(points: PixelPoint[]): PixelPoint[] {
    if (points.length <= 3) return points;
    const sorted = points.slice().sort((left, right) => left.x - right.x || left.y - right.y);
    const lower: PixelPoint[] = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
      lower.push(point);
    }
    const upper: PixelPoint[] = [];
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const point = sorted[index];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function boundaryPoints(component: MaskComponent, mask: Uint8Array, width: number, height: number): PixelPoint[] {
    const points: PixelPoint[] = [];
    const stride = Math.max(1, Math.floor(component.pixels.length / 1800));
    for (let position = 0; position < component.pixels.length; position += stride) {
      const index = component.pixels[position];
      const x = index % width;
      const y = Math.floor(index / width);
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1
        || !mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width];
      if (edge) points.push({ x, y });
    }
    return points;
  }

  function downsampleLayerCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const maximumEdge = 1100;
    const scale = Math.min(1, maximumEdge / Math.max(canvas.width, canvas.height));
    if (scale === 1) return canvas;
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.round(canvas.width * scale));
    smaller.height = Math.max(1, Math.round(canvas.height * scale));
    const context = smaller.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) throw new Error("Canvas is not supported by this browser.");
    context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    return smaller;
  }

  export function detectVectorRegionsFromImageData(imageData: ImageData): VectorRegion[] {
    const mask = componentMask(imageData);
    const pageArea = imageData.width * imageData.height;
    const minimumArea = Math.max(100, Math.round(pageArea * 0.00018));
    return connectedComponents(mask, imageData.width, imageData.height)
      .filter((component) => component.pixels.length >= minimumArea)
      .filter((component) => component.maxX - component.minX >= 8 && component.maxY - component.minY >= 8)
      .filter((component) => {
        const boundingArea = (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1);
        const fillRatio = component.pixels.length / Math.max(1, boundingArea);
        return boundingArea < pageArea * 0.82 && fillRatio >= 0.035;
      })
      .map((component) => {
        const hull = convexHull(boundaryPoints(component, mask, imageData.width, imageData.height));
        const points = hull.map((point) => ({
          x: round(point.x / imageData.width),
          y: round(point.y / imageData.height),
        }));
        const fillRatio = component.pixels.length
          / Math.max(1, (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
        return {
          id: uid("vector-region"),
          points,
          pixelArea: component.pixels.length,
          confidence: clamp(0.58 + fillRatio * 0.35, 0.58, 0.94),
        };
      })
      .filter((region) => region.points.length >= 3)
      .sort((left, right) => right.pixelArea - left.pixelArea);
  }

  export async function detectPdfVectorRegions(drawingPage: DrawingPage): Promise<VectorRegion[]> {
    const canvas = await renderPdfLayers(drawingPage, drawingPage.selectedAreaLayerIds);
    const sampled = downsampleLayerCanvas(canvas);
    const context = sampled.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) throw new Error("Canvas is not supported by this browser.");
    return detectVectorRegionsFromImageData(context.getImageData(0, 0, sampled.width, sampled.height));
  }

  function pointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const currentPoint = polygon[index];
      const previousPoint = polygon[previous];
      const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y))
        && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
          / ((previousPoint.y - currentPoint.y) || Number.EPSILON) + currentPoint.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  export function vectorRegionForLabel(label: DetectedLabel, page: DrawingPage, regions: VectorRegion[]): VectorRegion | null {
    const centre = {
      x: (label.box.x + label.box.width / 2) / Math.max(1, page.width),
      y: (label.box.y + label.box.height / 2) / Math.max(1, page.height),
    };
    const containing = regions.filter((region) => pointInPolygon(centre, region.points));
    if (containing.length) return containing.sort((left, right) => left.pixelArea - right.pixelArea)[0];
    const ranked = regions.map((region) => {
      const centroid = polygonCentroid(region.points);
      return { region, distance: Math.hypot(centroid.x - centre.x, centroid.y - centre.y) };
    }).sort((left, right) => left.distance - right.distance);
    return ranked[0]?.distance <= 0.08 ? ranked[0].region : null;
  }
}
