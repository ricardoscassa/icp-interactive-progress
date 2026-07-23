declare const process: { exitCode?: number };
namespace ICPDrawingLab {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function approximately(actual: number, expected: number, tolerance = 0.0001): void {
    assert(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be close to ${expected}`);
  }

  const tests: Array<{ name: string; run: () => void }> = [
    {
      name: "normalizes room codes for automatic matching",
      run: () => {
        assert(normalizeRoomCode(" Room 1A-201 ") === "1A201", "Room code was not normalized correctly");
      },
    },
    {
      name: "suggests an exact fake database room match",
      run: () => {
        const result = suggestRoomMatch("101");
        assert(result.room?.id === "room-101", "Exact room was not suggested");
        assert(result.exact, "Exact match was not marked exact");
      },
    },
    {
      name: "inserts a vertex on the nearest polygon segment",
      run: () => {
        const polygon: Point[] = [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ];
        const result = insertVertex(polygon, { x: 0.5, y: 0.02 });
        assert(result.length === 5, "Vertex was not inserted");
        approximately(result[1].x, 0.5);
      },
    },
    {
      name: "clamps polygon movement within drawing bounds",
      run: () => {
        const polygon: Point[] = [
          { x: 0.8, y: 0.8 },
          { x: 0.95, y: 0.8 },
          { x: 0.95, y: 0.95 },
          { x: 0.8, y: 0.95 },
        ];
        const result = translatePolygon(polygon, { x: 0.5, y: 0.5 });
        approximately(Math.max(...result.map((point) => point.x)), 1);
        approximately(Math.max(...result.map((point) => point.y)), 1);
      },
    },
    {
      name: "keeps labels whose centre is inside the recognition area",
      run: () => {
        const area: BoundingBox = { x: 100, y: 100, width: 400, height: 300 };
        assert(
          boundingBoxCenterInsideArea({ x: 250, y: 180, width: 40, height: 20 }, area),
          "Label inside the recognition area was rejected",
        );
      },
    },
    {
      name: "rejects labels whose centre is outside the recognition area",
      run: () => {
        const area: BoundingBox = { x: 100, y: 100, width: 400, height: 300 };
        assert(
          !boundingBoxCenterInsideArea({ x: 540, y: 180, width: 40, height: 20 }, area),
          "Label outside the recognition area was accepted",
        );
      },
    },
    {
      name: "calculates progress percentage safely",
      run: () => {
        assert(percentage({ total: 50, completed: 34 }) === 68, "Progress percentage is incorrect");
        assert(percentage({ total: 0, completed: 10 }) === 0, "Zero total should return zero percent");
      },
    },
  ];

  let failures = 0;
  for (const test of tests) {
    try {
      test.run();
      console.log(`✓ ${test.name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${test.name}`);
      console.error(error);
    }
  }
  if (failures) process.exitCode = 1;
  else console.log(`\n${tests.length} tests passed.`);
}
