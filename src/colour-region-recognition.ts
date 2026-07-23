namespace ICPDrawingLab {
  interface ColourPixel {
    r: number;
    g: number;
    b: number;
  }

  interface ColourComponent {
    mask: Uint8Array;
    pixels: number[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    mean: ColourPixel;
  }

  function pixelAt(data: Uint8ClampedArray, index: number): ColourPixel {
    const offset = index * 4;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
  }

  function colourDistanceSquared(left: ColourPixel, right: ColourPixel): number {
    const dr = left.r - right.r;
    const dg = left.g - right.g;
    const db = left.b - right.b;
    return dr * dr + dg * dg + db * db;
  }

  function usableColour(pixel: ColourPixel, saturationFloor: number): boolean {
    const maximum = Math.max(pixel.r, pixel.g, pixel.b);
    const minimum = Math.min(pixel.r, pixel.g, pixel.b);
    const brightness = (pixel.r + pixel.g + pixel.b) / 3;
    const saturation = maximum ? (maximum - minimum) / maximum : 0;
    return brightness > 42 && brightness < 248 && saturation >= saturationFloor;
  }

  function areaBounds(page: DrawingPage, width: number, height: number): BoundingBox | null {
    if (!page.analysisArea) return null;
    return {
      x: Math.floor(page.analysisArea.x / page.width * width),
      y: Math.floor(page.analysisArea.y / page.height * height),
      width: Math.ceil(page.analysisArea.width / page.width * width),
      height: Math.ceil(page.analysisArea.height / page.height * height),
    };
  }

  function insideBounds(x: number, y: number, bounds: BoundingBox | null): boolean {
    if (!bounds) return true;
    return x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.width && y <= bounds.y + bounds.height;
  }

  function floodComponent(
    imageData: ImageData,
    start: number,
    visited: Uint8Array,
    tolerance: number,
    saturationFloor: number,
    bounds: BoundingBox | null,
  ): ColourComponent | null {
    const { width, height, data } = imageData;
    const seed = pixelAt(data, start);
    if (!usableColour(seed, saturationFloor)) return null;
    const toleranceSquared = tolerance * tolerance;
    const driftToleranceSquared = toleranceSquared * 1.55;
    const queue = new Int32Array(width * height);
    const mask = new Uint8Array(width * height);
    const pixels: number[] = [];
    let head = 0;
    let tail = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (!insideBounds(x, y, bounds)) continue;
      const pixel = pixelAt(data, index);
      if (!usableColour(pixel, saturationFloor)) continue;
      const mean = pixels.length
        ? { r: sumR / pixels.length, g: sumG / pixels.length, b: sumB / pixels.length }
        : seed;
      if (colourDistanceSquared(pixel, seed) > driftToleranceSquared
        || colourDistanceSquared(pixel, mean) > toleranceSquared) continue;

      mask[index] = 1;
      pixels.push(index);
      sumR += pixel.r;
      sumG += pixel.g;
      sumB += pixel.b;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbours = [index - 1, index + 1, index - width, index + width];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= visited.length || visited[neighbour]) continue;
        const neighbourX = neighbour % width;
        if (Math.abs(neighbourX - x) > 1) continue;
        visited[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }

    if (!pixels.length) return null;
    return {
      mask,
      pixels,
      minX,
      minY,
      maxX,
      maxY,
      mean: { r: sumR / pixels.length, g: sumG / pixels.length, b: sumB / pixels.length },
    };
  }

  function pointKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  function polygonArea(points: PixelPoint[]): number {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
  }

  function traceComponentOutline(component: ColourComponent, width: number, height: number): PixelPoint[] {
    const edges = new Map<string, PixelPoint[]>();
    const addEdge = (fromX: number, fromY: number, toX: number, toY: number): void => {
      const key = pointKey(fromX, fromY);
      const values = edges.get(key) ?? [];
      values.push({ x: toX, y: toY });
      edges.set(key, values);
    };
    for (const index of component.pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      if (y === 0 || !component.mask[index - width]) addEdge(x, y, x + 1, y);
      if (x === width - 1 || !component.mask[index + 1]) addEdge(x + 1, y, x + 1, y + 1);
      if (y === height - 1 || !component.mask[index + width]) addEdge(x + 1, y + 1, x, y + 1);
      if (x === 0 || !component.mask[index - 1]) addEdge(x, y + 1, x, y);
    }

    const loops: PixelPoint[][] = [];
    while (edges.size) {
      const firstEntry = edges.entries().next().value as [string, PixelPoint[]] | undefined;
      if (!firstEntry) break;
      const [startKey, destinations] = firstEntry;
      const [startX, startY] = startKey.split(",").map(Number);
      const loop: PixelPoint[] = [{ x: startX, y: startY }];
      let currentKey = startKey;
      let guard = 0;
      while (guard++ < width * height * 4) {
        const available = edges.get(currentKey);
        if (!available?.length) break;
        const next = available.pop()!;
        if (!available.length) edges.delete(currentKey);
        loop.push(next);
        currentKey = pointKey(next.x, next.y);
        if (currentKey === startKey) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
    return loops.sort((left, right) => polygonArea(right) - polygonArea(left))[0] ?? [];
  }

  function perpendicularDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  function simplify(points: PixelPoint[], epsilon: number): PixelPoint[] {
    if (points.length <= 4) return points;
    let maximumDistance = 0;
    let splitIndex = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = perpendicularDistance(points[index], points[0], points[points.length - 1]);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        splitIndex = index;
      }
    }
    if (maximumDistance <= epsilon) return [points[0], points[points.length - 1]];
    const left = simplify(points.slice(0, splitIndex + 1), epsilon);
    const right = simplify(points.slice(splitIndex), epsilon);
    return left.slice(0, -1).concat(right);
  }

  function componentToRegion(component: ColourComponent, width: number, height: number): VectorRegion | null {
    const outline = traceComponentOutline(component, width, height);
    if (outline.length < 4) return null;
    const closed = outline[0].x === outline[outline.length - 1].x && outline[0].y === outline[outline.length - 1].y
      ? outline
      : outline.concat(outline[0]);
    const simplified = simplify(closed, Math.max(1.2, Math.max(width, height) / 850));
    const points = simplified.slice(0, -1).map((point) => ({
      x: round(point.x / width),
      y: round(point.y / height),
    }));
    if (points.length < 3) return null;
    const boundingArea = Math.max(1, (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
    const fillRatio = component.pixels.length / boundingArea;
    return {
      id: uid("colour-region"),
      points,
      pixelArea: component.pixels.length,
      confidence: clamp(0.62 + fillRatio * 0.28, 0.62, 0.93),
    };
  }

  export async function detectColourRegions(
    page: DrawingPage,
    tolerance: number,
    saturationFloor: number,
  ): Promise<VectorRegion[]> {
    const image = await loadImage(page.imageDataUrl);
    const maximumEdge = 1400;
    const scale = Math.min(1, maximumEdge / Math.max(page.width, page.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(page.width * scale));
    canvas.height = Math.max(1, Math.round(page.height * scale));
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("Canvas is not supported by this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const visited = new Uint8Array(canvas.width * canvas.height);
    const bounds = areaBounds(page, canvas.width, canvas.height);
    const pageArea = canvas.width * canvas.height;
    const minimumArea = Math.max(75, Math.round(pageArea * 0.00012));
    const maximumArea = Math.round(pageArea * 0.72);
    const regions: VectorRegion[] = [];

    for (let index = 0; index < visited.length; index += 1) {
      if (visited[index]) continue;
      const x = index % canvas.width;
      const y = Math.floor(index / canvas.width);
      if (!insideBounds(x, y, bounds)) {
        visited[index] = 1;
        continue;
      }
      const component = floodComponent(imageData, index, visited, tolerance, saturationFloor, bounds);
      if (!component || component.pixels.length < minimumArea || component.pixels.length > maximumArea) continue;
      if (component.maxX - component.minX < 7 || component.maxY - component.minY < 7) continue;
      const region = componentToRegion(component, canvas.width, canvas.height);
      if (region) regions.push(region);
      if (regions.length >= 180) break;
    }

    return regions.sort((left, right) => right.pixelArea - left.pixelArea);
  }
}
