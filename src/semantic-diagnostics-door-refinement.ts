namespace ICPDrawingLab {
  const analyseSemanticFloorplanBeforeDoorRefinement = analyseSemanticFloorplan;

  interface DoorRefinementRun {
    start: number;
    end: number;
  }

  function refinementDarkMap(imageData: ImageData, threshold: number): Uint8Array {
    const result = new Uint8Array(imageData.width * imageData.height);
    for (let index = 0, offset = 0; index < result.length; index += 1, offset += 4) {
      const luminance = imageData.data[offset] * 0.2126
        + imageData.data[offset + 1] * 0.7152
        + imageData.data[offset + 2] * 0.0722;
      if (imageData.data[offset + 3] >= 24 && luminance <= threshold) result[index] = 1;
    }
    return result;
  }

  function refinementRowRuns(map: Uint8Array, width: number, y: number): DoorRefinementRun[] {
    const runs: DoorRefinementRun[] = [];
    let x = 0;
    while (x < width) {
      while (x < width && !map[y * width + x]) x += 1;
      if (x >= width) break;
      const start = x;
      while (x < width && map[y * width + x]) x += 1;
      runs.push({ start, end: x - 1 });
    }
    return runs;
  }

  function refinementColumnRuns(map: Uint8Array, width: number, height: number, x: number): DoorRefinementRun[] {
    const runs: DoorRefinementRun[] = [];
    let y = 0;
    while (y < height) {
      while (y < height && !map[y * width + x]) y += 1;
      if (y >= height) break;
      const start = y;
      while (y < height && map[y * width + x]) y += 1;
      runs.push({ start, end: y - 1 });
    }
    return runs;
  }

  function offAxisDarkEvidence(
    dark: Uint8Array,
    width: number,
    height: number,
    centreX: number,
    centreY: number,
    radius: number,
    orientation: "horizontal" | "vertical",
  ): number {
    let evidence = 0;
    for (let y = Math.max(0, centreY - radius); y <= Math.min(height - 1, centreY + radius); y += 1) {
      for (let x = Math.max(0, centreX - radius); x <= Math.min(width - 1, centreX + radius); x += 1) {
        if (!dark[y * width + x]) continue;
        const awayFromWallAxis = orientation === "horizontal"
          ? Math.abs(y - centreY) > 2
          : Math.abs(x - centreX) > 2;
        if (awayFromWallAxis) evidence += 1;
      }
    }
    return evidence;
  }

  function markDoorBand(
    doors: Uint8Array,
    width: number,
    height: number,
    orientation: "horizontal" | "vertical",
    axis: number,
    start: number,
    end: number,
  ): void {
    if (orientation === "horizontal") {
      for (let y = Math.max(0, axis - 2); y <= Math.min(height - 1, axis + 2); y += 1) {
        for (let x = Math.max(0, start); x <= Math.min(width - 1, end); x += 1) doors[y * width + x] = 1;
      }
    } else {
      for (let x = Math.max(0, axis - 2); x <= Math.min(width - 1, axis + 2); x += 1) {
        for (let y = Math.max(0, start); y <= Math.min(height - 1, end); y += 1) doors[y * width + x] = 1;
      }
    }
  }

  function wallNear(
    wall: Uint8Array,
    width: number,
    height: number,
    x: number,
    y: number,
    radius = 2,
  ): boolean {
    for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
        if (wall[yy * width + xx]) return true;
      }
    }
    return false;
  }

  function refineDoorMaskFromWallGaps(
    imageData: ImageData,
    wallMask: Uint8Array,
    threshold: number,
    existing: Uint8Array,
  ): Uint8Array {
    const { width, height } = imageData;
    const dark = refinementDarkMap(imageData, threshold);
    const doors = existing.slice();
    const longestEdge = Math.max(width, height);
    const minimumGap = clamp(Math.round(longestEdge * 0.006), 4, 10);
    const maximumGap = clamp(Math.round(longestEdge * 0.055), 16, 78);
    const minimumWallRun = clamp(Math.round(longestEdge * 0.015), 8, 28);
    const strongRun = (run: DoorRefinementRun): boolean => run.end - run.start + 1 >= minimumWallRun;

    for (let y = 0; y < height; y += 2) {
      const runs = refinementRowRuns(wallMask, width, y).filter(strongRun);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const left = runs[index];
        const right = runs[index + 1];
        const gap = right.start - left.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        const centreX = Math.round((left.end + right.start) / 2);
        const evidence = offAxisDarkEvidence(dark, width, height, centreX, y, Math.max(6, Math.round(gap * 0.85)), "horizontal");
        if (evidence < Math.max(5, Math.round(gap * 0.42))) continue;
        markDoorBand(doors, width, height, "horizontal", y, left.end + 1, right.start - 1);
      }
    }

    for (let x = 0; x < width; x += 2) {
      const runs = refinementColumnRuns(wallMask, width, height, x).filter(strongRun);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const top = runs[index];
        const bottom = runs[index + 1];
        const gap = bottom.start - top.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        const centreY = Math.round((top.end + bottom.start) / 2);
        const evidence = offAxisDarkEvidence(dark, width, height, x, centreY, Math.max(6, Math.round(gap * 0.85)), "vertical");
        if (evidence < Math.max(5, Math.round(gap * 0.42))) continue;
        markDoorBand(doors, width, height, "vertical", x, top.end + 1, bottom.start - 1);
      }
    }
    return doors;
  }

  function polygonGapRuns(
    wallMask: Uint8Array,
    width: number,
    height: number,
    orientation: "horizontal" | "vertical",
    axis: number,
    start: number,
    end: number,
  ): DoorRefinementRun[] {
    const runs: DoorRefinementRun[] = [];
    let position = start;
    const isOpen = (value: number): boolean => orientation === "horizontal"
      ? !wallNear(wallMask, width, height, value, axis)
      : !wallNear(wallMask, width, height, axis, value);
    while (position <= end) {
      while (position <= end && !isOpen(position)) position += 1;
      if (position > end) break;
      const gapStart = position;
      while (position <= end && isOpen(position)) position += 1;
      runs.push({ start: gapStart, end: position - 1 });
    }
    return runs;
  }

  function refineDoorMaskFromPolygonClosures(
    imageData: ImageData,
    wallMask: Uint8Array,
    polygons: VectorRegion[],
    threshold: number,
    existing: Uint8Array,
  ): Uint8Array {
    const { width, height } = imageData;
    const dark = refinementDarkMap(imageData, threshold);
    const doors = existing.slice();
    const longestEdge = Math.max(width, height);
    const minimumGap = clamp(Math.round(longestEdge * 0.005), 4, 9);
    const maximumGap = clamp(Math.round(longestEdge * 0.065), 18, 90);

    for (const region of polygons) {
      const points = region.points.map((point) => ({
        x: Math.round(point.x * width),
        y: Math.round(point.y * height),
      }));
      for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const dx = next.x - current.x;
        const dy = next.y - current.y;
        const horizontal = Math.abs(dx) >= Math.max(4, Math.abs(dy) * 4);
        const vertical = Math.abs(dy) >= Math.max(4, Math.abs(dx) * 4);
        if (!horizontal && !vertical) continue;
        const orientation = horizontal ? "horizontal" : "vertical";
        const axis = horizontal ? Math.round((current.y + next.y) / 2) : Math.round((current.x + next.x) / 2);
        const start = horizontal ? Math.min(current.x, next.x) : Math.min(current.y, next.y);
        const end = horizontal ? Math.max(current.x, next.x) : Math.max(current.y, next.y);
        for (const gap of polygonGapRuns(wallMask, width, height, orientation, axis, start, end)) {
          const length = gap.end - gap.start + 1;
          if (length < minimumGap || length > maximumGap) continue;
          const centre = Math.round((gap.start + gap.end) / 2);
          const centreX = horizontal ? centre : axis;
          const centreY = horizontal ? axis : centre;
          const evidence = offAxisDarkEvidence(
            dark,
            width,
            height,
            centreX,
            centreY,
            Math.max(6, Math.round(length * 0.9)),
            orientation,
          );
          if (evidence < Math.max(4, Math.round(length * 0.28))) continue;
          markDoorBand(doors, width, height, orientation, axis, gap.start, gap.end);
        }
      }
    }
    return doors;
  }

  function analyseSemanticFloorplanWithDoorRefinement(
    imageData: ImageData,
    options: SemanticDiagnosticOptions,
  ): SemanticDiagnosticResult {
    const result = analyseSemanticFloorplanBeforeDoorRefinement(imageData, options);
    let doors = refineDoorMaskFromWallGaps(imageData, result.wallMask, options.threshold, result.doorMask);
    doors = refineDoorMaskFromPolygonClosures(imageData, result.wallMask, result.polygons, options.threshold, doors);
    result.doorMask = doors;
    result.doorPixelCount = result.doorMask.reduce((total, value) => total + value, 0);
    return result;
  }

  (ICPDrawingLab as unknown as {
    analyseSemanticFloorplan: typeof analyseSemanticFloorplan;
  }).analyseSemanticFloorplan = analyseSemanticFloorplanWithDoorRefinement;
}
