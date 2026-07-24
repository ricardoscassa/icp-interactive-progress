namespace ICPDrawingLab {
  const analysePageBeforeRefresh = analysePage;

  function removeRefreshableSuggestions(page: DrawingPage): number {
    const refreshable = page.rooms.filter((room) => room.reviewStatus === "unreviewed" && room.source !== "manual");
    if (!refreshable.length) return 0;
    const removedIds = new Set(refreshable.map((room) => room.id));
    page.rooms = page.rooms.filter((room) => !removedIds.has(room.id));
    for (const label of page.labels) {
      if (label.consumedByRoomId && removedIds.has(label.consumedByRoomId)) {
        label.consumedByRoomId = null;
      }
    }
    return refreshable.length;
  }

  function renumberUnassignedRooms(page: DrawingPage, rooms: RoomShape[]): void {
    const reserved = new Set(
      page.rooms
        .filter((room) => !rooms.includes(room))
        .map((room) => room.displayLabel.match(/^UNASSIGNED\s+(\d+)$/i)?.[1])
        .filter((value): value is string => Boolean(value))
        .map(Number),
    );
    const ordered = rooms.slice().sort((left, right) => {
      const leftCentre = polygonCentroid(left.points);
      const rightCentre = polygonCentroid(right.points);
      const rowDifference = Math.round(leftCentre.y / 0.055) - Math.round(rightCentre.y / 0.055);
      return rowDifference || leftCentre.x - rightCentre.x;
    });
    let next = 1;
    for (const room of ordered) {
      while (reserved.has(next)) next += 1;
      room.displayLabel = `UNASSIGNED ${String(next).padStart(3, "0")}`;
      reserved.add(next);
      next += 1;
    }
  }

  async function analysePageWithFreshSuggestions(
    page: DrawingPage,
    settings: RecognitionSettings,
    onProgress: (message: string, progress?: number) => void,
  ): Promise<AnalysisSummary> {
    const refreshed = removeRefreshableSuggestions(page);
    const summary = await analysePageBeforeRefresh(page, settings, onProgress);
    if (summary.colourRegionsFound > 0) return summary;

    const unassigned = page.rooms.filter((room) => (
      room.reviewStatus === "unreviewed"
      && room.source === "automatic"
      && /^UNASSIGNED\s+\d+$/i.test(room.displayLabel)
    ));
    const { kept, rejected } = selectPlausibleUnassignedRooms(page, unassigned);
    if (rejected.length) {
      const rejectedIds = new Set(rejected.map((room) => room.id));
      page.rooms = page.rooms.filter((room) => !rejectedIds.has(room.id));
      summary.roomsSuggested = Math.max(0, summary.roomsSuggested - rejected.length);
      summary.unlabelledRegionsSuggested = Math.max(0, summary.unlabelledRegionsSuggested - rejected.length);
    }
    renumberUnassignedRooms(page, kept);

    if (refreshed || rejected.length) {
      onProgress(
        `Monochrome cleanup kept ${kept.length} room-like enclosed spaces and ignored ${rejected.length} door, stair or service-detail pockets.`,
        0.995,
      );
    }
    return summary;
  }

  (ICPDrawingLab as unknown as { analysePage: typeof analysePage }).analysePage = analysePageWithFreshSuggestions;
}
