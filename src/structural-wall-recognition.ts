namespace ICPDrawingLab {
  export interface StructuralRoomDetectionOptions {
    threshold: number;
    bounds?: BoundingBox | null;
    maximumDoorGap?: number;
    minimumAreaRatio?: number;
  }

  interface StructuralBounds {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }

  interface StructuralRun {
    start: number;
    end: number;
  }

  interface StructuralComponent {
    pixels: number[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    touchesBoundary: boolean;
  }

  function structuralBounds(width: number, height: number, bounds?: BoundingBox | null): StructuralBounds {
    if (!bounds) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    const x0 = clamp(Math.floor(bounds.x), 0, Math.max(0, width - 1));
    const y0 = clamp(Math.floor(bounds.y), 0, Math.max(0, height - 1));
    const x1 = clamp(Math.ceil(bounds.x + bounds.width), x0, Math.max(x0, width - 1));
    const y1 = clamp(Math.ceil(bounds.y + bounds.height), y0, Math.max(y0, height - 1));
    return { x0, y0, x1, y1 };
  }

  function rawDarkPixels(imageData: ImageData, threshold: number, bounds: StructuralBounds): Uint8Array {
    const { width, height, data } = imageData;
    const dark = new Uint8Array(width * height);
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (let x = bounds.x0; x <= bounds.x1; x += 1) {
        const index = y * width + x;
        const offset = index * 4;
        const alpha = data[offset + 3];
        const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
        dark[index] = alpha >= 24 && luminance <= threshold ? 1 : 0;
      }
    }
    return dark;
  }

  function rowRuns(map: Uint8Array, width: number, y: number, x0: number, x1: number): StructuralRun[] {
    const runs: StructuralRun[] = [];
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

  function columnRuns(map: Uint8Array, width: number, x: number, y0: number, y1: number): StructuralRun[] {
    const runs: StructuralRun[] = [];
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

  function overlapRatio(left: StructuralRun, right: StructuralRun): number {
    const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start) + 1);
    const shorter = Math.max(1, Math.min(left.end - left.start + 1, right.end - right.start + 1));
    return overlap / shorter;
  }

  function hasParallelRowSupport(
    dark: Uint8Array,
    width: number,
    bounds: StructuralBounds,
    y: number,
    run: StructuralRun,
    probe: number,
  ): boolean {
    for (let distance = 2; distance <= probe; distance += 1) {
      for (const row of [y - distance, y + distance]) {
        if (row < bounds.y0 || row > bounds.y1) continue;
        if (rowRuns(dark, width, row, run.start, run.end).some((candidate) => overlapRatio(run, candidate) >= 0.48)) return true;
      }
    }
    return false;
  }

  function hasParallelColumnSupport(
    dark: Uint8Array,
    width: number,
    bounds: StructuralBounds,
    x: number,
    run: StructuralRun,
    probe: number,
  ): boolean {
    for (let distance = 2; distance <= probe; distance += 1) {
      for (const column of [x - distance, x + distance]) {
        if (column < bounds.x0 || column > bounds.x1) continue;
        if (columnRuns(dark, width, column, run.start, run.end).some((candidate) => overlapRatio(run, candidate) >= 0.48)) return true;
      }
    }
    return false;
  }

  function markHorizontalRun(map: Uint8Array, width: number, y: number, run: StructuralRun): void {
    for (let x = run.start; x <= run.end; x += 1) map[y * width + x] = 1;
  }

  function markVerticalRun(map: Uint8Array, width: number, x: number, run: StructuralRun): void {
    for (let y = run.start; y <= run.end; y += 1) map[y * width + x] = 1;
  }

  function directionalWallCore(
    dark: Uint8Array,
    width: number,
    height: number,
    bounds: StructuralBounds,
  ): Uint8Array {
    const longestEdge = Math.max(width, height);
    const longRun = clamp(Math.round(longestEdge * 0.052), 34, 82);
    const shortRun = clamp(Math.round(longestEdge * 0.016), 12, 28);
    const parallelProbe = clamp(Math.round(longestEdge * 0.021), 10, 30);
    const core = new Uint8Array(width * height);
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (const run of rowRuns(dark, width, y, bounds.x0, bounds.x1)) {
        const length = run.end - run.start + 1;
        if (length >= longRun || (length >= shortRun && hasParallelRowSupport(dark, width, bounds, y, run, parallelProbe))) markHorizontalRun(core, width, y, run);
      }
    }
    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      for (const run of columnRuns(dark, width, x, bounds.y0, bounds.y1)) {
        const length = run.end - run.start + 1;
        if (length >= longRun || (length >= shortRun && hasParallelColumnSupport(dark, width, bounds, x, run, parallelProbe))) markVerticalRun(core, width, x, run);
      }
    }
    return core;
  }

  function localDarkCount(map: Uint8Array, width: number, height: number, x: number, y: number, radius: number): number {
    let count = 0;
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      const row = y + offsetY;
      if (row < 0 || row >= height) continue;
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const column = x + offsetX;
        if (column < 0 || column >= width) continue;
        count += map[row * width + column];
      }
    }
    return count;
  }

  function denseStrokeMap(dark: Uint8Array, width: number, height: number, bounds: StructuralBounds): Uint8Array {
    const dense = new Uint8Array(width * height);
    for (let y = bounds.y0 + 2; y <= bounds.y1 - 2; y += 1) {
      for (let x = bounds.x0 + 2; x <= bounds.x1 - 2; x += 1) {
        const index = y * width + x;
        if (dark[index] && localDarkCount(dark, width, height, x, y, 2) >= 8) dense[index] = 1;
      }
    }
    return dense;
  }

  function keepLargeDenseStrokes(
    dense: Uint8Array,
    core: Uint8Array,
    width: number,
    height: number,
    bounds: StructuralBounds,
  ): Uint8Array {
    const result = core.slice();
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const longestEdge = Math.max(width, height);
    const minimumSpan = clamp(Math.round(longestEdge * 0.038), 26, 64);
    const minimumPixels = clamp(Math.round(longestEdge * 0.07), 48, 150);
    for (let startY = bounds.y0; startY <= bounds.y1; startY += 1) {
      for (let startX = bounds.x0; startX <= bounds.x1; startX += 1) {
        const start = startY * width + startX;
        if (!dense[start] || visited[start]) continue;
        let head = 0;
        let tail = 0;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
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
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              if (!offsetX && !offsetY) continue;
              const nx = x + offsetX;
              const ny = y + offsetY;
              if (nx < bounds.x0 || nx > bounds.x1 || ny < bounds.y0 || ny > bounds.y1) continue;
              const neighbour = ny * width + nx;
              if (!dense[neighbour] || visited[neighbour]) continue;
              visited[neighbour] = 1;
              queue[tail++] = neighbour;
            }
          }
        }
        const span = Math.max(maxX - minX + 1, maxY - minY + 1);
        if (pixels.length >= minimumPixels && span >= minimumSpan) for (const pixel of pixels) result[pixel] = 1;
      }
    }
    return result;
  }

  function nearbySideSupport(map: Uint8Array, width: number, height: number, x: number, y: number, horizontal: boolean): boolean {
    let supported = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      if (horizontal) {
        const row = y + offset;
        if (row < 0 || row >= height) continue;
        if (map[row * width + Math.max(0, x - 2)] || map[row * width + Math.min(width - 1, x + 2)]) supported += 1;
      } else {
        const column = x + offset;
        if (column < 0 || column >= width) continue;
        if (map[Math.max(0, y - 2) * width + column] || map[Math.min(height - 1, y + 2) * width + column]) supported += 1;
      }
    }
    return supported >= 3;
  }

  function closeHorizontalDoorways(
    map: Uint8Array,
    width: number,
    height: number,
    bounds: StructuralBounds,
    maximumGap: number,
    minimumRun: number,
  ): Uint8Array {
    const result = map.slice();
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      const runs = rowRuns(map, width, y, bounds.x0, bounds.x1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const left = runs[index];
        const right = runs[index + 1];
        const gap = right.start - left.end - 1;
        if (gap <= 0 || gap > maximumGap) continue;
        if (left.end - left.start + 1 < minimumRun || right.end - right.start + 1 < minimumRun) continue;
        if (!nearbySideSupport(map, width, height, left.end, y, true) || !nearbySideSupport(map, width, height, right.start, y, true)) continue;
        for (let x = left.end + 1; x < right.start; x += 1) result[y * width + x] = 1;
      }
    }
    return result;
  }

  function closeVerticalDoorways(
    map: Uint8Array,
    width: number,
    height: number,
    bounds: StructuralBounds,
    maximumGap: number,
    minimumRun: number,
  ): Uint8Array {
    const result = map.slice();
    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      const runs = columnRuns(map, width, x, bounds.y0, bounds.y1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const top = runs[index];
        const bottom = runs[index + 1];
        const gap = bottom.start - top.end - 1;
        if (gap <= 0 || gap > maximumGap) continue;
        if (top.end - top.start + 1 < minimumRun || bottom.end - bottom.start + 1 < minimumRun) continue;
        if (!nearbySideSupport(map, width, height, x, top.end, false) || !nearbySideSupport(map, width, height, x, bottom.start, false)) continue;
        for (let y = top.end + 1; y < bottom.start; y += 1) result[y * width + x] = 1;
      }
    }
    return result;
  }

  function dilateStructuralWalls(map: Uint8Array, width: number, height: number, bounds: StructuralBounds): Uint8Array {
    const result = map.slice();
    for (let y = bounds.y0 + 1; y < bounds.y1; y += 1) {
      for (let x = bounds.x0 + 1; x < bounds.x1; x += 1) {
        const index = y * width + x;
        if (map[index]) continue;
        if (map[index - 1] || map[index + 1] || map[index - width] || map[index + width]) result[index] = 1;
      }
    }
    return result;
  }

  function sealStructuralBounds(map: Uint8Array, width: number, bounds: StructuralBounds): void {
    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      map[bounds.y0 * width + x] = 1;
      map[bounds.y1 * width + x] = 1;
    }
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      map[y * width + bounds.x0] = 1;
      map[y * width + bounds.x1] = 1;
    }
  }

  export function buildStructuralWallMask(imageData: ImageData, options: StructuralRoomDetectionOptions): Uint8Array {
    const { width, height } = imageData;
    const bounds = structuralBounds(width, height, options.bounds);
    const longestEdge = Math.max(width, height);
    const maximumGap = options.maximumDoorGap ?? clamp(Math.round(longestEdge * 0.068), 16, 86);
    const minimumBridgeRun = clamp(Math.round(longestEdge * 0.011), 8, 20);
    const dark = rawDarkPixels(imageData, options.threshold, bounds);
    let walls = keepLargeDenseStrokes(denseStrokeMap(dark, width, height, bounds), directionalWallCore(dark, width, height, bounds), width, height, bounds);
    walls = closeHorizontalDoorways(walls, width, height, bounds, maximumGap, minimumBridgeRun);
    walls = closeVerticalDoorways(walls, width, height, bounds, maximumGap, minimumBridgeRun);
    walls = closeHorizontalDoorways(walls, width, height, bounds, maximumGap, minimumBridgeRun);
    walls = closeVerticalDoorways(walls, width, height, bounds, maximumGap, minimumBridgeRun);
    walls = dilateStructuralWalls(walls, width, height, bounds);
    sealStructuralBounds(walls, width, bounds);
    return walls;
  }

  function floodStructuralSpaces(wallMap: Uint8Array, width: number, height: number, bounds: StructuralBounds): StructuralComponent[] {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const components: StructuralComponent[] = [];
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
          if (x <= bounds.x0 + 1 || x >= bounds.x1 - 1 || y <= bounds.y0 + 1 || y >= bounds.y1 - 1) touchesBoundary = true;
          const neighbours = [index - 1, index + 1, index - width, index + width];
          for (const neighbour of neighbours) {
            if (neighbour < 0 || neighbour >= visited.length || visited[neighbour] || wallMap[neighbour]) continue;
            const nx = neighbour % width;
            const ny = Math.floor(neighbour / width);
            if (Math.abs(nx - x) > 1) continue;
            if (nx <= bounds.x0 || nx >= bounds.x1 || ny <= bounds.y0 || ny >= bounds.y1) continue;
            visited[neighbour] = 1;
            queue[tail++] = neighbour;
          }
        }
        components.push({ pixels, minX, minY, maxX, maxY, touchesBoundary });
      }
    }
    return components;
  }

  function structuralPointKey(x: number, y: number): string { return `${x},${y}`; }

  function structuralPolygonArea(points: PixelPoint[]): number {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
  }

  function traceStructuralOutline(component: StructuralComponent, mask: Uint8Array, width: number, height: number): PixelPoint[] {
    for (const index of component.pixels) mask[index] = 1;
    const edges = new Map<string, PixelPoint[]>();
    const add = (fromX: number, fromY: number, toX: number, toY: number): void => {
      const key = structuralPointKey(fromX, fromY);
      const destinations = edges.get(key) ?? [];
      destinations.push({ x: toX, y: toY });
      edges.set(key, destinations);
    };
    for (const index of component.pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      if (y === 0 || !mask[index - width]) add(x, y, x + 1, y);
      if (x === width - 1 || !mask[index + 1]) add(x + 1, y, x + 1, y + 1);
      if (y === height - 1 || !mask[index + width]) add(x + 1, y + 1, x, y + 1);
      if (x === 0 || !mask[index - 1]) add(x, y + 1, x, y);
    }
    const loops: PixelPoint[][] = [];
    while (edges.size) {
      const first = edges.entries().next().value as [string, PixelPoint[]] | undefined;
      if (!first) break;
      const [startKey] = first;
      const [startX, startY] = startKey.split(",").map(Number);
      const loop: PixelPoint[] = [{ x: startX, y: startY }];
      let key = startKey;
      let guard = 0;
      while (guard++ < width * height * 4) {
        const available = edges.get(key);
        if (!available?.length) break;
        const next = available.pop()!;
        if (!available.length) edges.delete(key);
        loop.push(next);
        key = structuralPointKey(next.x, next.y);
        if (key === startKey) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
    for (const index of component.pixels) mask[index] = 0;
    return loops.sort((left, right) => structuralPolygonArea(right) - structuralPolygonArea(left))[0] ?? [];
  }

  function structuralDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const factor = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point.x - (start.x + factor * dx), point.y - (start.y + factor * dy));
  }

  function simplifyStructuralPath(points: PixelPoint[], epsilon: number): PixelPoint[] {
    if (points.length <= 2) return points;
    let maximumDistance = 0;
    let split = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = structuralDistance(points[index], points[0], points[points.length - 1]);
      if (distance > maximumDistance) { maximumDistance = distance; split = index; }
    }
    if (maximumDistance <= epsilon) return [points[0], points[points.length - 1]];
    const left = simplifyStructuralPath(points.slice(0, split + 1), epsilon);
    const right = simplifyStructuralPath(points.slice(split), epsilon);
    return left.slice(0, -1).concat(right);
  }

  function simplifyStructuralLoop(outline: PixelPoint[], epsilon: number): PixelPoint[] {
    const ring = outline.length > 1 && outline[0].x === outline[outline.length - 1].x && outline[0].y === outline[outline.length - 1].y ? outline.slice(0, -1) : outline.slice();
    if (ring.length <= 4) return ring;
    let first = 0;
    let second = 0;
    let furthest = -1;
    for (let index = 1; index < ring.length; index += 1) {
      const distance = (ring[index].x - ring[first].x) ** 2 + (ring[index].y - ring[first].y) ** 2;
      if (distance > furthest) { furthest = distance; second = index; }
    }
    first = second;
    furthest = -1;
    for (let index = 0; index < ring.length; index += 1) {
      const distance = (ring[index].x - ring[first].x) ** 2 + (ring[index].y - ring[first].y) ** 2;
      if (distance > furthest) { furthest = distance; second = index; }
    }
    const path = (start: number, end: number): PixelPoint[] => {
      const values: PixelPoint[] = [ring[start]];
      let index = start;
      while (index !== end) { index = (index + 1) % ring.length; values.push(ring[index]); }
      return values;
    };
    let simplified = simplifyStructuralPath(path(first, second), epsilon).slice(0, -1).concat(simplifyStructuralPath(path(second, first), epsilon).slice(0, -1));
    simplified = simplified.filter((point, index, values) => {
      if (values.length <= 3) return true;
      const previous = values[(index - 1 + values.length) % values.length];
      const next = values[(index + 1) % values.length];
      return structuralDistance(point, previous, next) > epsilon * 0.28 && Math.hypot(point.x - previous.x, point.y - previous.y) > epsilon * 0.65;
    });
    while (simplified.length > 64) {
      epsilon *= 1.35;
      simplified = simplifyStructuralPath(path(first, second), epsilon).slice(0, -1).concat(simplifyStructuralPath(path(second, first), epsilon).slice(0, -1));
    }
    return simplified;
  }

  function componentToStructuralRegion(component: StructuralComponent, componentMask: Uint8Array, width: number, height: number): VectorRegion | null {
    const outline = traceStructuralOutline(component, componentMask, width, height);
    if (outline.length < 4) return null;
    const points = simplifyStructuralLoop(outline, Math.max(1.8, Math.max(width, height) / 720)).map((point) => ({ x: round(clamp(point.x / width, 0, 1)), y: round(clamp(point.y / height, 0, 1)) }));
    if (points.length < 3) return null;
    const boundingArea = Math.max(1, (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
    const fillRatio = component.pixels.length / boundingArea;
    return { id: uid("structural-region"), points, pixelArea: component.pixels.length, confidence: clamp(0.72 + Math.min(1, fillRatio) * 0.2, 0.72, 0.92) };
  }

  export function detectStructuralRoomRegionsFromImageData(imageData: ImageData, options: StructuralRoomDetectionOptions): VectorRegion[] {
    const { width, height } = imageData;
    const bounds = structuralBounds(width, height, options.bounds);
    const wallMap = buildStructuralWallMask(imageData, options);
    const pageArea = Math.max(1, (bounds.x1 - bounds.x0 + 1) * (bounds.y1 - bounds.y0 + 1));
    const minimumArea = Math.max(220, Math.round(pageArea * (options.minimumAreaRatio ?? 0.00125)));
    const maximumArea = Math.round(pageArea * 0.72);
    const minimumDimension = clamp(Math.round(Math.max(width, height) * 0.022), 14, 34);
    const componentMask = new Uint8Array(width * height);
    const regions: VectorRegion[] = [];
    for (const component of floodStructuralSpaces(wallMap, width, height, bounds)) {
      const componentWidth = component.maxX - component.minX + 1;
      const componentHeight = component.maxY - component.minY + 1;
      const boundingArea = componentWidth * componentHeight;
      const fillRatio = component.pixels.length / Math.max(1, boundingArea);
      const aspectRatio = Math.max(componentWidth / Math.max(1, componentHeight), componentHeight / Math.max(1, componentWidth));
      if (component.touchesBoundary) continue;
      if (component.pixels.length < minimumArea || component.pixels.length > maximumArea) continue;
      if (componentWidth < minimumDimension || componentHeight < minimumDimension) continue;
      if (fillRatio < 0.18 || aspectRatio > 13) continue;
      const region = componentToStructuralRegion(component, componentMask, width, height);
      if (region) regions.push(region);
      if (regions.length >= 120) break;
    }
    return regions.sort((left, right) => {
      const leftCentre = polygonCentroid(left.points);
      const rightCentre = polygonCentroid(right.points);
      const rowDifference = Math.round(leftCentre.y / 0.055) - Math.round(rightCentre.y / 0.055);
      return rowDifference || leftCentre.x - rightCentre.x;
    });
  }

  function structuralAnalysisBounds(page: DrawingPage, width: number, height: number): BoundingBox | null {
    if (!page.analysisArea) return null;
    return {
      x: Math.floor(page.analysisArea.x / page.width * width),
      y: Math.floor(page.analysisArea.y / page.height * height),
      width: Math.ceil(page.analysisArea.width / page.width * width),
      height: Math.ceil(page.analysisArea.height / page.height * height),
    };
  }

  export async function detectStructuralRoomRegions(page: DrawingPage, threshold: number): Promise<VectorRegion[]> {
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
    return detectStructuralRoomRegionsFromImageData(context.getImageData(0, 0, canvas.width, canvas.height), {
      threshold,
      bounds: structuralAnalysisBounds(page, canvas.width, canvas.height),
    });
  }
}
