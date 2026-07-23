namespace ICPDrawingLab {
  type DragState =
    | {
      type: "vertex";
      roomId: string;
      vertexIndex: number;
      before: HistorySnapshot;
    }
    | {
      type: "room";
      roomId: string;
      start: Point;
      originalPoints: Point[];
      before: HistorySnapshot;
    }
    | {
      type: "pan";
      clientX: number;
      clientY: number;
      originalX: number;
      originalY: number;
    }
    | {
      type: "analysis-area";
      start: Point;
      current: Point;
    };

  export class DrawingRenderer {
    private readonly viewport = assertElement<HTMLElement>("#stageViewport");
    private readonly surface = assertElement<HTMLElement>("#stageSurface");
    private readonly canvas = assertElement<HTMLCanvasElement>("#drawingCanvas");
    private readonly overlay = assertElement<SVGSVGElement>("#drawingOverlay");
    private readonly pageTabs = assertElement<HTMLElement>("#pageTabs");
    private readonly roomList = assertElement<HTMLElement>("#roomList");
    private readonly inspector = assertElement<HTMLElement>("#inspectorContent");
    private readonly analysisSummary = assertElement<HTMLElement>("#analysisSummary");
    private readonly emptyState = assertElement<HTMLElement>("#emptyStage");
    private readonly selectAnalysisAreaButton = assertElement<HTMLButtonElement>("#selectAnalysisAreaButton");
    private readonly clearAnalysisAreaButton = assertElement<HTMLButtonElement>("#clearAnalysisAreaButton");
    private readonly draftLabelInput = assertElement<HTMLInputElement>("#draftRoomLabel");
    private readonly finishDraftButton = assertElement<HTMLButtonElement>("#finishDraftButton");
    private readonly cancelDraftButton = assertElement<HTMLButtonElement>("#cancelDraftButton");
    private readonly zoomOutput = assertElement<HTMLElement>("#zoomOutput");
    private readonly undoButton = assertElement<HTMLButtonElement>("#undoButton");
    private readonly redoButton = assertElement<HTMLButtonElement>("#redoButton");

    private loadedPageId: string | null = null;
    private drag: DragState | null = null;

    constructor(private readonly store: EditorStore) {
      this.bindStageEvents();
      this.bindPanelEvents();
      store.subscribe(() => this.render());
    }

    async render(): Promise<void> {
      this.renderToolState();
      this.renderPageTabs();
      this.renderRoomList();
      this.renderInspector();
      this.renderAnalysisSummary();
      this.renderStageGeometry();
      await this.renderDrawingImage();
    }

    fitToViewport(): void {
      const page = this.store.activePage;
      if (!page) return;
      const widthScale = (this.viewport.clientWidth - 32) / page.width;
      const heightScale = (this.viewport.clientHeight - 32) / page.height;
      const scale = clamp(Math.min(widthScale, heightScale), 0.1, 4);
      const translateX = (this.viewport.clientWidth - page.width * scale) / 2;
      const translateY = (this.viewport.clientHeight - page.height * scale) / 2;
      this.store.updateView({ scale, translateX, translateY });
    }

    zoomBy(factor: number, anchorClient?: PixelPoint): void {
      const page = this.store.activePage;
      if (!page) return;
      const view = this.store.view;
      const nextScale = clamp(view.scale * factor, 0.08, 8);
      const viewportRect = this.viewport.getBoundingClientRect();
      const anchor = anchorClient ?? {
        x: viewportRect.left + viewportRect.width / 2,
        y: viewportRect.top + viewportRect.height / 2,
      };
      const localX = (anchor.x - viewportRect.left - view.translateX) / view.scale;
      const localY = (anchor.y - viewportRect.top - view.translateY) / view.scale;
      const translateX = anchor.x - viewportRect.left - localX * nextScale;
      const translateY = anchor.y - viewportRect.top - localY * nextScale;
      this.store.updateView({ scale: nextScale, translateX, translateY });
    }

    private async renderDrawingImage(): Promise<void> {
      const page = this.store.activePage;
      if (!page) {
        this.loadedPageId = null;
        return;
      }
      if (this.loadedPageId === page.id && this.canvas.width === page.width && this.canvas.height === page.height) return;
      this.loadedPageId = page.id;
      const image = await loadImage(page.imageDataUrl);
      this.canvas.width = page.width;
      this.canvas.height = page.height;
      const context = this.canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas is not supported by this browser.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, page.width, page.height);
      context.drawImage(image, 0, 0, page.width, page.height);
    }

    private activeAnalysisArea(page: DrawingPage): BoundingBox | null {
      if (this.drag?.type === "analysis-area") {
        return this.boundingBoxFromPoints(this.drag.start, this.drag.current, page);
      }
      return page.analysisArea ?? null;
    }

    private boundingBoxFromPoints(start: Point, end: Point, page: DrawingPage): BoundingBox {
      const left = clamp(Math.min(start.x, end.x), 0, 1);
      const top = clamp(Math.min(start.y, end.y), 0, 1);
      const right = clamp(Math.max(start.x, end.x), 0, 1);
      const bottom = clamp(Math.max(start.y, end.y), 0, 1);
      return {
        x: round(left * page.width),
        y: round(top * page.height),
        width: round((right - left) * page.width),
        height: round((bottom - top) * page.height),
      };
    }

    private analysisAreaSvg(area: BoundingBox | null): string {
      if (!area || area.width < 4 || area.height < 4) return "";
      return `
        <g class="analysis-area-layer">
          <rect class="analysis-area-rect" x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="6" />
          <text class="analysis-area-label" x="${area.x + 10}" y="${Math.max(18, area.y - 10)}">Recognition area</text>
        </g>`;
    }

    private renderStageGeometry(): void {
      const page = this.store.activePage;
      const hasPage = Boolean(page);
      this.emptyState.hidden = hasPage;
      this.surface.hidden = !hasPage;
      if (!page) return;

      this.surface.style.width = `${page.width}px`;
      this.surface.style.height = `${page.height}px`;
      this.surface.style.transform = `translate(${this.store.view.translateX}px, ${this.store.view.translateY}px) scale(${this.store.view.scale})`;
      this.canvas.style.width = `${page.width}px`;
      this.canvas.style.height = `${page.height}px`;
      this.overlay.setAttribute("viewBox", `0 0 ${page.width} ${page.height}`);
      this.overlay.setAttribute("width", String(page.width));
      this.overlay.setAttribute("height", String(page.height));
      this.zoomOutput.textContent = `${Math.round(this.store.view.scale * 100)}%`;

      const rooms = page.rooms.map((room) => this.roomSvg(room, page)).join("");
      const labels = page.labels
        .filter((label) => !label.consumedByRoomId && boundingBoxCenterInsideArea(label.box, page.analysisArea ?? null))
        .map((label) => this.labelSvg(label))
        .join("");
      const draft = this.draftSvg(page);
      const analysisArea = this.analysisAreaSvg(this.activeAnalysisArea(page));
      this.overlay.innerHTML = `${rooms}${labels}${draft}${analysisArea}`;
    }

    private roomSvg(room: RoomShape, page: DrawingPage): string {
      const selected = room.id === this.store.selectedRoomId;
      const fill = progressFill(room.progress, room.reviewStatus);
      const stroke = progressStroke(room.progress, room.reviewStatus);
      const centroid = normalizedToPixel(polygonCentroid(room.points), page.width, page.height);
      const label = escapeHtml(room.displayLabel);
      const percent = percentage(room.progress);
      const dash = room.reviewStatus === "unreviewed" ? "8 6" : room.reviewStatus === "rejected" ? "4 6" : "";
      const handles = selected
        ? room.points.map((point, index) => {
          const pixel = normalizedToPixel(point, page.width, page.height);
          return `<circle class="vertex-handle" data-room-id="${room.id}" data-vertex-index="${index}" cx="${pixel.x}" cy="${pixel.y}" r="7" />`;
        }).join("")
        : "";
      return `
        <g class="room-shape ${selected ? "is-selected" : ""}" data-room-id="${room.id}">
          <polygon class="room-polygon" data-room-id="${room.id}" points="${pointsToSvg(room.points, page.width, page.height)}"
            fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 4 : 2.5}" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke" />
          <g class="room-map-label" data-room-id="${room.id}" transform="translate(${centroid.x} ${centroid.y})">
            <rect x="-48" y="-24" width="96" height="48" rx="8" />
            <text class="room-code" text-anchor="middle" y="-4">${label}</text>
            <text class="room-progress" text-anchor="middle" y="15">${percent}%</text>
          </g>
          ${handles}
        </g>`;
    }

    private labelSvg(label: DetectedLabel): string {
      const selected = label.id === this.store.selectedLabelId;
      const centerX = label.box.x + label.box.width / 2;
      const centerY = label.box.y + label.box.height / 2;
      return `
        <g class="label-marker ${selected ? "is-selected" : ""}" data-label-id="${label.id}" transform="translate(${centerX} ${centerY})">
          <circle r="11" />
          <line x1="-16" y1="0" x2="16" y2="0" />
          <line x1="0" y1="-16" x2="0" y2="16" />
          <text x="16" y="-10">${escapeHtml(label.roomCode)}</text>
        </g>`;
    }

    private draftSvg(page: DrawingPage): string {
      if (!this.store.draftPoints.length) return "";
      const points = pointsToSvg(this.store.draftPoints, page.width, page.height);
      const handles = this.store.draftPoints.map((point) => {
        const pixel = normalizedToPixel(point, page.width, page.height);
        return `<circle class="draft-handle" cx="${pixel.x}" cy="${pixel.y}" r="6" />`;
      }).join("");
      return `<g class="draft-room"><polyline points="${points}" />${handles}</g>`;
    }

    private renderToolState(): void {
      document.querySelectorAll<HTMLButtonElement>("[data-editor-tool]").forEach((button) => {
        const active = button.dataset.editorTool === this.store.tool;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      this.undoButton.disabled = !this.store.canUndo();
      this.redoButton.disabled = !this.store.canRedo();
      const selectingArea = this.store.tool === "analysis-area";
      this.selectAnalysisAreaButton.classList.toggle("is-active", selectingArea);
      this.clearAnalysisAreaButton.disabled = !this.store.activePage?.analysisArea;
      const drawing = this.store.tool === "draw";
      document.body.classList.toggle("is-drawing", drawing);
      document.body.classList.toggle("is-selecting-area", selectingArea);
      this.finishDraftButton.disabled = this.store.draftPoints.length < 3;
      this.cancelDraftButton.disabled = this.store.draftPoints.length === 0;
      if (document.activeElement !== this.draftLabelInput) this.draftLabelInput.value = this.store.draftLabel;
    }

    private renderPageTabs(): void {
      this.pageTabs.innerHTML = this.store.project.pages.map((page) => `
        <button type="button" class="page-tab ${page.id === this.store.project.activePageId ? "is-active" : ""}" data-page-id="${page.id}">
          <span>${escapeHtml(page.name)}</span>
          <small>${page.rooms.length} rooms</small>
        </button>`).join("");
    }

    private renderRoomList(): void {
      const page = this.store.activePage;
      if (!page) {
        this.roomList.innerHTML = `<div class="panel-empty">Upload a plan to start mapping rooms.</div>`;
        return;
      }
      const roomRows = page.rooms.map((room) => {
        const linkedRoom = FAKE_ROOM_DATABASE.find((item) => item.id === room.linkedRoomId);
        const status = room.reviewStatus.replace("-", " ");
        return `<button type="button" class="room-list-row ${room.id === this.store.selectedRoomId ? "is-active" : ""}" data-select-room="${room.id}">
          <span class="room-list-main"><strong>${escapeHtml(room.displayLabel)}</strong><small>${escapeHtml(linkedRoom?.name ?? "Not linked")}</small></span>
          <span class="review-pill" data-status="${room.reviewStatus}">${escapeHtml(status)}</span>
        </button>`;
      }).join("");
      const unmatchedRows = page.labels.filter((label) => !label.consumedByRoomId && boundingBoxCenterInsideArea(label.box, page.analysisArea ?? null)).map((label) => `
        <button type="button" class="room-list-row label-row ${label.id === this.store.selectedLabelId ? "is-active" : ""}" data-select-label="${label.id}">
          <span class="room-list-main"><strong>${escapeHtml(label.roomCode)}</strong><small>${escapeHtml(label.source)} · no boundary</small></span>
          <span class="review-pill" data-status="unreviewed">label</span>
        </button>`).join("");
      this.roomList.innerHTML = roomRows || unmatchedRows
        ? `${roomRows}${unmatchedRows}`
        : `<div class="panel-empty">No room labels or boundaries yet. Run recognition or draw manually.</div>`;
    }

    private renderInspector(): void {
      const room = this.store.selectedRoom;
      if (room) {
        const options = [`<option value="">Not linked</option>`, ...FAKE_ROOM_DATABASE.map((item) => `
          <option value="${item.id}" ${item.id === (room.linkedRoomId ?? room.suggestedRoomId) ? "selected" : ""}>
            ${escapeHtml(item.building)} · ${escapeHtml(item.level)} · ${escapeHtml(item.code)} — ${escapeHtml(item.name)}
          </option>`)].join("");
        const suggested = FAKE_ROOM_DATABASE.find((item) => item.id === room.suggestedRoomId);
        this.inspector.innerHTML = `
          <div class="inspector-heading">
            <div><span class="eyebrow">Selected room</span><h3>${escapeHtml(room.displayLabel)}</h3></div>
            <span class="review-pill" data-status="${room.reviewStatus}">${escapeHtml(room.reviewStatus)}</span>
          </div>
          <label class="field"><span>Displayed label</span><input data-room-field="displayLabel" value="${escapeHtml(room.displayLabel)}" /></label>
          <label class="field"><span>Linked fake database room</span><select data-room-field="linkedRoomId">${options}</select></label>
          ${suggested ? `<div class="suggestion-card"><span>Automatic suggestion</span><strong>${escapeHtml(suggested.code)} — ${escapeHtml(suggested.name)}</strong><small>Match confidence ${Math.round((room.matchConfidence ?? 0) * 100)}%</small></div>` : `<div class="suggestion-card is-muted">No reliable automatic database match.</div>`}
          <div class="button-grid">
            <button type="button" class="button success" data-inspector-action="accept-room">Accept link</button>
            <button type="button" class="button" data-inspector-action="reject-room">Reject</button>
          </div>
          <div class="metric-fields">
            <label class="field"><span>Total scope</span><input type="number" min="0" data-progress-field="total" value="${room.progress.total}" /></label>
            <label class="field"><span>Completed</span><input type="number" min="0" data-progress-field="completed" value="${room.progress.completed}" /></label>
          </div>
          <dl class="metadata-list">
            <div><dt>Progress</dt><dd>${percentage(room.progress)}%</dd></div>
            <div><dt>Geometry source</dt><dd>${escapeHtml(room.source)}</dd></div>
            <div><dt>Boundary confidence</dt><dd>${room.detectionConfidence === null ? "—" : `${Math.round(room.detectionConfidence * 100)}%`}</dd></div>
            <div><dt>Vertices</dt><dd>${room.points.length}</dd></div>
          </dl>
          <button type="button" class="button danger full-width" data-inspector-action="delete-room">Delete room geometry</button>`;
        return;
      }

      const label = this.store.selectedLabel;
      if (label) {
        const suggestion = suggestRoomMatch(label.roomCode);
        this.inspector.innerHTML = `
          <div class="inspector-heading"><div><span class="eyebrow">Unmapped label</span><h3>${escapeHtml(label.roomCode)}</h3></div><span class="review-pill" data-status="unreviewed">${escapeHtml(label.source)}</span></div>
          <p class="panel-copy">The label was recognized, but a reliable boundary was not created. Draw around the room and the label will be carried into the new geometry.</p>
          ${suggestion.room ? `<div class="suggestion-card"><span>Suggested database room</span><strong>${escapeHtml(suggestion.room.code)} — ${escapeHtml(suggestion.room.name)}</strong><small>${Math.round((suggestion.confidence ?? 0) * 100)}% match</small></div>` : ""}
          <button type="button" class="button primary full-width" data-inspector-action="draw-label">Draw this room</button>
          <button type="button" class="button full-width" data-inspector-action="ignore-label">Ignore label</button>`;
        return;
      }

      this.inspector.innerHTML = `<div class="panel-empty large"><strong>Nothing selected</strong><span>Select a suggested room, an unmatched label, or draw a new polygon.</span></div>`;
    }

    private renderAnalysisSummary(): void {
      const page = this.store.activePage;
      if (!page) {
        this.analysisSummary.innerHTML = `<span>No drawing loaded</span>`;
        return;
      }
      const accepted = page.rooms.filter((room) => room.reviewStatus === "accepted" || room.reviewStatus === "manual").length;
      const review = page.rooms.filter((room) => room.reviewStatus === "unreviewed").length;
      const visibleLabels = page.labels.filter((label) => boundingBoxCenterInsideArea(label.box, page.analysisArea ?? null));
      const unmatched = visibleLabels.filter((label) => !label.consumedByRoomId).length;
      const analysisArea = page.analysisArea;
      const analysisScope = analysisArea ? `${Math.round(analysisArea.width)}×${Math.round(analysisArea.height)}` : "Full page";
      this.analysisSummary.innerHTML = `
        <div><strong>${visibleLabels.length}</strong><span>labels</span></div>
        <div><strong>${page.rooms.length}</strong><span>boundaries</span></div>
        <div><strong>${accepted}</strong><span>approved</span></div>
        <div><strong>${review + unmatched}</strong><span>to review</span></div>
        <div><strong>${escapeHtml(analysisScope)}</strong><span>analysis area</span></div>`;
    }

    private bindStageEvents(): void {
      this.overlay.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
      window.addEventListener("pointermove", (event) => this.handlePointerMove(event));
      window.addEventListener("pointerup", () => this.handlePointerUp());
      this.overlay.addEventListener("dblclick", (event) => {
        if (this.store.tool !== "draw") return;
        event.preventDefault();
        this.store.finishDraft(this.draftLabelInput.value);
      });
      this.viewport.addEventListener("wheel", (event) => {
        if (!this.store.activePage) return;
        event.preventDefault();
        this.zoomBy(event.deltaY < 0 ? 1.12 : 0.89, { x: event.clientX, y: event.clientY });
      }, { passive: false });
      this.viewport.addEventListener("pointerdown", (event) => {
        if (event.target !== this.viewport && event.target !== this.surface && event.target !== this.canvas) return;
        if (this.store.tool === "pan" || event.button === 1 || event.altKey) {
          this.drag = {
            type: "pan",
            clientX: event.clientX,
            clientY: event.clientY,
            originalX: this.store.view.translateX,
            originalY: this.store.view.translateY,
          };
        }
      });
    }

    private handlePointerDown(event: PointerEvent): void {
      const target = event.target as Element;
      const page = this.store.activePage;
      if (!page) return;

      if (this.store.tool === "pan" || event.button === 1 || event.altKey) {
        this.drag = {
          type: "pan",
          clientX: event.clientX,
          clientY: event.clientY,
          originalX: this.store.view.translateX,
          originalY: this.store.view.translateY,
        };
        return;
      }

      const local = this.eventToNormalized(event);
      if (this.store.tool === "analysis-area") {
        event.preventDefault();
        this.drag = {
          type: "analysis-area",
          start: local,
          current: local,
        };
        return;
      }
      if (this.store.tool === "draw") {
        event.preventDefault();
        this.store.addDraftPoint(local);
        return;
      }

      const labelElement = target.closest<SVGGElement>("[data-label-id]");
      if (labelElement?.dataset.labelId) {
        this.store.selectLabel(labelElement.dataset.labelId);
        return;
      }

      const vertex = target.closest<SVGCircleElement>("[data-vertex-index]");
      const roomElement = target.closest<SVGElement>("[data-room-id]");
      const roomId = roomElement?.dataset.roomId;

      if (this.store.tool === "delete-vertex" && vertex?.dataset.roomId && vertex.dataset.vertexIndex) {
        const vertexIndex = Number(vertex.dataset.vertexIndex);
        this.store.updateRoom(vertex.dataset.roomId, (room) => {
          if (room.points.length > 3) room.points.splice(vertexIndex, 1);
        });
        return;
      }

      if (this.store.tool === "add-vertex" && roomId) {
        this.store.selectRoom(roomId);
        this.store.updateRoom(roomId, (room) => {
          room.points = insertVertex(room.points, local);
        });
        return;
      }

      if (vertex?.dataset.roomId && vertex.dataset.vertexIndex !== undefined) {
        this.store.selectRoom(vertex.dataset.roomId);
        this.drag = {
          type: "vertex",
          roomId: vertex.dataset.roomId,
          vertexIndex: Number(vertex.dataset.vertexIndex),
          before: this.store.startTransaction(),
        };
        return;
      }

      if (roomId) {
        this.store.selectRoom(roomId);
        const room = this.store.selectedRoom;
        if (!room) return;
        this.drag = {
          type: "room",
          roomId,
          start: local,
          originalPoints: deepClone(room.points),
          before: this.store.startTransaction(),
        };
        return;
      }

      this.store.selectRoom(null);
    }

    private handlePointerMove(event: PointerEvent): void {
      if (!this.drag) return;
      if (this.drag.type === "pan") {
        this.store.updateView({
          translateX: this.drag.originalX + event.clientX - this.drag.clientX,
          translateY: this.drag.originalY + event.clientY - this.drag.clientY,
        });
        return;
      }
      const point = this.eventToNormalized(event);
      if (this.drag.type === "analysis-area") {
        this.drag.current = point;
        void this.render();
        return;
      }
      if (this.drag.type === "vertex") {
        this.store.updateRoom(this.drag.roomId, (room) => {
          room.points[this.drag && this.drag.type === "vertex" ? this.drag.vertexIndex : 0] = point;
        }, false);
        return;
      }
      const delta = { x: point.x - this.drag.start.x, y: point.y - this.drag.start.y };
      this.store.updateRoom(this.drag.roomId, (room) => {
        room.points = translatePolygon(this.drag && this.drag.type === "room" ? this.drag.originalPoints : room.points, delta);
      }, false);
    }

    private handlePointerUp(): void {
      if (!this.drag) return;
      if (this.drag.type === "vertex" || this.drag.type === "room") {
        this.store.commitTransaction(this.drag.before);
      }
      if (this.drag.type === "analysis-area") {
        const page = this.store.activePage;
        if (page) {
          const area = this.boundingBoxFromPoints(this.drag.start, this.drag.current, page);
          if (area.width >= 12 && area.height >= 12) {
            this.store.setAnalysisArea(area);
          }
        }
        this.store.setTool("select");
      }
      this.drag = null;
    }

    private eventToNormalized(event: PointerEvent): Point {
      const page = this.store.activePage;
      if (!page) return { x: 0, y: 0 };
      const rect = this.viewport.getBoundingClientRect();
      const x = (event.clientX - rect.left - this.store.view.translateX) / this.store.view.scale;
      const y = (event.clientY - rect.top - this.store.view.translateY) / this.store.view.scale;
      return pixelToNormalized({ x, y }, page.width, page.height);
    }

    private bindPanelEvents(): void {
      this.pageTabs.addEventListener("click", (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>("[data-page-id]");
        if (button?.dataset.pageId) {
          this.loadedPageId = null;
          this.store.setActivePage(button.dataset.pageId);
          window.requestAnimationFrame(() => this.fitToViewport());
        }
      });
      this.roomList.addEventListener("click", (event) => {
        const room = (event.target as Element).closest<HTMLElement>("[data-select-room]");
        if (room?.dataset.selectRoom) this.store.selectRoom(room.dataset.selectRoom);
        const label = (event.target as Element).closest<HTMLElement>("[data-select-label]");
        if (label?.dataset.selectLabel) this.store.selectLabel(label.dataset.selectLabel);
      });
      this.inspector.addEventListener("change", (event) => this.handleInspectorChange(event));
      this.inspector.addEventListener("click", (event) => this.handleInspectorClick(event));
      this.draftLabelInput.addEventListener("input", () => {
        this.store.draftLabel = this.draftLabelInput.value;
      });
    }

    private handleInspectorChange(event: Event): void {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const roomField = target.dataset.roomField;
      if (roomField === "displayLabel") {
        this.store.updateSelectedRoom((room) => {
          room.displayLabel = target.value.trim() || room.displayLabel;
          room.progress = fakeProgressForRoom(room.displayLabel);
          const suggestion = suggestRoomMatch(room.displayLabel);
          room.suggestedRoomId = suggestion.room?.id ?? null;
          room.matchConfidence = suggestion.confidence;
        });
      }
      if (roomField === "linkedRoomId") {
        this.store.updateSelectedRoom((room) => {
          room.linkedRoomId = target.value || null;
          if (target.value) room.reviewStatus = "accepted";
        });
      }
      const progressField = target.dataset.progressField as keyof ProgressData | undefined;
      if (progressField) {
        this.store.updateSelectedRoom((room) => {
          room.progress[progressField] = Math.max(0, Number(target.value) || 0);
          if (room.progress.completed > room.progress.total && room.progress.total > 0) {
            room.progress.completed = room.progress.total;
          }
        });
      }
    }

    private handleInspectorClick(event: Event): void {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-inspector-action]");
      const action = button?.dataset.inspectorAction;
      if (!action) return;
      if (action === "accept-room") {
        const select = this.inspector.querySelector<HTMLSelectElement>("[data-room-field='linkedRoomId']");
        this.store.acceptSelectedRoom(select?.value || null);
      }
      if (action === "reject-room") this.store.rejectSelectedRoom();
      if (action === "delete-room" && confirm("Delete this room geometry?")) this.store.deleteSelectedRoom();
      if (action === "draw-label") {
        const label = this.store.selectedLabel;
        if (!label) return;
        this.store.draftLabel = label.roomCode;
        this.store.setTool("draw");
      }
      if (action === "ignore-label") this.store.ignoreSelectedLabel();
    }
  }
}
