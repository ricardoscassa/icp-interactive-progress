namespace ICPDrawingLab {
  function structuralAssert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function structuralSyntheticPlan(): ImageData {
    const width = 180;
    const height = 120;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 250;
      data[offset + 1] = 250;
      data[offset + 2] = 250;
      data[offset + 3] = 255;
    }
    const paint = (x: number, y: number, dark = true): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const offset = (y * width + x) * 4;
      const value = dark ? 24 : 250;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    };
    const horizontal = (y: number, x1: number, x2: number, thickness = 5): void => {
      for (let dy = -Math.floor(thickness / 2); dy <= Math.floor(thickness / 2); dy += 1) {
        for (let x = x1; x <= x2; x += 1) paint(x, y + dy);
      }
    };
    const vertical = (x: number, y1: number, y2: number, thickness = 5): void => {
      for (let dx = -Math.floor(thickness / 2); dx <= Math.floor(thickness / 2); dx += 1) {
        for (let y = y1; y <= y2; y += 1) paint(x + dx, y);
      }
    };
    const line = (x1: number, y1: number, x2: number, y2: number): void => {
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let step = 0; step <= steps; step += 1) {
        const factor = step / Math.max(1, steps);
        paint(Math.round(x1 + (x2 - x1) * factor), Math.round(y1 + (y2 - y1) * factor));
      }
    };

    horizontal(8, 8, 171);
    horizontal(111, 8, 171);
    vertical(8, 8, 111);
    vertical(171, 8, 111);
    vertical(90, 8, 46);
    vertical(90, 72, 111);

    // Door leaf and swing arc: these must be ignored as annotation linework.
    line(90, 46, 68, 67);
    for (let degree = 0; degree <= 90; degree += 3) {
      const radians = degree * Math.PI / 180;
      paint(Math.round(90 - Math.cos(radians) * 22), Math.round(46 + Math.sin(radians) * 22));
    }

    // Small interior fixture linework: also not a wall.
    horizontal(83, 24, 43, 1);
    vertical(24, 75, 91, 1);
    vertical(43, 75, 91, 1);

    return { width, height, data } as ImageData;
  }

  try {
    const regions = detectStructuralRoomRegionsFromImageData(structuralSyntheticPlan(), {
      threshold: 155,
      maximumDoorGap: 30,
      minimumAreaRatio: 0.003,
    });
    structuralAssert(regions.length === 2, `Expected two full rooms and no door pockets, received ${regions.length}`);
    structuralAssert(regions.every((region) => region.points.length <= 12), "Door symbols created unnecessary polygon notches");
    structuralAssert(regions.every((region) => region.pixelArea > 5000), "A door or fixture pocket was returned as a room");
    const centres = regions.map((region) => polygonCentroid(region.points)).sort((left, right) => left.x - right.x);
    structuralAssert(centres[0].x < 0.5 && centres[1].x > 0.5, "The virtual doorway closure did not separate the two rooms");
    console.log("✓ ignores door swings and reconstructs complete structural room polygons");
  } catch (error) {
    process.exitCode = 1;
    console.error("✗ ignores door swings and reconstructs complete structural room polygons");
    console.error(error);
  }
}
