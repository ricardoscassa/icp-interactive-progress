namespace ICPDrawingLab {
  function diagnosticAssert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function diagnosticPlan(): ImageData {
    const width = 160;
    const height = 110;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 250;
      data[offset + 1] = 250;
      data[offset + 2] = 250;
      data[offset + 3] = 255;
    }
    const paint = (x: number, y: number, value = 24): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const offset = (y * width + x) * 4;
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
        const ratio = step / Math.max(1, steps);
        paint(Math.round(x1 + (x2 - x1) * ratio), Math.round(y1 + (y2 - y1) * ratio));
      }
    };

    horizontal(7, 7, 152);
    horizontal(102, 7, 152);
    vertical(7, 7, 102);
    vertical(152, 7, 102);
    vertical(80, 7, 40);
    vertical(80, 67, 102);
    line(80, 40, 58, 62);
    for (let degree = 0; degree <= 90; degree += 4) {
      const radians = degree * Math.PI / 180;
      paint(Math.round(80 - Math.cos(radians) * 22), Math.round(40 + Math.sin(radians) * 22));
    }
    return { width, height, data } as ImageData;
  }

  try {
    const result = analyseSemanticFloorplan(diagnosticPlan(), { threshold: 155 });
    diagnosticAssert(result.wallPixelCount > 1000, "Structural wall diagnostics did not identify the main walls");
    diagnosticAssert(result.doorPixelCount > 0, "Door/opening diagnostics did not identify the doorway evidence");
    diagnosticAssert(result.junctions.length >= 4, "Wall junction diagnostics did not identify plan corners");
    diagnosticAssert(result.polygons.length === 2, `Expected two final room candidates, received ${result.polygons.length}`);
    diagnosticAssert(result.roomMask.some((value) => value === 1), "Room-interior diagnostic mask is empty");
    console.log("✓ exposes wall, door, junction, room and polygon diagnostic layers");
  } catch (error) {
    process.exitCode = 1;
    console.error("✗ exposes wall, door, junction, room and polygon diagnostic layers");
    console.error(error);
  }
}
