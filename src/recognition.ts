namespace ICPDrawingLab {
  const TESSERACT_MODULE_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;

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
    const words: Array<{
      lineKey: string;
      text: string;
      confidence: number | null;
      box: BoundingBox;
    }> = [];
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

    const runs: TextRun[] = words.map((word) => ({
      text: word.text,
      box: word.box,
      confidence: word.confidence,
      source: "ocr",
    }));

    for (const group of groups.values()) {
      const sorted = group.slice().sort((left, right) => left.box.x - right.box.x);
      for (let start = 0; start < sorted.length; start += 1) {
        for (let length = 2; length <= 4 && start + length <= sorted.length; length += 1) {
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

  export async function runOcr(
    page: DrawingPage,
    roomPattern: string,
    onProgress: (progress: OcrProgress) => void,
  ): Promise<DetectedLabel[]> {
    const tesseract = await dynamicImport<TesseractModule>(TESSERACT_MODULE_URL);
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
      const result = await worker.recognize(page.imageDataUrl, {}, { tsv: true });
      const tsv = String(result.data?.tsv ?? "");
      if (!tsv.trim()) return [];
      return labelsFromTextRuns(parseTsv(tsv), roomPattern, page.width, page.height);
    } finally {
      await worker.terminate();
    }
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

  export async function analysePage(
    page: DrawingPage,
    settings: RecognitionSettings,
    onProgress: (message: string, progress?: number) => void,
  ): Promise<AnalysisSummary> {
    let labels = page.labels.slice();
    if (settings.forceOcr || labels.length === 0) {
      onProgress("Starting OCR. The first run downloads the OCR model…", 0);
      const ocrLabels = await runOcr(page, settings.roomPattern, (progress) => {
        onProgress(`${progress.status} · ${Math.round(progress.progress * 100)}%`, progress.progress);
      });
      const existingKeys = new Set(labels.map((label) => `${normalizeRoomCode(label.roomCode)}|${Math.round(label.box.x / 8)}|${Math.round(label.box.y / 8)}`));
      labels = labels.concat(ocrLabels.filter((label) => {
        const key = `${normalizeRoomCode(label.roomCode)}|${Math.round(label.box.x / 8)}|${Math.round(label.box.y / 8)}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      }));
      page.labels = labels;
    }

    let roomsSuggested = 0;
    let boundariesFailed = 0;
    let exactMatches = 0;
    let fuzzyMatches = 0;
    const imageData = settings.createBoundarySuggestions ? await imageDataForPage(page) : null;

    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      onProgress(`Analysing ${label.roomCode} · ${index + 1} of ${labels.length}`, labels.length ? index / labels.length : 1);
      const existingRoom = page.rooms.find((room) => normalizeRoomCode(room.displayLabel) === normalizeRoomCode(label.roomCode));
      if (existingRoom) {
        label.consumedByRoomId = existingRoom.id;
        continue;
      }

      const match = suggestRoomMatch(label.roomCode);
      if (match.exact) exactMatches += 1;
      else if (match.room) fuzzyMatches += 1;
      if (!settings.createBoundarySuggestions || !imageData) continue;
      const boundary = detectBoxBoundary(imageData, label, settings.darkThreshold);
      if (!boundary) {
        boundariesFailed += 1;
        continue;
      }

      const room: RoomShape = {
        id: uid("room-shape"),
        displayLabel: label.roomCode,
        points: boundary.points,
        source: "automatic",
        detectionConfidence: boundary.confidence,
        detectedLabelId: label.id,
        suggestedRoomId: match.room?.id ?? null,
        linkedRoomId: null,
        matchConfidence: match.confidence,
        reviewStatus: "unreviewed",
        progress: fakeProgressForRoom(label.roomCode),
      };
      page.rooms.push(room);
      label.consumedByRoomId = room.id;
      roomsSuggested += 1;
    }

    onProgress("Analysis complete", 1);
    return { labelsFound: labels.length, roomsSuggested, boundariesFailed, exactMatches, fuzzyMatches };
  }
}
