declare const process: { exitCode?: number };
namespace ICPDrawingLab {
  function monoAssert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function syntheticPlan(): ImageData {
    const width = 120;
    const height = 80;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 250;
      data[offset + 1] = 250;
      data[offset + 2] = 250;
      data[offset + 3] = 255;
    }
    const paint = (x: number, y: number, dark: boolean): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const offset = (y * width + x) * 4;
      const value = dark ? 28 : 250;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    };
    const horizontal = (y: number, x1: number, x2: number, thickness = 5): void => {
      for (let offset = -Math.floor(thickness / 2); offset <= Math.floor(thickness / 2); offset += 1) {
        for (let x = x1; x <= x2; x += 1) paint(x, y + offset, true);
      }
    };
    const vertical = (x: number, y1: number, y2: number, thickness = 5): void => {
      for (let offset = -Math.floor(thickness / 2); offset <= Math.floor(thickness / 2); offset += 1) {
        for (let y = y1; y <= y2; y += 1) paint(x + offset, y, true);
      }
    };

    horizontal(6, 6, 113);
    horizontal(73, 6, 113);
    vertical(6, 6, 73);
    vertical(113, 6, 73);
    vertical(60, 6, 73);
    for (let y = 34; y <= 42; y += 1) {
      for (let x = 57; x <= 63; x += 1) paint(x, y, false);
    }
    return { width, height, data } as ImageData;
  }

  try {
    const regions = detectMonochromeRegionsFromImageData(syntheticPlan(), {
      threshold: 155,
      maximumGap: 12,
    });
    monoAssert(regions.length === 2, `Expected two enclosed rooms, received ${regions.length}`);
    monoAssert(regions.every((region) => region.points.length >= 4), "Room outlines were not converted to polygon sequences");
    const centres = regions.map((region) => polygonCentroid(region.points)).sort((left, right) => left.x - right.x);
    monoAssert(centres[0].x < 0.5 && centres[1].x > 0.5, "The two reconstructed rooms are not on opposite sides of the repaired doorway");
    console.log("✓ reconstructs complete monochrome rooms across a door gap");
  } catch (error) {
    process.exitCode = 1;
    console.error("✗ reconstructs complete monochrome rooms across a door gap");
    console.error(error);
  }
}
