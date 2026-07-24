namespace ICPDrawingLab {
  export type DoorOrientation = "horizontal" | "vertical";

  export interface DetectedDoorOpening {
    id: string;
    orientation: DoorOrientation;
    axis: number;
    start: number;
    end: number;
    bandStart: number;
    bandEnd: number;
    hingeX: number;
    hingeY: number;
    leafEvidence: number;
    arcEvidence: number;
    confidence: number;
  }

  export interface DoorAwareDetectionOptions {
    threshold: number;
    bounds?: BoundingBox | null;
    minimumDoorGap?: number;
    maximumDoorGap?: number;
    minimumAreaRatio?: number;
  }

  interface DoorAwareBounds {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }

  interface DoorAwareRun {
    start: number;
    end: number;
  }

  interface DoorAwareComponent {
    pixels: number[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    touchesBoundary: boolean;
  }

  interface DoorEvidence {
    hingeX: number;
    hingeY: number;
    leaf: number;
    arc: number;
    confidence: number;
  }

  function doorAwareBounds(width: number, height: number, bounds?: BoundingBox | null): DoorAwareBounds {
    if (!bounds) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    const x0 = clamp(Math.floor(bounds.x), 0, Math.max(0, width - 1));
    const y0 = clamp(Math.floor(bounds.y), 0, Math.max(0, height - 1));
    const x1 = clamp(Math.ceil(bounds.x + bounds.width), x0, Math.max(x0, width - 1));
    const y1 = clamp(Math.ceil(bounds.y + bounds.height), y0, Math.max(y0, height - 1));
    return { x0, y0, x1, y1 };
  }

  function doorAwareDarkMap(imageData: ImageData, threshold: number, bounds: DoorAwareBounds): Uint8Array {
    const { width, height, data } = imageData;
    const dark = new Uint8Array(width * height);
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (let x = bounds.x0; x <= bounds.x1; x += 1) {
        const index = y * width + x;
        const offset = index * 4;
        const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
        dark[index] = data[offset + 3] >= 24 && luminance <= threshold ? 1 : 0;
      }
    }
    return dark;
  }

  function doorAwareRowRuns(map: Uint8Array, width: number, y: number, x0: number, x1: number): DoorAwareRun[] {
    const runs: DoorAwareRun[] = [];
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

  function doorAwareColumnRuns(map: Uint8Array, width: number, x: number, y0: number, y1: number): DoorAwareRun[] {
    const runs: DoorAwareRun[] = [];
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

  function doorAwareOverlap(left: DoorAwareRun, right: DoorAwareRun): number {
    const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start) + 1);
    return overlap / Math.max(1, Math.min(left.end - left.start + 1, right.end - right.start + 1));
  }

  function hasDoorAwareParallelRow(
    dark: Uint8Array,
    width: number,
    bounds: DoorAwareBounds,
    y: number,
    run: DoorAwareRun,
    probe: number,
  ): boolean {
    for (let distance = 2; distance <= probe; distance += 1) {
      for (const row of [y - distance, y + distance]) {
        if (row < bounds.y0 || row > bounds.y1) continue;
        if (doorAwareRowRuns(dark, width, row, run.start, run.end).some((candidate) => doorAwareOverlap(run, candidate) >= 0.52)) return true;
      }
    }
    return false;
  }

  function hasDoorAwareParallelColumn(
    dark: Uint8Array,
    width: number,
    bounds: DoorAwareBounds,
    x: number,
    run: DoorAwareRun,
    probe: number,
  ): boolean {
    for (let distance = 2; distance <= probe; distance += 1) {
      for (const column of [x - distance, x + distance]) {
        if (column < bounds.x0 || column > bounds.x1) continue;
        if (doorAwareColumnRuns(dark, width, column, run.start, run.end).some((candidate) => doorAwareOverlap(run, candidate) >= 0.52)) return true;
      }
    }
    return false;
  }

  function doorAwareAxisMaps(
    dark: Uint8Array,
    width: number,
    height: number,
    bounds: DoorAwareBounds,
  ): { axis: Uint8Array; strong: Uint8Array } {
    const longestEdge = Math.max(width, height);
    const minimumAxisRun = clamp(Math.round(longestEdge * 0.006), 5, 11);
    const supportedRun = clamp(Math.round(longestEdge * 0.014), 8, 24);
    const independentRun = clamp(Math.round(longestEdge * 0.105), 28, 118);
    const parallelProbe = clamp(Math.round(longestEdge * 0.018), 7, 25);
    const axis = new Uint8Array(width * height);
    const strong = new Uint8Array(width * height);

    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      for (const run of doorAwareRowRuns(dark, width, y, bounds.x0, bounds.x1)) {
        const length = run.end - run.start + 1;
        if (length >= minimumAxisRun) {
          for (let x = run.start; x <= run.end; x += 1) axis[y * width + x] = 1;
        }
        if (length >= independentRun || (length >= supportedRun && hasDoorAwareParallelRow(dark, width, bounds, y, run, parallelProbe))) {
          for (let x = run.start; x <= run.end; x += 1) strong[y * width + x] = 1;
        }
      }
    }

    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      for (const run of doorAwareColumnRuns(dark, width, x, bounds.y0, bounds.y1)) {
        const length = run.end - run.start + 1;
        if (length >= minimumAxisRun) {
          for (let y = run.start; y <= run.end; y += 1) axis[y * width + x] = 1;
        }
        if (length >= independentRun || (length >= supportedRun && hasDoorAwareParallelColumn(dark, width, bounds, x, run, parallelProbe))) {
          for (let y = run.start; y <= run.end; y += 1) strong[y * width + x] = 1;
        }
      }
    }
    return { axis, strong };
  }

  function doorAwareLocalDark(map: Uint8Array, width: number, height: number, x: number, y: number, radius = 1): boolean {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const row = y + dy;
      if (row < 0 || row >= height) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const column = x + dx;
        if (column < 0 || column >= width) continue;
        if (map[row * width + column]) return true;
      }
    }
    return false;
  }

  function doorAwareLocalStrong(map: Uint8Array, width: number, height: number, x: number, y: number, radius: number): boolean {
    return doorAwareLocalDark(map, width, height, x, y, radius);
  }

  function doorLeafEvidence(
    dark: Uint8Array,
    strong: Uint8Array,
    width: number,
    height: number,
    hingeX: number,
    hingeY: number,
    orientation: DoorOrientation,
    gap: number,
  ): number {
    let best = 0;
    for (let degree = 0; degree < 360; degree += 10) {
      const radians = degree * Math.PI / 180;
      const alongWall = orientation === "horizontal" ? Math.abs(Math.cos(radians)) : Math.abs(Math.sin(radians));
      if (alongWall > 0.94) continue;
      const maximumRadius = gap * 1.18;
      const minimumRadius = Math.max(3, gap * 0.18);
      let samples = 0;
      let hits = 0;
      for (let radius = minimumRadius; radius <= maximumRadius; radius += 1.5) {
        const x = Math.round(hingeX + Math.cos(radians) * radius);
        const y = Math.round(hingeY + Math.sin(radians) * radius);
        if (x < 0 || y < 0 || x >= width || y >= height) break;
        samples += 1;
        if (doorAwareLocalDark(dark, width, height, x, y, 1)) hits += 1;
      }
      if (samples < 5) continue;
      const endX = Math.round(hingeX + Math.cos(radians) * gap);
      const endY = Math.round(hingeY + Math.sin(radians) * gap);
      const structuralEnd = doorAwareLocalStrong(strong, width, height, endX, endY, 3);
      const ratio = hits / samples * (structuralEnd ? 0.45 : 1);
      best = Math.max(best, ratio);
    }
    return best;
  }

  function doorArcEvidence(
    dark: Uint8Array,
    width: number,
    height: number,
    hingeX: number,
    hingeY: number,
    gap: number,
  ): number {
    let best = 0;
    for (const radiusFactor of [0.72, 0.86, 1, 1.14]) {
      const radius = gap * radiusFactor;
      for (let quadrant = 0; quadrant < 4; quadrant += 1) {
        let hits = 0;
        let samples = 0;
        const start = quadrant * 90;
        for (let degree = start + 8; degree <= start + 82; degree += 5) {
          const radians = degree * Math.PI / 180;
          const x = Math.round(hingeX + Math.cos(radians) * radius);
          const y = Math.round(hingeY + Math.sin(radians) * radius);
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          samples += 1;
          if (doorAwareLocalDark(dark, width, height, x, y, 1)) hits += 1;
        }
        if (samples) best = Math.max(best, hits / samples);
      }
    }
    return best;
  }

  function doorEvidenceAtJamb(
    dark: Uint8Array,
    strong: Uint8Array,
    width: number,
    height: number,
    hingeX: number,
    hingeY: number,
    orientation: DoorOrientation,
    gap: number,
  ): DoorEvidence {
    const leaf = doorLeafEvidence(dark, strong, width, height, hingeX, hingeY, orientation, gap);
    const arc = doorArcEvidence(dark, width, height, hingeX, hingeY, gap);
    const confidence = clamp(leaf * 0.64 + arc * 0.36, 0, 1);
    return { hingeX, hingeY, leaf, arc, confidence };
  }

  function validDoorEvidence(evidence: DoorEvidence): boolean {
    return evidence.leaf >= 0.7 || evidence.arc >= 0.48 || (evidence.leaf >= 0.46 && evidence.arc >= 0.18);
  }

  function groupDoorOpenings(candidates: DetectedDoorOpening[]): DetectedDoorOpening[] {
    const groups: DetectedDoorOpening[][] = [];
    for (const candidate of candidates.sort((left, right) => right.confidence - left.confidence)) {
      const centre = (candidate.start + candidate.end) / 2;
      const match = groups.find((group) => {
        const reference = group[0];
        const referenceCentre = (reference.start + reference.end) / 2;
        const tolerance = Math.max(5, (reference.end - reference.start + 1) * 0.34);
        return reference.orientation === candidate.orientation
          && Math.abs(reference.axis - candidate.axis) <= 7
          && Math.abs(referenceCentre - centre) <= tolerance;
      });
      (match ?? groups[groups.push([]) - 1]).push(candidate);
    }

    return groups.map((group) => {
      const best = group.slice().sort((left, right) => right.confidence - left.confidence)[0];
      const axis = Math.round(group.reduce((sum, value) => sum + value.axis, 0) / group.length);
      return {
        ...best,
        axis,
        bandStart: Math.min(...group.map((value) => value.axis)),
        bandEnd: Math.max(...group.map((value) => value.axis)),
        confidence: clamp(best.confidence + Math.min(0.16, group.length * 0.025), 0, 0.98),
      };
    });
  }

  export function detectDoorOpeningsFromWallMaps(
    dark: Uint8Array,
    strong: Uint8Array,
    width: number,
    height: number,
    bounds: DoorAwareBounds,
    minimumGap: number,
    maximumGap: number,
  ): DetectedDoorOpening[] {
    const candidates: DetectedDoorOpening[] = [];
    const anchorRun = clamp(Math.round(Math.max(width, height) * 0.009), 6, 18);

    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      const runs = doorAwareRowRuns(strong, width, y, bounds.x0, bounds.x1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const left = runs[index];
        const right = runs[index + 1];
        const gap = right.start - left.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        if (left.end - left.start + 1 < anchorRun || right.end - right.start + 1 < anchorRun) continue;
        const leftEvidence = doorEvidenceAtJamb(dark, strong, width, height, left.end, y, "horizontal", gap);
        const rightEvidence = doorEvidenceAtJamb(dark, strong, width, height, right.start, y, "horizontal", gap);
        const evidence = leftEvidence.confidence >= rightEvidence.confidence ? leftEvidence : rightEvidence;
        if (!validDoorEvidence(evidence)) continue;
        candidates.push({
          id: uid("door-opening"),
          orientation: "horizontal",
          axis: y,
          start: left.end + 1,
          end: right.start - 1,
          bandStart: y,
          bandEnd: y,
          hingeX: evidence.hingeX,
          hingeY: evidence.hingeY,
          leafEvidence: evidence.leaf,
          arcEvidence: evidence.arc,
          confidence: evidence.confidence,
        });
      }
    }

    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      const runs = doorAwareColumnRuns(strong, width, x, bounds.y0, bounds.y1);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const top = runs[index];
        const bottom = runs[index + 1];
        const gap = bottom.start - top.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        if (top.end - top.start + 1 < anchorRun || bottom.end - bottom.start + 1 < anchorRun) continue;
        const topEvidence = doorEvidenceAtJamb(dark, strong, width, height, x, top.end, "vertical", gap);
        const bottomEvidence = doorEvidenceAtJamb(dark, strong, width, height, x, bottom.start, "vertical", gap);
        const evidence = topEvidence.confidence >= bottomEvidence.confidence ? topEvidence : bottomEvidence;
        if (!validDoorEvidence(evidence)) continue;
        candidates.push({
          id: uid("door-opening"),
          orientation: "vertical",
          axis: x,
          start: top.end + 1,
          end: bottom.start - 1,
          bandStart: x,
          bandEnd: x,
          hingeX: evidence.hingeX,
          hingeY: evidence.hingeY,
          leafEvidence: evidence.leaf,
          arcEvidence: evidence.arc,
          confidence: evidence.confidence,
        });
      }
    }
    return groupDoorOpenings(candidates);
  }

  function doorExclusionContains(door: DetectedDoorOpening, x: number, y: number): boolean {
    const gap = door.end - door.start + 1;
    const radius = gap * 1.22;
    return Math.hypot(x - door.hingeX, y - door.hingeY) <= radius;
  }

  function keepDoorAwareStructuralNetwork(
    axis: Uint8Array,
    strong: Uint8Array,
    width: number,
    height: number,
    bounds: DoorAwareBounds,
    doors: DetectedDoorOpening[],
  ): Uint8Array {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const result = new Uint8Array(width * height);
    for (let startY = bounds.y0; startY <= bounds.y1; startY += 1) {
      for (let startX = bounds.x0; startX <= bounds.x1; startX += 1) {
        const start = startY * width + startX;
        if (!axis[start] || visited[start]) continue;
        let head = 0;
        let tail = 0;
        let anchored = false;
        let touchesBoundary = false;
        const pixels: number[] = [];
        queue[tail++] = start;
        visited[start] = 1;
        while (head < tail) {
          const index = queue[head++];
          const x = index % width;
          const y = Math.floor(index / width);
          pixels.push(index);
          anchored ||= Boolean(strong[index]);
          touchesBoundary ||= x <= bounds.x0 + 1 || x >= bounds.x1 - 1 || y <= bounds.y0 + 1 || y >= bounds.y1 - 1;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (!dx && !dy) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < bounds.x0 || nx > bounds.x1 || ny < bounds.y0 || ny > bounds.y1) continue;
              const neighbour = ny * width + nx;
              if (!axis[neighbour] || visited[neighbour]) continue;
              visited[neighbour] = 1;
              queue[tail++] = neighbour;
            }
          }
        }
        if (!anchored && !touchesBoundary) continue;
        for (const index of pixels) {
          const x = index % width;
          const y = Math.floor(index / width);
          const insideDoorSymbol = doors.some((door) => doorExclusionContains(door, x, y));
          if (!insideDoorSymbol || strong[index]) result[index] = 1;
        }
      }
    }
    return result;
  }

  function applyDetectedDoorClosures(
    walls: Uint8Array,
    width: number,
    height: number,
    doors: DetectedDoorOpening[],
  ): Uint8Array {
    const result = walls.slice();
    for (const door of doors) {
      const thicknessPadding = 2;
      if (door.orientation === "horizontal") {
        const y0 = clamp(door.bandStart - thicknessPadding, 0, height - 1);
        const y1 = clamp(door.bandEnd + thicknessPadding, y0, height - 1);
        for (let y = y0; y <= y1; y += 1) {
          for (let x = door.start; x <= door.end; x += 1) result[y * width + x] = 1;
        }
      } else {
        const x0 = clamp(door.bandStart - thicknessPadding, 0, width - 1);
        const x1 = clamp(door.bandEnd + thicknessPadding, x0, width - 1);
        for (let x = x0; x <= x1; x += 1) {
          for (let y = door.start; y <= door.end; y += 1) result[y * width + x] = 1;
        }
      }
    }
    return result;
  }

  function dilateDoorAwareWalls(map: Uint8Array, width: number, height: number, bounds: DoorAwareBounds): Uint8Array {
    const result = map.slice();
    for (let y = bounds.y0 + 1; y < bounds.y1; y += 1) {
      for (let x = bounds.x0 + 1; x < bounds.x1; x += 1) {
        const index = y * width + x;
        if (!map[index] && (map[index - 1] || map[index + 1] || map[index - width] || map[index + width])) result[index] = 1;
      }
    }
    return result;
  }

  function sealDoorAwareBounds(map: Uint8Array, width: number, bounds: DoorAwareBounds): void {
    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      map[bounds.y0 * width + x] = 1;
      map[bounds.y1 * width + x] = 1;
    }
    for (let y = bounds.y0; y <= bounds.y1; y += 1) {
      map[y * width + bounds.x0] = 1;
      map[y * width + bounds.x1] = 1;
    }
  }

  export function buildDoorAwareWallMask(
    imageData: ImageData,
    options: DoorAwareDetectionOptions,
  ): { wallMap: Uint8Array; doors: DetectedDoorOpening[] } {
    const { width, height } = imageData;
    const bounds = doorAwareBounds(width, height, options.bounds);
    const longestEdge = Math.max(width, height);
    const minimumGap = options.minimumDoorGap ?? clamp(Math.round(longestEdge * 0.009), 6, 16);
    const maximumGap = options.maximumDoorGap ?? clamp(Math.round(longestEdge * 0.075), 18, 92);
    const dark = doorAwareDarkMap(imageData, options.threshold, bounds);
    const maps = doorAwareAxisMaps(dark, width, height, bounds);
    const doors = detectDoorOpeningsFromWallMaps(dark, maps.strong, width, height, bounds, minimumGap, maximumGap);
    let wallMap = keepDoorAwareStructuralNetwork(maps.axis, maps.strong, width, height, bounds, doors);
    wallMap = applyDetectedDoorClosures(wallMap, width, height, doors);
    wallMap = dilateDoorAwareWalls(wallMap, width, height, bounds);
    sealDoorAwareBounds(wallMap, width, bounds);
    return { wallMap, doors };
  }

  function floodDoorAwareRooms(
    wallMap: Uint8Array,
    width: number,
    height: number,
    bounds: DoorAwareBounds,
  ): DoorAwareComponent[] {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const components: DoorAwareComponent[] = [];
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
          touchesBoundary ||= x <= bounds.x0 + 1 || x >= bounds.x1 - 1 || y <= bounds.y0 + 1 || y >= bounds.y1 - 1;
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

  function doorAwarePointKey(x: number, y: number): string { return `${x},${y}`; }

  function doorAwarePolygonArea(points: PixelPoint[]): number {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
  }

  function traceDoorAwareOutline(
    component: DoorAwareComponent,
    mask: Uint8Array,
    width: number,
    height: number,
  ): PixelPoint[] {
    for (const index of component.pixels) mask[index] = 1;
    const edges = new Map<string, PixelPoint[]>();
    const add = (fromX: number, fromY: number, toX: number, toY: number): void => {
      const key = doorAwarePointKey(fromX, fromY);
      const values = edges.get(key) ?? [];
      values.push({ x: toX, y: toY });
      edges.set(key, values);
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
        key = doorAwarePointKey(next.x, next.y);
        if (key === startKey) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
    for (const index of component.pixels) mask[index] = 0;
    return loops.sort((left, right) => doorAwarePolygonArea(right) - doorAwarePolygonArea(left))[0] ?? [];
  }

  function doorAwareDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const factor = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point.x - (start.x + factor * dx), point.y - (start.y + factor * dy));
  }

  function simplifyDoorAwarePath(points: PixelPoint[], epsilon: number): PixelPoint[] {
    if (points.length <= 2) return points;
    let maximumDistance = 0;
    let split = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = doorAwareDistance(points[index], points[0], points[points.length - 1]);
      if (distance > maximumDistance) { maximumDistance = distance; split = index; }
    }
    if (maximumDistance <= epsilon) return [points[0], points[points.length - 1]];
    return simplifyDoorAwarePath(points.slice(0, split + 1), epsilon).slice(0, -1)
      .concat(simplifyDoorAwarePath(points.slice(split), epsilon));
  }

  function simplifyDoorAwareLoop(outline: PixelPoint[], epsilon: number): PixelPoint[] {
    const ring = outline.length > 1
      && outline[0].x === outline[outline.length - 1].x
      && outline[0].y === outline[outline.length - 1].y
      ? outline.slice(0, -1)
      : outline.slice();
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
    let simplified = simplifyDoorAwarePath(path(first, second), epsilon).slice(0, -1)
      .concat(simplifyDoorAwarePath(path(second, first), epsilon).slice(0, -1));
    simplified = simplified.filter((point, index, values) => {
      if (values.length <= 3) return true;
      const previous = values[(index - 1 + values.length) % values.length];
      const next = values[(index + 1) % values.length];
      return doorAwareDistance(point, previous, next) > epsilon * 0.3
        && Math.hypot(point.x - previous.x, point.y - previous.y) > epsilon * 0.65;
    });
    return simplified;
  }

  function doorAwareComponentToRegion(
    component: DoorAwareComponent,
    mask: Uint8Array,
    width: number,
    height: number,
  ): VectorRegion | null {
    const outline = traceDoorAwareOutline(component, mask, width, height);
    if (outline.length < 4) return null;
    const points = simplifyDoorAwareLoop(outline, Math.max(1.7, Math.max(width, height) / 760))
      .map((point) => ({ x: round(clamp(point.x / width, 0, 1)), y: round(clamp(point.y / height, 0, 1)) }));
    if (points.length < 3) return null;
    const boundingArea = Math.max(1, (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1));
    const fillRatio = component.pixels.length / boundingArea;
    return {
      id: uid("door-aware-region"),
      points,
      pixelArea: component.pixels.length,
      confidence: clamp(0.76 + Math.min(1, fillRatio) * 0.18, 0.76, 0.94),
    };
  }

  export function detectDoorAwareStructuralRegionsFromImageData(
    imageData: ImageData,
    options: DoorAwareDetectionOptions,
  ): { regions: VectorRegion[]; doors: DetectedDoorOpening[] } {
    const { width, height } = imageData;
    const bounds = doorAwareBounds(width, height, options.bounds);
    const { wallMap, doors } = buildDoorAwareWallMask(imageData, options);
    const pageArea = Math.max(1, (bounds.x1 - bounds.x0 + 1) * (bounds.y1 - bounds.y0 + 1));
    const minimumArea = Math.max(220, Math.round(pageArea * (options.minimumAreaRatio ?? 0.00125)));
    const maximumArea = Math.round(pageArea * 0.74);
    const minimumDimension = clamp(Math.round(Math.max(width, height) * 0.02), 12, 32);
    const componentMask = new Uint8Array(width * height);
    const regions: VectorRegion[] = [];
    for (const component of floodDoorAwareRooms(wallMap, width, height, bounds)) {
      const componentWidth = component.maxX - component.minX + 1;
      const componentHeight = component.maxY - component.minY + 1;
      const boundingArea = componentWidth * componentHeight;
      const fillRatio = component.pixels.length / Math.max(1, boundingArea);
      const aspectRatio = Math.max(componentWidth / Math.max(1, componentHeight), componentHeight / Math.max(1, componentWidth));
      if (component.touchesBoundary) continue;
      if (component.pixels.length < minimumArea || component.pixels.length > maximumArea) continue;
      if (componentWidth < minimumDimension || componentHeight < minimumDimension) continue;
      if (fillRatio < 0.16 || aspectRatio > 14) continue;
      const region = doorAwareComponentToRegion(component, componentMask, width, height);
      if (region) regions.push(region);
      if (regions.length >= 140) break;
    }
    regions.sort((left, right) => {
      const leftCentre = polygonCentroid(left.points);
      const rightCentre = polygonCentroid(right.points);
      const rowDifference = Math.round(leftCentre.y / 0.055) - Math.round(rightCentre.y / 0.055);
      return rowDifference || leftCentre.x - rightCentre.x;
    });
    return { regions, doors };
  }

  function doorAwarePageBounds(page: DrawingPage, width: number, height: number): BoundingBox | null {
    if (!page.analysisArea) return null;
    return {
      x: Math.floor(page.analysisArea.x / page.width * width),
      y: Math.floor(page.analysisArea.y / page.height * height),
      width: Math.ceil(page.analysisArea.width / page.width * width),
      height: Math.ceil(page.analysisArea.height / page.height * height),
    };
  }

  const detectStructuralRoomRegionsBeforeDoorAwareness = detectStructuralRoomRegions;

  async function detectDoorAwareStructuralRoomRegions(page: DrawingPage, threshold: number): Promise<VectorRegion[]> {
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
    const result = detectDoorAwareStructuralRegionsFromImageData(
      context.getImageData(0, 0, canvas.width, canvas.height),
      {
        threshold,
        bounds: doorAwarePageBounds(page, canvas.width, canvas.height),
      },
    );
    if (result.regions.length) return result.regions;
    return detectStructuralRoomRegionsBeforeDoorAwareness(page, threshold);
  }

  (ICPDrawingLab as unknown as {
    detectStructuralRoomRegions: typeof detectStructuralRoomRegions;
  }).detectStructuralRoomRegions = detectDoorAwareStructuralRoomRegions;
}
