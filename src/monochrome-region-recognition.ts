namespace ICPDrawingLab {
  export interface MonochromeRegionDetectionOptions {
    threshold: number;
    bounds?: BoundingBox | null;
    maximumGap?: number;
    minimumAreaRatio?: number;
  }

  interface MonochromeComponent {
    pixels: number[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    touchesBoundary: boolean;
  }

  interface MonochromeBounds {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }

  interface PixelRun {
    start: number;
    end: number;
  }

  function monochromeBounds(width: number, height: number, bounds?: BoundingBox | null): MonochromeBounds {
    if (!bounds) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    const x0 = clamp(Math.floor(bounds.x), 0, Math.max(0, width - 1));
    const y0 = clamp(Math.floor(bounds.y), 0, Math.max(0, height - 1));
    const x1 = clamp(Math.ceil(bounds.x + bounds.width), x0, Math.max(x0, width - 1));
    const y1 = clamp(Math.ceil(bounds.y + bounds.height), y0, Math.max(y0, height - 1));
    return { x0, y0, x1, y1 };
  }

  function buildMonochromeWallMap(
    imageData: ImageData,
    threshold: number,
    bounds: MonochromeBounds,
  ): Uint8Array {
    const { width, height, data } = imageData;
    const walls = new Uint8Array(width * height);
    walls.fill(1);
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (let x = bounds.x0; x <= bounds.x1; x += 1) {
        const index = y * width + x;
        const offset = index * 4;
        const alpha = data[offset + 3];
        const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
        walls[index] = alpha >= 24 && luminance <= threshold ? 1 : 0;
      }
    }

    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      walls[bounds.y0 * width + x] = 1;
      walls[bounds.y1 * width + x] = 1;
    }
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      walls[y * width + bounds.x0] = 1;
      walls[y * width + bounds.x1] = 1;
    }
    return walls;
  }

  function horizontalRuns(map: Uint8Array, width: number, y: number, x0: number, x1: number): PixelRun[] {
    const runs: PixelRun[] = [];
    let x = x0;
    while (x <= x1) {
      while (x <= x1 && !map[y * width + x]) x += 1;
      if (x > x1) break;
      const start = x;
      while (x <= x1 && map[y * width + x]) x += 1;
      runs.push({ start, end: x - 1 });
    }
    return runs;
  }

  function verticalRuns(map: Uint8Array, width: number, x: number, y0: number, y1: number): PixelRun[] {
    const runs: PixelRun[] = [];
    let y = y0;
    while (y <= y1) {
      while (y <= y1 && !map[y * width + x]) y += 1;
      if (y > y1) break;
      const start = y;
      while (y <= y1 && map[y * width + x]) y += 1;
      runs.push({ start, end: y - 1 });
    }
    return runs;
  }

  function horizontalGapSupport(
    map: Uint8Array,
    width: number,
    height: number,
    y: number,
    leftX: number,
    rightX: number,
  ): number {
    let supportedRows = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      const row = y + offset;
      if (row < 0 || row >= height) continue;
      let leftSupported = false;
      let rightSupported = false;
      for (let sample = 0; sample <= 3; sample += 1) {
        leftSupported ||= Boolean(map[row * width + Math.max(0, leftX - sample)]);
        rightSupported ||= Boolean(map[row * width + Math.min(width - 1, rightX + sample)]);
      }
      if (leftSupported && rightSupported) supportedRows += 1;
    }
    return supportedRows;
  }

  function verticalGapSupport(
    map: Uint8Array,
    width: number,
    height: number,
    x: number,
    topY: number,
    bottomY: number,
  ): number {
    let supportedColumns = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      const column = x + offset;
      if (column < 0 || column >= width) continue;
      let topSupported = false;
      let bottomSupported = false;
      for (let sample = 0; sample <= 3; sample += 1) {
        topSupported ||= Boolean(map[Math.max(0, topY - sample) * width + column]);
        bottomSupported ||= Boolean(map[Math.min(height - 1, bottomY + sample) * width + column]);
      }
      if (topSupported && bottomSupported) supportedColumns += 1;
    }
    return supportedColumns;
  }

  function bridgeHorizontalWallGaps(
    map: Uint8Array,
    width: number,
    height: number,
    bounds: MonochromeBounds,
    maximumGap: number,
    minimumRun: number,
  ): Uint8Array {
    const result = map.slice();
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      const runs = horizontalRuns(map, width, y, bounds.x0, bounds.x1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const left = runs[index];
        const right = runs[index + 1];
        const gap = right.start - left.end - 1;
        const leftLength = left.end - left.start + 1;
        const rightLength = right.end - right.start + 1;
        if (gap <= 0 || gap > maximumGap || leftLength < minimumRun || rightLength < minimumRun) continue;
        if (horizontalGapSupport(map, width, height, y, left.end, right.start) < 4) continue;
        for (let x = left.end + 1; x < right.start; x += 1) result[y * width + x] = 1;
      }
    }
    return result;
  }

  function bridgeVerticalWallGaps(
    map: Uint8Array,
    width: number,
    height: number,
    bounds: MonochromeBounds,
    maximumGap: number,
    minimumRun: number,
  ): Uint8Array {
    const result = map.slice();
    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      const runs = verticalRuns(map, width, x, bounds.y0, bounds.y1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const top = runs[index];
        const bottom = runs[index + 1];
        const gap = bottom.start - top.end - 1;
        const topLength = top.end - top.start + 1;
        const bottomLength = bottom.end - bottom.start + 1;
        if (gap <= 0 || gap > maximumGap || topLength < minimumRun || bottomLength < minimumRun) continue;
        if (verticalGapSupport(map, width, height, x, top.end, bottom.start) < 4) continue;
        for (let y = top.end + 1; y < bottom.start; y += 1) result[y * width + x] = 1;
      }
    }
    return result;
  }

  function dilateWallMap(
    map: Uint8Array,
    width: number,
    height: number,
    bounds: MonochromeBounds,
    iterations: number,
  ): Uint8Array {
    let current = map;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const next = current.slice();
      for (let y = bounds.y0 + 1; y < bounds.y1; y += 1) {
        for (let x = bounds.x0 + 1; x < bounds.x1; x += 1) {
          const index = y * width + x;
          if (current[index]) continue;
          if (current[index - 1] || current[index + 1] || current[index - width] || current[index + width]) {
            next[index] = 1;
          }
        }
      }
      current = next;
    }
    return current;
  }

  function floodFreeComponents(
    wallMap: Uint8Array,
    width: number,
    height: number,
    bounds: MonochromeBounds,
  ): MonochromeComponent[] {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const components: MonochromeComponent[] = [];

    for (let startY = bounds.y0 + 1; startY < bounds.y1; startY += 1) {
      for (let startX = bounds.x0 + 1; startX < bounds.x1; startX += 1) {
        const start = startY * width + startX;
        if (wallMap[start] || visited[start]) continue;
        let head = 0;
        let tail = 0;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        let touchesBoundary = false;
        const pixels: number[] = [];
        queue[tail++] = start;
        visited[start] = 1;

        while (head < tail) {
          const index = queue[head++];
          const x = index % width;
          const y = Math.floor(index / width);
          pixels.push(index);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          if (x <= bounds.x0 + 1 || x >= bounds.x1 - 1 || y <= bounds.y0 + 1 || y >= bounds.y1 - 1) {
            touchesBoundary = true;
          }

          const neighbours = [index - 1, index + 1, index - width, index + width];
          for (const neighbour of neighbours) {
            if (neighbour < 0 || neighbour >= visited.length || visited[neighbour] || wallMap[neighbour]) continue;
            const neighbourX = neighbour % width;
            const neighbourY = Math.floor(neighbour / width);
            if (Math.abs(neighbourX - x) > 1) continue;
            if (neighbourX <= bounds.x0 || neighbourX >= bounds.x1 || neighbourY <= bounds.y0 || neighbourY >= bounds.y1) continue;
            visited[neighbour] = 1;
            queue[tail++] = neighbour;
          }
        }

        components.push({ pixels, minX, minY, maxX, maxY, touchesBoundary });
      }
    }
    return components;
  }

  function monochromePointKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  function monochromePolygonArea(points: PixelPoint[]): number {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
  }

  function traceMonochromeOutline(
    component: MonochromeComponent,
    componentMask: Uint8Array,
    width: number,
    height: number,
  ): PixelPoint[] {
    for (const index of component.pixels) componentMask[index] = 1;
    const edges = new Map<string, PixelPoint[]>();
    const addEdge = (fromX: number, fromY: number, toX: number, toY: number): void => {
      const key = monochromePointKey(fromX, fromY);
      const destinations = edges.get(key) ?? [];
      destinations.push({ x: toX, y: toY });
      edges.set(key, destinations);
    };

    for (const index of component.pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      if (y === 0 || !componentMask[index - width]) addEdge(x, y, x + 1, y);
      if (x === width - 1 || !componentMask[index + 1]) addEdge(x + 1, y, x + 1, y + 1);
      if (y === height - 1 || !componentMask[index + width]) addEdge(x + 1, y + 1, x, y + 1);
      if (x === 0 || !componentMask[index - 1]) addEdge(x, y + 1, x, y);
    }

    const loops: PixelPoint[][] = [];
    while (edges.size) {
      const first = edges.entries().next().value as [string, PixelPoint[]] | undefined;
      if (!first) break;
      const [startKey] = first;
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
        currentKey = monochromePointKey(next.x, next.y);
        if (currentKey === startKey) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }

    for (const index of component.pixels) componentMask[index] = 0;
    return loops.sort((left, right) => monochromePolygonArea(right) - monochromePolygonArea(left))[0] ?? [];
  }

  function monochromePerpendicularDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const factor = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point.x - (start.x + factor * dx), point.y - (start.y + factor * dy));
  }

  function simplifyMonochromePath(points: PixelPoint[], epsilon: number): PixelPoint[] {
    if (points.length <= 2) return points;
    let maximumDistance = 0;
    let splitIndex = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = monochromePerpendicularDistance(points[index], points[0], points[points.length - 1]);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        splitIndex = index;
      }
    }
    if (maximumDistance <= epsilon) return [points[0], points[points.length - 1]];
    const left = simplifyMonochromePath(points.slice(0, splitIndex + 1), epsilon);
    const right = simplifyMonochromePath(points.slice(splitIndex), epsilon);
    return left.slice(0, -1).concat(right);
  }

  function cyclicPath(points: PixelPoint[], start: number, end: number): PixelPoint[] {
    const path: PixelPoint[] = [points[start]];
    let index = start;
    while (index !== end) {
      index = (index + 1) % points.length;
      path.push(points[index]);
    }
    return path;
  }

  function removeMonochromeCollinearPoints(points: PixelPoint[], tolerance: number): PixelPoint[] {
    let result = points.slice();
    let changed = true;
    while (changed && result.length > 3) {
      changed = false;
      result = result.filter((point, index) => {
        const previous = result[(index - 1 + result.length) % result.length];
        const next = result[(index + 1) % result.length];
        const distance = monochromePerpendicularDistance(point, previous, next);
        const tinyEdge = Math.hypot(point.x - previous.x, point.y - previous.y) <= tolerance * 0.75;
        if (distance <= tolerance * 0.35 || tinyEdge) {
          changed = true;
          return false;
        }
        return true;
      });
    }
    return result;
  }

  function simplifyMonochromeLoop(outline: PixelPoint[], epsilon: number): PixelPoint[] {
    const ring = outline.length > 1
      && outline[0].x === outline[outline.length - 1].x
      && outline[0].y === outline[outline.length - 1].y
      ? outline.slice(0, -1)
      : outline.slice();
    if (ring.length <= 4) return ring;

    let first = 0;
    let second = 0;
    let maximum = -1;
    for (let index = 1; index < ring.length; index += 1) {
      const distance = (ring[index].x - ring[first].x) ** 2 + (ring[index].y - ring[first].y) ** 2;
      if (distance > maximum) {
        maximum = distance;
        second = index;
      }
    }
    first = second;
    maximum = -1;
    for (let index = 0; index < ring.length; index += 1) {
      const distance = (ring[index].x - ring[first].x) ** 2 + (ring[index].y - ring[first].y) ** 2;
      if (distance > maximum) {
        maximum = distance;
        second = index;
      }
    }

    const firstPath = simplifyMonochromePath(cyclicPath(ring, first, second), epsilon);
    const secondPath = simplifyMonochromePath(cyclicPath(ring, second, first), epsilon);
    let simplified = firstPath.slice(0, -1).concat(secondPath.slice(0, -1));
    simplified = removeMonochromeCollinearPoints(simplified, epsilon);
    while (simplified.length > 80) {
      epsilon *= 1.35;
      const left = simplifyMonochromePath(cyclicPath(ring, first, second), epsilon);
      const right = simplifyMonochromePath(cyclicPath(ring, second, first), epsilon);
      simplified = removeMonochromeCollinearPoints(left.slice(0, -1).concat(right.slice(0, -1)), epsilon);
    }
    return simplified;
  }

  function monochromeComponentToRegion(
    component: MonochromeComponent,
    componentMask: Uint8Array,
    width: number,
    height: number,
  ): VectorRegion | null {
    const outline = traceMonochromeOutline(component, componentMask, width, height);
    if (outline.length < 4) return null;
    const epsilon = Math.max(1.25, Math.max(width, height) / 900);
    const simplified = simplifyMonochromeLoop(outline, epsilon);
    const points = simplified.map((point) => ({
      x: round(clamp(point.x / width, 0, 1)),
      y: round(clamp(point.y / height, 0, 1)),
    }));
    if (points.length < 3) return null;
    const boundingArea = Math.max(1, (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
    const fillRatio = component.pixels.length / boundingArea;
    return {
      id: uid("monochrome-region"),
      points,
      pixelArea: component.pixels.length,
      confidence: clamp(0.68 + Math.min(1, fillRatio) * 0.22, 0.68, 0.9),
    };
  }

  export function detectMonochromeRegionsFromImageData(
    imageData: ImageData,
    options: MonochromeRegionDetectionOptions,
  ): VectorRegion[] {
    const { width, height } = imageData;
    const bounds = monochromeBounds(width, height, options.bounds);
    const longestEdge = Math.max(width, height);
    const maximumGap = options.maximumGap ?? clamp(Math.round(longestEdge * 0.052), 10, 74);
    const minimumRun = clamp(Math.round(longestEdge * 0.012), 8, 22);
    let wallMap = buildMonochromeWallMap(imageData, options.threshold, bounds);
    wallMap = bridgeHorizontalWallGaps(wallMap, width, height, bounds, maximumGap, minimumRun);
    wallMap = bridgeVerticalWallGaps(wallMap, width, height, bounds, maximumGap, minimumRun);
    wallMap = dilateWallMap(wallMap, width, height, bounds, longestEdge >= 900 ? 2 : 1);

    const pageArea = Math.max(1, (bounds.x1 - bounds.x0 + 1) * (bounds.y1 - bounds.y0 + 1));
    const minimumArea = Math.max(120, Math.round(pageArea * (options.minimumAreaRatio ?? 0.00045)));
    const maximumArea = Math.round(pageArea * 0.68);
    const componentMask = new Uint8Array(width * height);
    const regions: VectorRegion[] = [];

    for (const component of floodFreeComponents(wallMap, width, height, bounds)) {
      const componentWidth = component.maxX - component.minX + 1;
      const componentHeight = component.maxY - component.minY + 1;
      const boundingArea = componentWidth * componentHeight;
      const fillRatio = component.pixels.length / Math.max(1, boundingArea);
      if (component.touchesBoundary) continue;
      if (component.pixels.length < minimumArea || component.pixels.length > maximumArea) continue;
      if (componentWidth < 10 || componentHeight < 10 || fillRatio < 0.08) continue;
      const region = monochromeComponentToRegion(component, componentMask, width, height);
      if (region) regions.push(region);
      if (regions.length >= 180) break;
    }

    return regions.sort((left, right) => {
      const leftCentre = polygonCentroid(left.points);
      const rightCentre = polygonCentroid(right.points);
      const rowDifference = Math.round(leftCentre.y / 0.055) - Math.round(rightCentre.y / 0.055);
      return rowDifference || leftCentre.x - rightCentre.x;
    });
  }

  function monochromeAnalysisBounds(page: DrawingPage, width: number, height: number): BoundingBox | null {
    if (!page.analysisArea) return null;
    return {
      x: Math.floor(page.analysisArea.x / page.width * width),
      y: Math.floor(page.analysisArea.y / page.height * height),
      width: Math.ceil(page.analysisArea.width / page.width * width),
      height: Math.ceil(page.analysisArea.height / page.height * height),
    };
  }

  export async function detectMonochromeRegions(page: DrawingPage, threshold: number): Promise<VectorRegion[]> {
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
    return detectMonochromeRegionsFromImageData(
      context.getImageData(0, 0, canvas.width, canvas.height),
      {
        threshold,
        bounds: monochromeAnalysisBounds(page, canvas.width, canvas.height),
      },
    );
  }
}
