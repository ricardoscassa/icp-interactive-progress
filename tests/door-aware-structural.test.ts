namespace ICPDrawingLab {
  function doorAwareAssert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function blankDoorAwareImage(width: number, height: number): {
    imageData: ImageData;
    paint: (x: number, y: number, dark?: boolean) => void;
    horizontal: (y: number, x1: number, x2: number, thickness?: number) => void;
    vertical: (x: number, y1: number, y2: number, thickness?: number) => void;
    line: (x1: number, y1: number, x2: number, y2: number) => void;
  } {
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
      const value = dark ? 22 : 250;
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
    return { imageData: { width, height, data } as ImageData, paint, horizontal, vertical, line };
  }

  function threeRoomDoorPlan(): ImageData {
    const width = 240;
    const height = 160;
    const plan = blankDoorAwareImage(width, height);
    plan.horizontal(8, 8, 231);
    plan.horizontal(151, 8, 231);
    plan.vertical(8, 8, 151);
    plan.vertical(231, 8, 151);

    // Vertical partition with a doorway.
    plan.vertical(120, 8, 57);
    plan.vertical(120, 87, 151);
    plan.line(120, 57, 92, 85);
    for (let degree = 0; degree <= 90; degree += 3) {
      const radians = degree * Math.PI / 180;
      plan.paint(Math.round(120 - Math.cos(radians) * 29), Math.round(57 + Math.sin(radians) * 29));
    }

    // Shorter horizontal partition on the right with a second doorway.
    plan.horizontal(105, 120, 169);
    plan.horizontal(105, 195, 231);
    plan.line(169, 105, 193, 81);
    for (let degree = 270; degree <= 360; degree += 3) {
      const radians = degree * Math.PI / 180;
      plan.paint(Math.round(169 + Math.cos(radians) * 25), Math.round(105 + Math.sin(radians) * 25));
    }

    // Isolated service symbol: must not become a wall or room.
    plan.horizontal(132, 145, 161, 1);
    plan.vertical(145, 124, 140, 1);
    plan.vertical(161, 124, 140, 1);
    return plan.imageData;
  }

  function openPassagePlan(): ImageData {
    const width = 180;
    const height = 120;
    const plan = blankDoorAwareImage(width, height);
    plan.horizontal(8, 8, 171);
    plan.horizontal(111, 8, 171);
    plan.vertical(8, 8, 111);
    plan.vertical(171, 8, 111);
    plan.vertical(90, 8, 43);
    plan.vertical(90, 77, 111);
    return plan.imageData;
  }

  try {
    const detected = detectDoorAwareStructuralRegionsFromImageData(threeRoomDoorPlan(), {
      threshold: 155,
      minimumDoorGap: 10,
      maximumDoorGap: 40,
      minimumAreaRatio: 0.003,
    });
    doorAwareAssert(detected.doors.length >= 2, `Expected two detected doors, received ${detected.doors.length}`);
    doorAwareAssert(detected.regions.length === 3, `Expected three rooms separated by detected doors, received ${detected.regions.length}`);
    doorAwareAssert(detected.regions.every((region) => region.points.length <= 16), "Door leaves or arcs created polygon notches");
    console.log("✓ detects door assemblies and closes only their openings");
  } catch (error) {
    process.exitCode = 1;
    console.error("✗ detects door assemblies and closes only their openings");
    console.error(error);
  }

  try {
    const openPassage = detectDoorAwareStructuralRegionsFromImageData(openPassagePlan(), {
      threshold: 155,
      minimumDoorGap: 10,
      maximumDoorGap: 42,
      minimumAreaRatio: 0.003,
    });
    doorAwareAssert(openPassage.doors.length === 0, `An open passage was incorrectly classified as a door (${openPassage.doors.length})`);
    doorAwareAssert(openPassage.regions.length === 1, `The open passage should keep one connected space, received ${openPassage.regions.length}`);
    console.log("✓ leaves openings without door-symbol evidence open");
  } catch (error) {
    process.exitCode = 1;
    console.error("✗ leaves openings without door-symbol evidence open");
    console.error(error);
  }
}
