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

  function refineDoorMask(
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

    for (let y = 0; y < height; y += 2) {
      const runs = refinementRowRuns(wallMask, width, y);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const left = runs[index];
        const right = runs[index + 1];
        const gap = right.start - left.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        if (left.end - left.start + 1 < minimumWallRun || right.end - right.start + 1 < minimumWallRun) continue;
        const centreX = Math.round((left.end + right.start) / 2);
        const radius = Math.max(6, Math.round(gap * 0.85));
        const evidence = offAxisDarkEvidence(dark, width, height, centreX, y, radius, "horizontal");
        if (evidence < Math.max(5, Math.round(gap * 0.42))) continue;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy += 1) {
          for (let x = left.end + 1; x < right.start; x += 1) doors[yy * width + x] = 1;
        }
      }
    }

    for (let x = 0; x < width; x += 2) {
      const runs = refinementColumnRuns(wallMask, width, height, x);
      for (let index = 0; index < runs.length - 1; index += 1) {
        const top = runs[index];
        const bottom = runs[index + 1];
        const gap = bottom.start - top.end - 1;
        if (gap < minimumGap || gap > maximumGap) continue;
        if (top.end - top.start + 1 < minimumWallRun || bottom.end - bottom.start + 1 < minimumWallRun) continue;
        const centreY = Math.round((top.end + bottom.start) / 2);
        const radius = Math.max(6, Math.round(gap * 0.85));
        const evidence = offAxisDarkEvidence(dark, width, height, x, centreY, radius, "vertical");
        if (evidence < Math.max(5, Math.round(gap * 0.42))) continue;
        for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx += 1) {
          for (let y = top.end + 1; y < bottom.start; y += 1) doors[y * width + xx] = 1;
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
    result.doorMask = refineDoorMask(imageData, result.wallMask, options.threshold, result.doorMask);
    result.doorPixelCount = result.doorMask.reduce((total, value) => total + value, 0);
    return result;
  }

  (ICPDrawingLab as unknown as {
    analyseSemanticFloorplan: typeof analyseSemanticFloorplan;
  }).analyseSemanticFloorplan = analyseSemanticFloorplanWithDoorRefinement;
}
