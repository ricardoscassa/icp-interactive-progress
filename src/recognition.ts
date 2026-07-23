namespace ICPDrawingLab {
  const TESSERACT_MODULE_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;

  interface TesseractModuleNamespace {
    createWorker?: TesseractModule["createWorker"];
    default?: TesseractModule;
  }

  function resolveTesseractModule(module: TesseractModuleNamespace): TesseractModule {
    if (typeof module.createWorker === "function") return module as TesseractModule;
    if (module.default && typeof module.default.createWorker === "function") return module.default;
    throw new Error("The OCR library loaded, but its createWorker API was not available.");
  }

  interface TextRun {
    text: string;
    box: BoundingBox;
    confidence: number | null;
    source: LabelSource;
  }

  function intersectingBoxForCode(run: TextRun, fullText: string, roomCode: string): BoundingBox {
    const normalizedFull = fullText.trim();
    if (!normalizedFull || normalizedFull === roomCode) return run.box;
    const index = normalizedFull.toUpperCase().indexOf(roomCode.toUpperCase());
    if (index < 0) return run.box;
    const characterWidth = run.box.width / Math.max(1, normalizedFull.length);
    return {
      x: run.box.x + index * characterWidth,
      y: run.box.y,
      width: Math.max(8, roomCode.length * characterWidth),
      height: run.box.height,
    };
  }

  export function labelsFromTextRuns(
    runs: TextRun[],
    roomPattern: string,
    pageWidth: number,
    pageHeight: number,
  ): DetectedLabel[] {
    const labels: DetectedLabel[] = [];
    const seen = new Set<string>();
    for (const run of runs) {
      for (const roomCode of extractRoomCodes(run.text, roomPattern)) {
        const box = intersectingBoxForCode(run, run.text, roomCode);
        const clampedBox: BoundingBox = {
          x: clamp(box.x, 0, pageWidth),
          y: clamp(box.y, 0, pageHeight),
          width: clamp(box.width, 1, pageWidth),
          height: clamp(box.height, 1, pageHeight),
        };
        const key = `${normalizeRoomCode(roomCode)}|${Math.round(clampedBox.x / 8)}|${Math.round(clampedBox.y / 8)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push({
          id: uid("label"),
          rawText: run.text,
          roomCode,
          box: clampedBox,
          confidence: run.confidence,
          source: run.source,
          consumedByRoomId: null,
        });
      }
    }
    return labels;
  }

  function parseTsv(tsv: string): TextRun[] {
    const rows = tsv.split(/\r?\n/).slice(1);
    const words: Array<{ lineKey: string; text: string; confidence: number | null; box: BoundingBox }> = [];
    for (const row of rows) {
      if (!row.trim()) continue;
      const columns = row.split("\t");
      if (columns.length < 12) continue;
      const level = Number(columns[0]);
      const text = columns.slice(11).join("\t").trim();
      if (level !== 5 || !text) continue;
      const left = Number(columns[6]);
      const top = Number(columns[7]);
      const width = Number(columns[8]);
      const height = Number(columns[9]);
      const confidenceValue = Number(columns[10]);
      if (![left, top, width, height].every(Number.isFinite)) continue;
      words.push({
        lineKey: `${columns[1]}-${columns[2]}-${columns[3]}-${columns[4]}`,
        text,
        confidence: Number.isFinite(confidenceValue) ? confidenceValue / 100 : null,
        box: { x: left, y: top, width, height },
      });
    }

    const groups = new Map<string, typeof words>();
    for (const word of words) {
      const group = groups.get(word.lineKey) ?? [];
      group.push(word);
      groups.set(word.lineKey, group);
    }

    const runs: TextRun[] = words.map((word) => ({ text: word.text, box: word.box, confidence: word.confidence, source: "ocr" }));
    for (const group of groups.values()) {
      const sorted = group.slice().sort((left, right) => left.box.x - right.box.x);
      for (let start = 0; start < sorted.length; start += 1) {
        for (let length = 2; length <= 5 && start + length <= sorted.length; length += 1) {
          const cluster = sorted.slice(start, start + length);
          const gapsAreReasonable = cluster.slice(1).every((word, index) => {
            const previous = cluster[index];
            const gap = word.box.x - (previous.box.x + previous.box.width);
            return gap <= Math.max(35, previous.box.height * 2.5);
          });
          if (!gapsAreReasonable) continue;
          const x = Math.min(...cluster.map((word) => word.box.x));
          const y = Math.min(...cluster.map((word) => word.box.y));
          const maximumX = Math.max(...cluster.map((word) => word.box.x + word.box.width));
          const maximumY = Math.max(...cluster.map((word) => word.box.y + word.box.height));
          const confidences = cluster.map((word) => word.confidence).filter((value): value is number => value !== null);
          runs.push({
            text: cluster.map((word) => word.text).join(" "),
            box: { x, y, width: maximumX - x, height: maximumY - y },
            confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
            source: "ocr",
          });
        }
      }
    }
    return runs;
  }

  async function runOcrInput(
    input: string | HTMLCanvasElement,
    roomPattern: string,
    width: number,
    height: number,
    onProgress: (progress: OcrProgress) => void,
  ): Promise<DetectedLabel[]> {
    const importedModule = await dynamicImport<TesseractModuleNamespace>(TESSERACT_MODULE_URL);
    const tesseract = resolveTesseractModule(importedModule);
    const worker = await tesseract.createWorker("eng", 1, {
      logger: (message) => onProgress({
        status: String(message.status ?? "OCR processing"),
        progress: clamp(Number(message.progress) || 0, 0, 1),
      }),
      errorHandler: (error) => console.error("OCR worker error", error),
    });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "11",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      const result = await worker.recognize(input, {}, { tsv: true });
      const tsv = String(result.data?.tsv ?? "");
      if (!tsv.trim()) return [];
      return labelsFromTextRuns(parseTsv(tsv), roomPattern, width, height);
    } finally {
      await worker.terminate();
    }
  }

  export async function runOcr(
    page: DrawingPage,
    roomPattern: string,
    onProgress: (progress: OcrProgress) => void,
  ): Promise<DetectedLabel[]> {
    return runOcrInput(page.imageDataUrl, roomPattern, page.width, page.height, onProgress);
  }

  export async function imageDataForPage(page: DrawingPage): Promise<ImageData> {
    const image = await loadImage(page.imageDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is not supported by this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, page.width, page.height);
    context.drawImage(image, 0, 0, page.width, page.height);
    return context.getImageData(0, 0, page.width, page.height);
  }

  function mergeDetectedLabels(existing: DetectedLabel[], additions: DetectedLabel[], area: BoundingBox | null): DetectedLabel[] {
    const labels = existing.slice();
    const keys = new Set(labels.map((label) => `${normalizeRoomCode(label.roomCode)}|${Math.round(label.box.x / 8)}|${Math.round(label.box.y / 8)}`));
    for (const label of additions) {
      if (!boundingBoxCenterInsideArea(label.box, area)) continue;
      const key = `${normalizeRoomCode(label.roomCode)}|${Math.round(label.box.x / 8)}|${Math.round(label.box.y / 8)}`;
      if (keys.has(key)) continue;
      keys.add(key);
      labels.push(label);
    }
    return labels;
  }

  function createSuggestedRoom(
    page: DrawingPage,
    displayLabel: string,
    points: Point[],
    source: ShapeSource,
    confidence: number | null,
    label: DetectedLabel | null,
  ): RoomShape {
    const match = label ? suggestRoomMatch(displayLabel) : { room: null, confidence: null, exact: false };
    const room: RoomShape = {
      id: uid("room-shape"),
      displayLabel,
      points,
      source,
      detectionConfidence: confidence,
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

  export async function analysePage(
    page: DrawingPage,
    settings: RecognitionSettings,
    onProgress: (message: string, progress?: number) => void,
  ): Promise<AnalysisSummary> {
    let labels = page.labels.slice();
    const analysisArea = page.analysisArea ?? null;
    const canUseLayers = settings.usePdfLayers
      && page.sourceType === "pdf"
      && hasRegisteredPdfSource(page.pdfSourceKey)
      && page.selectedAreaLayerIds.length > 0;

    if (canUseLayers && page.selectedLabelLayerIds.length > 0) {
      onProgress("Reading room labels from the selected PDF text layer…", 0);
      const labelCanvas = await renderPdfLayers(page, page.selectedLabelLayerIds);
      const layerLabels = await runOcrInput(labelCanvas, settings.roomPattern, labelCanvas.width, labelCanvas.height, (progress) => {
        onProgress(`${progress.status} · ${Math.round(progress.progress * 100)}%`, progress.progress * 0.32);
      });
      labels = mergeDetectedLabels(labels, layerLabels, analysisArea);
      page.labels = labels;
    } else if (settings.forceOcr || labels.length === 0) {
      onProgress("Reading room labels with OCR…", 0);
      const ocrLabels = await runOcr(page, settings.roomPattern, (progress) => {
        onProgress(`${progress.status} · ${Math.round(progress.progress * 100)}%`, progress.progress * 0.32);
      });
      labels = mergeDetectedLabels(labels, ocrLabels, analysisArea);
      page.labels = labels;
    }

    const labelsForAnalysis = labels.filter((label) => boundingBoxCenterInsideArea(label.box, analysisArea));
    let colourRegions: VectorRegion[] = [];
    let vectorRegions: VectorRegion[] = [];
    if (settings.useColourRegions) {
      onProgress("Detecting connected coloured room regions…", 0.34);
      colourRegions = await detectColourRegions(page, settings.colourTolerance, settings.colourSaturationFloor);
    }
    if (!colourRegions.length && canUseLayers) {
      onProgress("No colour regions found; trying selected PDF area layers…", 0.46);
      vectorRegions = await detectPdfVectorRegions(page);
    }

    let roomsSuggested = 0;
    let vectorRoomsSuggested = 0;
    let colourRoomsSuggested = 0;
    let unlabelledRegionsSuggested = 0;
    let boundariesFailed = 0;
    let exactMatches = 0;
    let fuzzyMatches = 0;
    const imageData = settings.createBoundarySuggestions ? await imageDataForPage(page) : null;
    const usedColourRegionIds = new Set<string>();
    const usedVectorRegionIds = new Set<string>();

    for (let index = 0; index < labelsForAnalysis.length; index += 1) {
      const label = labelsForAnalysis[index];
      onProgress(`Matching ${label.roomCode} · ${index + 1} of ${labelsForAnalysis.length}`, 0.52 + (labelsForAnalysis.length ? index / labelsForAnalysis.length * 0.34 : 0.34));
      const existingRoom = page.rooms.find((room) => normalizeRoomCode(room.displayLabel) === normalizeRoomCode(label.roomCode));
      if (existingRoom) {
        label.consumedByRoomId = existingRoom.id;
        continue;
      }

      const match = suggestRoomMatch(label.roomCode);
      if (match.exact) exactMatches += 1;
      else if (match.room) fuzzyMatches += 1;

      const colourRegion = vectorRegionForLabel(label, page, colourRegions.filter((region) => !usedColourRegionIds.has(region.id)));
      const vectorRegion = colourRegion ? null : vectorRegionForLabel(label, page, vectorRegions.filter((region) => !usedVectorRegionIds.has(region.id)));
      let points: Point[] | null = null;
      let source: ShapeSource = "automatic";
      let confidence: number | null = null;
      if (colourRegion) {
        points = colourRegion.points;
        source = "colour-region";
        confidence = colourRegion.confidence;
        usedColourRegionIds.add(colourRegion.id);
        colourRoomsSuggested += 1;
      } else if (vectorRegion) {
        points = vectorRegion.points;
        source = "pdf-vector";
        confidence = vectorRegion.confidence;
        usedVectorRegionIds.add(vectorRegion.id);
        vectorRoomsSuggested += 1;
      } else if (settings.createBoundarySuggestions && imageData) {
        const boundary = detectBoxBoundary(imageData, label, settings.darkThreshold);
        if (boundary) {
          points = boundary.points;
          confidence = boundary.confidence;
        }
      }

      if (!points) {
        boundariesFailed += 1;
        continue;
      }
      createSuggestedRoom(page, label.roomCode, points, source, confidence, label);
      roomsSuggested += 1;
    }

    const unusedColourRegions = colourRegions.filter((region) => !usedColourRegionIds.has(region.id));
    for (let index = 0; index < unusedColourRegions.length; index += 1) {
      const region = unusedColourRegions[index];
      const duplicate = page.rooms.some((room) => {
        const left = polygonCentroid(room.points);
        const right = polygonCentroid(region.points);
        return Math.hypot(left.x - right.x, left.y - right.y) < 0.015;
      });
      if (duplicate) continue;
      createSuggestedRoom(
        page,
        `UNASSIGNED ${String(index + 1).padStart(3, "0")}`,
        region.points,
        "colour-region",
        region.confidence,
        null,
      );
      roomsSuggested += 1;
      colourRoomsSuggested += 1;
      unlabelledRegionsSuggested += 1;
    }

    onProgress("Analysis complete", 1);
    return {
      labelsFound: labelsForAnalysis.length,
      roomsSuggested,
      boundariesFailed,
      exactMatches,
      fuzzyMatches,
      vectorRegionsFound: vectorRegions.length,
      vectorRoomsSuggested,
      colourRegionsFound: colourRegions.length,
      colourRoomsSuggested,
      unlabelledRegionsSuggested,
    };
  }
}
