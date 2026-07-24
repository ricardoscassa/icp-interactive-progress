namespace ICPDrawingLab {
  function qualityAssert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function qualityTestPage(): DrawingPage {
    return {
      id: "quality-page",
      name: "Quality test",
      sourceType: "image",
      width: 1000,
      height: 500,
      imageDataUrl: "",
      labels: [],
      rooms: [],
      analysisArea: null,
      pdfSourceKey: null,
      pdfPageNumber: null,
      pdfLayers: [],
      selectedAreaLayerIds: [],
      selectedLabelLayerIds: [],
    };
  }

  function qualityTestRoom(id: string, points: Point[]): RoomShape {
    return {
      id,
      displayLabel: `UNASSIGNED ${id}`,
      points,
      source: "automatic",
      detectionConfidence: 0.8,
      detectedLabelId: null,
      suggestedRoomId: null,
      linkedRoomId: null,
      matchConfidence: null,
      reviewStatus: "unreviewed",
      progress: { total: 1, completed: 0 },
    };
  }

  try {
    const page = qualityTestPage();
    const room = qualityTestRoom("001", [
      { x: 0.08, y: 0.08 },
      { x: 0.45, y: 0.08 },
      { x: 0.45, y: 0.48 },
      { x: 0.08, y: 0.48 },
    ]);
    const stairPocket = qualityTestRoom("002", [
      { x: 0.55, y: 0.10 },
      { x: 0.90, y: 0.10 },
      { x: 0.90, y: 0.13 },
      { x: 0.55, y: 0.13 },
    ]);
    const doorPocket = qualityTestRoom("003", [
      { x: 0.55, y: 0.20 },
      { x: 0.60, y: 0.20 },
      { x: 0.60, y: 0.25 },
      { x: 0.55, y: 0.25 },
    ]);

    const result = selectPlausibleUnassignedRooms(page, [room, stairPocket, doorPocket]);
    qualityAssert(result.kept.some((candidate) => candidate.id === room.id), "A full room was rejected by room-quality filtering");
    qualityAssert(result.rejected.some((candidate) => candidate.id === stairPocket.id), "A narrow stair pocket was treated as a room");
    qualityAssert(result.rejected.some((candidate) => candidate.id === doorPocket.id), "A small door pocket was treated as a room");
    console.log("✓ filters door and stair pockets from unassigned room suggestions");
  } catch (error) {
    process.exitCode = 1;
    console.error("✗ filters door and stair pockets from unassigned room suggestions");
    console.error(error);
  }
}
