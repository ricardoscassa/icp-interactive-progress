namespace ICPDrawingLab {
  export type SemanticDiagnosticLayer = "rooms" | "walls" | "doors" | "junctions" | "polygons";

  export interface SemanticDiagnosticOptions {
    threshold: number;
    bounds?: BoundingBox | null;
  }

  export interface SemanticDiagnosticResult {
    width: number;
    height: number;
    roomMask: Uint8Array;
    wallMask: Uint8Array;
    doorMask: Uint8Array;
    junctions: PixelPoint[];
    polygons: VectorRegion[];
    wallPixelCount: number;
    doorPixelCount: number;
  }

  interface DiagnosticBounds {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }

  interface DiagnosticRun {
    start: number;
    end: number;
  }

  function diagnosticBounds(width: number, height: number, bounds?: BoundingBox | null): DiagnosticBounds {
    if (!bounds) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    const x0 = clamp(Math.floor(bounds.x), 0, Math.max(0, width - 1));
    const y0 = clamp(Math.floor(bounds.y), 0, Math.max(0, height - 1));
    const x1 = clamp(Math.ceil(bounds.x + bounds.width), x0, Math.max(x0, width - 1));
    const y1 = clamp(Math.ceil(bounds.y + bounds.height), y0, Math.max(y0, height - 1));
    return { x0, y0, x1, y1 };
  }

  function darkMap(imageData: ImageData, threshold: number, bounds: DiagnosticBounds): Uint8Array {
    const { width, height, data } = imageData;
    const result = new Uint8Array(width * height);
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (let x = bounds.x0; x <= bounds.x1; x += 1) {
        const index = y * width + x;
        const offset = index * 4;
        const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
        if (data[offset + 3] >= 24 && luminance <= threshold) result[index] = 1;
      }
    }
    return result;
  }

  function directionalRunLengths(map: Uint8Array, width: number, height: number): {
    horizontal: Uint16Array;
    vertical: Uint16Array;
  } {
    const horizontal = new Uint16Array(map.length);
    const vertical = new Uint16Array(map.length);
    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        while (x < width && !map[y * width + x]) x += 1;
        const start = x;
        while (x < width && map[y * width + x]) x += 1;
        const length = x - start;
        for (let column = start; column < x; column += 1) horizontal[y * width + column] = length;
      }
    }
    for (let x = 0; x < width; x += 1) {
      let y = 0;
      while (y < height) {
        while (y < height && !map[y * width + x]) y += 1;
        const start = y;
        while (y < height && map[y * width + x]) y += 1;
        const length = y - start;
        for (let row = start; row < y; row += 1) vertical[row * width + x] = length;
      }
    }
    return { horizontal, vertical };
  }

  function integralDarkMap(map: Uint8Array, width: number, height: number): Uint32Array {
    const integral = new Uint32Array((width + 1) * (height + 1));
    for (let y = 1; y <= height; y += 1) {
      let rowSum = 0;
      for (let x = 1; x <= width; x += 1) {
        rowSum += map[(y - 1) * width + x - 1];
        integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
      }
    }
    return integral;
  }

  function rectangleSum(
    integral: Uint32Array,
    width: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): number {
    const stride = width + 1;
    return integral[(y1 + 1) * stride + x1 + 1]
      - integral[y0 * stride + x1 + 1]
      - integral[(y1 + 1) * stride + x0]
      + integral[y0 * stride + x0];
  }

  function semanticWallMask(
    dark: Uint8Array,
    width: number,
    height: number,
    bounds: DiagnosticBounds,
  ): Uint8Array {
    const wall = new Uint8Array(dark.length);
    const runs = directionalRunLengths(dark, width, height);
    const integral = integralDarkMap(dark, width, height);
    const longestEdge = Math.max(width, height);
    const minimumRun = clamp(Math.round(longestEdge * 0.012), 7, 24);
    const denseRadius = clamp(Math.round(longestEdge / 420), 2, 5);

    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (let x = bounds.x0; x <= bounds.x1; x += 1) {
        const index = y * width + x;
        if (!dark[index]) continue;
        const x0 = Math.max(bounds.x0, x - denseRadius);
        const y0 = Math.max(bounds.y0, y - denseRadius);
        const x1 = Math.min(bounds.x1, x + denseRadius);
        const y1 = Math.min(bounds.y1, y + denseRadius);
        const localArea = (x1 - x0 + 1) * (y1 - y0 + 1);
        const density = rectangleSum(integral, width, x0, y0, x1, y1) / Math.max(1, localArea);
        const directional = Math.max(runs.horizontal[index], runs.vertical[index]);
        const supportedCorner = runs.horizontal[index] >= Math.max(4, minimumRun * 0.45)
          && runs.vertical[index] >= Math.max(4, minimumRun * 0.45);
        if (directional >= minimumRun || supportedCorner || density >= 0.34) wall[index] = 1;
      }
    }
    return wall;
  }

  function rowRuns(map: Uint8Array, width: number, y: number, x0: number, x1: number): DiagnosticRun[] {
    const result: DiagnosticRun[] = [];
    let x = x0;
    while (x <= x1) {
      while (x <= x1 && !map[y * width + x]) x += 1;
      if (x > x1) break;
      const start = x;
      while (x <= x1 && map[y * width + x]) x += 1;
      result.push({ start, end: x - 1 });
    }
    return result;
  }

  function columnRuns(map: Uint8Array, width: number, x: number, y0: number, y1: number): DiagnosticRun[] {
    const result: DiagnosticRun[] = [];
    let y = y0;
    while (y <= y1) {
      while (y <= y1 && !map[y * width + x]) y += 1;
      if (y > y1) break;
      const start = y;
      while (y <= y1 && map[y * width + x]) y += 1;
      result.push({ start, end: y - 1 });
    }
    return result;
  }

  function localAnnotationEvidence(
    dark: Uint8Array,
    wall: Uint8Array,
    width: number,
    height: number,
    centreX: number,
    centreY: number,
    radius: number,
  ): number {
    let evidence = 0;
    for (let y = Math.max(0, centreY - radius); y <= Math.min(height - 1, centreY + radius); y += 1) {
      for (let x = Math.max(0, centreX - radius); x <= Math.min(width - 1, centreX + radius); x += 1) {
        const index = y * width + x;
        if (dark[index] && !wall[index]) evidence += 1;
      }
    }
    return evidence;
  }

  function semanticDoorMask(
    dark: Uint8Array,
    wall: Uint8Array,
    width: number,
    height: number,
    bounds: DiagnosticBounds,
  ): Uint8Array {
    const doors = new Uint8Array(wall.length);
    const longestEdge = Math.max(width, height);
    const minimumGap = clamp(Math.round(longestEdge * 0.006), 4, 10);
    const maximumGap = clamp(Math.round(longestEdge * 0.055), 16, 78);
    const minimumWallRun = clamp(Math.round(longestEdge * 0.015), 8, 28);

    for (let y = bounds.y0; y <= bounds.y1; y += 2) {
      const runs = rowRuns(wall, width, y, bounds.x0, bounds.x1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const left = runs[index];
        const right = runs[index + 1];
        const gap = right.start - left.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        if (left.end - left.start + 1 < minimumWallRun || right.end - right.start + 1 < minimumWallRun) continue;
        const centreX = Math.round((left.end + right.start) / 2);
        const evidence = localAnnotationEvidence(dark, wall, width, height, centreX, y, Math.max(5, Math.round(gap * 0.7)));
        if (evidence < Math.max(4, Math.round(gap * 0.3))) continue;
        for (let yy = Math.max(bounds.y0, y - 2); yy <= Math.min(bounds.y1, y + 2); yy += 1) {
          for (let x = left.end + 1; x < right.start; x += 1) doors[yy * width + x] = 1;
        }
      }
    }

    for (let x = bounds.x0; x <= bounds.x1; x += 2) {
      const runs = columnRuns(wall, width, x, bounds.y0, bounds.y1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const top = runs[index];
        const bottom = runs[index + 1];
        const gap = bottom.start - top.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        if (top.end - top.start + 1 < minimumWallRun || bottom.end - bottom.start + 1 < minimumWallRun) continue;
        const centreY = Math.round((top.end + bottom.start) / 2);
        const evidence = localAnnotationEvidence(dark, wall, width, height, x, centreY, Math.max(5, Math.round(gap * 0.7)));
        if (evidence < Math.max(4, Math.round(gap * 0.3))) continue;
        for (let xx = Math.max(bounds.x0, x - 2); xx <= Math.min(bounds.x1, x + 2); xx += 1) {
          for (let y = top.end + 1; y < bottom.start; y += 1) doors[y * width + xx] = 1;
        }
      }
    }
    return doors;
  }

  function directionalSupport(map: Uint8Array, width: number, height: number, x: number, y: number, dx: number, dy: number): boolean {
    let hits = 0;
    for (let distance = 1; distance <= 7; distance += 1) {
      const xx = x + dx * distance;
      const yy = y + dy * distance;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) break;
      if (map[yy * width + xx]) hits += 1;
    }
    return hits >= 3;
  }

  function semanticJunctions(wall: Uint8Array, width: number, height: number, bounds: DiagnosticBounds): PixelPoint[] {
    const candidates: PixelPoint[] = [];
    for (let y = bounds.y0 + 2; y <= bounds.y1 - 2; y += 2) {
      for (let x = bounds.x0 + 2; x <= bounds.x1 - 2; x += 2) {
        if (!wall[y * width + x]) continue;
        const left = directionalSupport(wall, width, height, x, y, -1, 0);
        const right = directionalSupport(wall, width, height, x, y, 1, 0);
        const up = directionalSupport(wall, width, height, x, y, 0, -1);
        const down = directionalSupport(wall, width, height, x, y, 0, 1);
        const degree = Number(left) + Number(right) + Number(up) + Number(down);
        const corner = degree === 2 && (left || right) && (up || down);
        if (degree >= 3 || corner) candidates.push({ x, y });
      }
    }

    const selected: PixelPoint[] = [];
    const suppression = clamp(Math.round(Math.max(width, height) * 0.008), 5, 14);
    for (const candidate of candidates) {
      if (selected.some((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) <= suppression)) continue;
      selected.push(candidate);
      if (selected.length >= 500) break;
    }
    return selected;
  }

  function pointInsidePolygon(point: PixelPoint, polygon: PixelPoint[]): boolean {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const current = polygon[index];
      const before = polygon[previous];
      const intersects = current.y > point.y !== before.y > point.y
        && point.x < ((before.x - current.x) * (point.y - current.y)) / ((before.y - current.y) || Number.EPSILON) + current.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function roomMaskFromPolygons(polygons: VectorRegion[], width: number, height: number): Uint8Array {
    const mask = new Uint8Array(width * height);
    for (const region of polygons) {
      const points = region.points.map((point) => ({ x: point.x * width, y: point.y * height }));
      const minX = clamp(Math.floor(Math.min(...points.map((point) => point.x))), 0, width - 1);
      const maxX = clamp(Math.ceil(Math.max(...points.map((point) => point.x))), minX, width - 1);
      const minY = clamp(Math.floor(Math.min(...points.map((point) => point.y))), 0, height - 1);
      const maxY = clamp(Math.ceil(Math.max(...points.map((point) => point.y))), minY, height - 1);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (pointInsidePolygon({ x: x + 0.5, y: y + 0.5 }, points)) mask[y * width + x] = 1;
        }
      }
    }
    return mask;
  }

  export function analyseSemanticFloorplan(
    imageData: ImageData,
    options: SemanticDiagnosticOptions,
  ): SemanticDiagnosticResult {
    const bounds = diagnosticBounds(imageData.width, imageData.height, options.bounds);
    const dark = darkMap(imageData, options.threshold, bounds);
    const wallMask = semanticWallMask(dark, imageData.width, imageData.height, bounds);
    const doorMask = semanticDoorMask(dark, wallMask, imageData.width, imageData.height, bounds);
    const junctions = semanticJunctions(wallMask, imageData.width, imageData.height, bounds);
    const polygons = detectMonochromeRegionsFromImageData(imageData, {
      threshold: options.threshold,
      bounds: options.bounds,
    });
    const roomMask = roomMaskFromPolygons(polygons, imageData.width, imageData.height);
    return {
      width: imageData.width,
      height: imageData.height,
      roomMask,
      wallMask,
      doorMask,
      junctions,
      polygons,
      wallPixelCount: wallMask.reduce((total, value) => total + value, 0),
      doorPixelCount: doorMask.reduce((total, value) => total + value, 0),
    };
  }
}
