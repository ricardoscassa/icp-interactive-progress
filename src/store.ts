namespace ICPDrawingLab {
  export class EditorStore {
    project: DrawingProject;
    selectedRoomId: string | null = null;
    selectedLabelId: string | null = null;
    tool: EditorTool = "select";
    draftPoints: Point[] = [];
    draftLabel = "";
    view: ViewTransform = { scale: 1, translateX: 0, translateY: 0 };

    private listeners = new Set<() => void>();
    private undoStack: HistorySnapshot[] = [];
    private redoStack: HistorySnapshot[] = [];
    private maximumHistory = 80;

    constructor(project?: DrawingProject) {
      this.project = project ?? EditorStore.emptyProject();
    }

    static emptyProject(): DrawingProject {
      const timestamp = nowIso();
      return {
        format: "icp-drawing-lab",
        version: 1,
        name: "ICP Drawing Recognition Test",
        createdAt: timestamp,
        updatedAt: timestamp,
        activePageId: "",
        pages: [],
      };
    }

    subscribe(listener: () => void): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    notify(): void {
      this.project.updatedAt = nowIso();
      this.listeners.forEach((listener) => listener());
    }

    get activePage(): DrawingPage | null {
      return this.project.pages.find((page) => page.id === this.project.activePageId) ?? this.project.pages[0] ?? null;
    }

    get selectedRoom(): RoomShape | null {
      return this.activePage?.rooms.find((room) => room.id === this.selectedRoomId) ?? null;
    }

    get selectedLabel(): DetectedLabel | null {
      return this.activePage?.labels.find((label) => label.id === this.selectedLabelId) ?? null;
    }

    replacePages(pages: DrawingPage[], projectName?: string): void {
      this.pushHistory();
      this.project.pages = pages;
      this.project.activePageId = pages[0]?.id ?? "";
      if (projectName) this.project.name = projectName;
      this.selectedRoomId = null;
      this.selectedLabelId = null;
      this.draftPoints = [];
      this.view = { scale: 1, translateX: 0, translateY: 0 };
      this.notify();
    }

    setActivePage(pageId: string): void {
      if (!this.project.pages.some((page) => page.id === pageId)) return;
      this.project.activePageId = pageId;
      this.selectedRoomId = null;
      this.selectedLabelId = null;
      this.draftPoints = [];
      this.view = { scale: 1, translateX: 0, translateY: 0 };
      this.notify();
    }

    setTool(tool: EditorTool): void {
      this.tool = tool;
      if (tool !== "draw") this.draftPoints = [];
      this.notify();
    }

    selectRoom(roomId: string | null): void {
      this.selectedRoomId = roomId;
      this.selectedLabelId = null;
      this.notify();
    }

    selectLabel(labelId: string | null): void {
      this.selectedLabelId = labelId;
      this.selectedRoomId = null;
      const label = this.selectedLabel;
      if (label) this.draftLabel = label.roomCode;
      this.notify();
    }

    updateView(partial: Partial<ViewTransform>): void {
      this.view = { ...this.view, ...partial };
      this.notify();
    }

    addDraftPoint(point: Point): void {
      this.draftPoints.push({ x: round(point.x), y: round(point.y) });
      this.notify();
    }

    setAnalysisArea(area: BoundingBox | null): void {
      const page = this.activePage;
      if (!page) return;
      this.pushHistory();
      page.analysisArea = area ? deepClone(area) : null;
      this.notify();
    }

    clearAnalysisArea(): void {
      const page = this.activePage;
      if (!page?.analysisArea) return;
      this.pushHistory();
      page.analysisArea = null;
      this.notify();
    }

    cancelDraft(): void {
      this.draftPoints = [];
      this.draftLabel = "";
      this.notify();
    }

    finishDraft(label?: string): RoomShape | null {
      const page = this.activePage;
      if (!page || this.draftPoints.length < 3) return null;
      this.pushHistory();
      const displayLabel = (label ?? this.draftLabel).trim() || `ROOM-${page.rooms.length + 1}`;
      const match = suggestRoomMatch(displayLabel);
      const room: RoomShape = {
        id: uid("room-shape"),
        displayLabel,
        points: deepClone(this.draftPoints),
        source: "manual",
        detectionConfidence: null,
        detectedLabelId: this.selectedLabelId,
        suggestedRoomId: match.room?.id ?? null,
        linkedRoomId: null,
        matchConfidence: match.confidence,
        reviewStatus: "manual",
        progress: fakeProgressForRoom(displayLabel),
      };
      page.rooms.push(room);
      if (this.selectedLabel) this.selectedLabel.consumedByRoomId = room.id;
      this.draftPoints = [];
      this.draftLabel = "";
      this.selectedLabelId = null;
      this.selectedRoomId = room.id;
      this.tool = "select";
      this.notify();
      return room;
    }

    updateSelectedRoom(mutator: (room: RoomShape) => void, recordHistory = true): void {
      const room = this.selectedRoom;
      if (!room) return;
      if (recordHistory) this.pushHistory();
      mutator(room);
      this.notify();
    }

    updateRoom(roomId: string, mutator: (room: RoomShape) => void, recordHistory = true): void {
      const room = this.activePage?.rooms.find((item) => item.id === roomId);
      if (!room) return;
      if (recordHistory) this.pushHistory();
      mutator(room);
      this.notify();
    }

    deleteSelectedRoom(): void {
      const page = this.activePage;
      const room = this.selectedRoom;
      if (!page || !room) return;
      this.pushHistory();
      page.rooms = page.rooms.filter((item) => item.id !== room.id);
      page.labels.forEach((label) => {
        if (label.consumedByRoomId === room.id) label.consumedByRoomId = null;
      });
      this.selectedRoomId = null;
      this.notify();
    }

    acceptSelectedRoom(linkedRoomId?: string | null): void {
      const room = this.selectedRoom;
      if (!room) return;
      this.pushHistory();
      const targetId = linkedRoomId ?? room.suggestedRoomId;
      room.linkedRoomId = targetId ?? null;
      room.reviewStatus = targetId ? "accepted" : "manual";
      this.notify();
    }

    rejectSelectedRoom(): void {
      this.updateSelectedRoom((room) => {
        room.linkedRoomId = null;
        room.reviewStatus = "rejected";
      });
    }

    ignoreSelectedLabel(): void {
      const label = this.selectedLabel;
      if (!label) return;
      this.pushHistory();
      label.consumedByRoomId = "ignored";
      this.selectedLabelId = null;
      this.notify();
    }

    startTransaction(): HistorySnapshot {
      return this.captureSnapshot();
    }

    commitTransaction(before: HistorySnapshot): void {
      const after = this.captureSnapshot();
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      this.undoStack.push(before);
      if (this.undoStack.length > this.maximumHistory) this.undoStack.shift();
      this.redoStack = [];
      this.notify();
    }

    canUndo(): boolean {
      return this.undoStack.length > 0;
    }

    canRedo(): boolean {
      return this.redoStack.length > 0;
    }

    undo(): void {
      const snapshot = this.undoStack.pop();
      if (!snapshot) return;
      this.redoStack.push(this.captureSnapshot());
      this.restoreSnapshot(snapshot);
    }

    redo(): void {
      const snapshot = this.redoStack.pop();
      if (!snapshot) return;
      this.undoStack.push(this.captureSnapshot());
      this.restoreSnapshot(snapshot);
    }

    resetHistory(): void {
      this.undoStack = [];
      this.redoStack = [];
    }

    exportProject(): DrawingProject {
      return deepClone(this.project);
    }

    importProject(project: DrawingProject): void {
      validateProject(project);
      this.project = deepClone(project);
      this.selectedRoomId = null;
      this.selectedLabelId = null;
      this.draftPoints = [];
      this.view = { scale: 1, translateX: 0, translateY: 0 };
      this.resetHistory();
      this.notify();
    }

    private pushHistory(): void {
      this.undoStack.push(this.captureSnapshot());
      if (this.undoStack.length > this.maximumHistory) this.undoStack.shift();
      this.redoStack = [];
    }

    private captureSnapshot(): HistorySnapshot {
      return {
        pages: deepClone(this.project.pages),
        activePageId: this.project.activePageId,
      };
    }

    private restoreSnapshot(snapshot: HistorySnapshot): void {
      this.project.pages = deepClone(snapshot.pages);
      this.project.activePageId = snapshot.activePageId;
      this.selectedRoomId = null;
      this.selectedLabelId = null;
      this.draftPoints = [];
      this.notify();
    }
  }

  export function validateProject(value: unknown): asserts value is DrawingProject {
    if (!value || typeof value !== "object") throw new Error("The project JSON is not an object.");
    const project = value as Partial<DrawingProject>;
    if (project.format !== "icp-drawing-lab" || project.version !== 1) {
      throw new Error("This is not a supported ICP Drawing Lab project.");
    }
    if (!Array.isArray(project.pages)) throw new Error("The project does not contain drawing pages.");
    for (const page of project.pages) {
      if (!page || typeof page !== "object" || !Array.isArray(page.rooms) || !Array.isArray(page.labels)) {
        throw new Error("A drawing page in the project is invalid.");
      }
      const pageWithArea = page as unknown as { analysisArea?: BoundingBox | null };
      if (pageWithArea.analysisArea === undefined) pageWithArea.analysisArea = null;
      for (const room of page.rooms) {
        if (!Array.isArray(room.points) || room.points.length < 3) {
          throw new Error(`Room ${String(room.displayLabel ?? room.id)} has invalid geometry.`);
        }
        if (room.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
          throw new Error(`Room ${String(room.displayLabel ?? room.id)} contains invalid coordinates.`);
        }
      }
    }
  }
}
