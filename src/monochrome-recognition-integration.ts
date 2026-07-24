namespace ICPDrawingLab {
  const analysePageBeforeMonochromeSequence = analysePage;

  function createMonochromeRoomSuggestion(
    page: DrawingPage,
    displayLabel: string,
    region: VectorRegion,
    label: DetectedLabel | null,
  ): RoomShape {
    const match = label ? suggestRoomMatch(displayLabel) : { room: null, confidence: null, exact: false };
    const room: RoomShape = {
      id: uid("room-shape"),
      displayLabel,
      points: region.points,
      source: "automatic",
      detectionConfidence: region.confidence,
      detectedLabelId: label?.id ?? null,
      suggestedRoomId: match.room?.id ?? null,
      linkedRoomId: null,
      matchConfidence: match.confidence,
      reviewStatus: "unreviewed",
      progress: fakeProgressForRoom(displayLabel),
    };
    page.rooms.push(room);
    if (label) label.consumedByRoomId = room.id;
    return room;
  }

  async function analysePageWithMonochromeSequence(
    page: DrawingPage,
    settings: RecognitionSettings,
    onProgress: (message: string, progress?: number) => void,
  ): Promise<AnalysisSummary> {
    const summary = await analysePageBeforeMonochromeSequence(page, settings, onProgress);
    if (!settings.createBoundarySuggestions || summary.colourRegionsFound > 0) return summary;

    onProgress("Reconstructing complete monochrome room polygons…", 0.9);
    const regions = await detectMonochromeRegions(page, settings.darkThreshold);
    if (!regions.length) return summary;

    const usedRegionIds = new Set<string>();
    let addedRooms = 0;
    let repairedRooms = 0;
    let unassignedRooms = 0;
    const labels = page.labels.filter((label) => boundingBoxCenterInsideArea(label.box, page.analysisArea ?? null));

    for (const label of labels) {
      const available = regions.filter((region) => !usedRegionIds.has(region.id));
      const region = vectorRegionForLabel(label, page, available);
      if (!region) continue;
      usedRegionIds.add(region.id);

      const existing = page.rooms.find((room) => room.detectedLabelId === label.id)
        ?? page.rooms.find((room) => normalizeRoomCode(room.displayLabel) === normalizeRoomCode(label.roomCode));
      if (existing) {
        if (existing.source === "automatic" && existing.reviewStatus === "unreviewed") {
          existing.points = region.points;
          existing.detectionConfidence = region.confidence;
          existing.detectedLabelId = label.id;
          label.consumedByRoomId = existing.id;
          repairedRooms += 1;
        }
        continue;
      }

      createMonochromeRoomSuggestion(page, label.roomCode, region, label);
      addedRooms += 1;
    }

    const unused = regions.filter((region) => !usedRegionIds.has(region.id));
    for (const region of unused) {
      const centre = polygonCentroid(region.points);
      const duplicate = page.rooms.some((room) => {
        const roomCentre = polygonCentroid(room.points);
        return Math.hypot(roomCentre.x - centre.x, roomCentre.y - centre.y) < 0.018;
      });
      if (duplicate) continue;
      const nextIndex = page.rooms.filter((room) => room.displayLabel.startsWith("UNASSIGNED")).length + 1;
      createMonochromeRoomSuggestion(
        page,
        `UNASSIGNED ${String(nextIndex).padStart(3, "0")}`,
        region,
        null,
      );
      addedRooms += 1;
      unassignedRooms += 1;
    }

    summary.roomsSuggested += addedRooms;
    summary.unlabelledRegionsSuggested += unassignedRooms;
    summary.boundariesFailed = Math.max(0, summary.boundariesFailed - addedRooms + unassignedRooms);
    onProgress(
      `Monochrome reconstruction found ${regions.length} enclosed spaces, repaired ${repairedRooms} boundaries and added ${addedRooms} suggestions.`,
      0.99,
    );
    return summary;
  }

  (ICPDrawingLab as unknown as { analysePage: typeof analysePage }).analysePage = analysePageWithMonochromeSequence;
}
