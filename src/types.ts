namespace ICPDrawingLab {
  export interface Point {
    x: number;
    y: number;
  }

  export interface PixelPoint {
    x: number;
    y: number;
  }

  export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface PdfLayerInfo {
    id: string;
    name: string;
    visibleByDefault: boolean;
  }

  export interface VectorRegion {
    id: string;
    points: Point[];
    pixelArea: number;
    confidence: number;
  }

  export type LabelSource = "pdf-text" | "svg-text" | "ocr" | "manual";
  export type ShapeSource = "automatic" | "manual" | "pdf-vector" | "colour-region";
  export type ReviewStatus = "unreviewed" | "accepted" | "rejected" | "manual" | "ignored";
  export type EditorTool = "select" | "draw" | "add-vertex" | "delete-vertex" | "pan" | "analysis-area";

  export interface DetectedLabel {
    id: string;
    rawText: string;
    roomCode: string;
    box: BoundingBox;
    confidence: number | null;
    source: LabelSource;
    consumedByRoomId: string | null;
  }

  export interface RoomRecord {
    id: string;
    code: string;
    name: string;
    building: string;
    level: string;
  }

  export interface ProgressData {
    total: number;
    completed: number;
  }

  export interface RoomShape {
    id: string;
    displayLabel: string;
    points: Point[];
    source: ShapeSource;
    detectionConfidence: number | null;
    detectedLabelId: string | null;
    suggestedRoomId: string | null;
    linkedRoomId: string | null;
    matchConfidence: number | null;
    reviewStatus: ReviewStatus;
    progress: ProgressData;
  }

  export interface DrawingPage {
    id: string;
    name: string;
    sourceType: "pdf" | "image" | "svg" | "sample";
    width: number;
    height: number;
    imageDataUrl: string;
    labels: DetectedLabel[];
    rooms: RoomShape[];
    analysisArea: BoundingBox | null;
    pdfSourceKey: string | null;
    pdfPageNumber: number | null;
    pdfLayers: PdfLayerInfo[];
    selectedAreaLayerIds: string[];
    selectedLabelLayerIds: string[];
  }

  export interface DrawingProject {
    format: "icp-drawing-lab";
    version: 1;
    name: string;
    createdAt: string;
    updatedAt: string;
    activePageId: string;
    pages: DrawingPage[];
  }

  export interface ViewTransform {
    scale: number;
    translateX: number;
    translateY: number;
  }

  export interface RecognitionSettings {
    roomPattern: string;
    forceOcr: boolean;
    createBoundarySuggestions: boolean;
    darkThreshold: number;
    usePdfLayers: boolean;
    useColourRegions?: boolean;
    colourTolerance?: number;
    colourSaturationFloor?: number;
  }

  export interface OcrProgress {
    status: string;
    progress: number;
  }

  export interface AnalysisSummary {
    labelsFound: number;
    roomsSuggested: number;
    boundariesFailed: number;
    exactMatches: number;
    fuzzyMatches: number;
    vectorRegionsFound: number;
    vectorRoomsSuggested: number;
    colourRegionsFound: number;
    colourRoomsSuggested: number;
    unlabelledRegionsSuggested: number;
  }

  export interface PdfTextItemLike {
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
    hasEOL?: boolean;
  }

  export interface PdfTextContentLike {
    items?: PdfTextItemLike[];
  }

  export interface PdfViewportLike {
    width: number;
    height: number;
    transform: number[];
  }

  export interface PdfOptionalContentGroupLike {
    name?: string;
    visible?: boolean;
  }

  export interface PdfOptionalContentConfigLike {
    getGroups?(): Record<string, PdfOptionalContentGroupLike> | null;
    setVisibility?(id: string, visible: boolean, preserveRB?: boolean): void;
  }

  export interface PdfPageLike {
    getViewport(options: { scale: number }): PdfViewportLike;
    render(options: {
      canvasContext: CanvasRenderingContext2D;
      viewport: PdfViewportLike;
      background?: string;
      optionalContentConfigPromise?: Promise<PdfOptionalContentConfigLike>;
    }): { promise: Promise<void> };
    getTextContent(options?: { includeMarkedContent?: boolean }): Promise<PdfTextContentLike>;
  }

  export interface PdfDocumentLike {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageLike>;
    getOptionalContentConfig?(options?: { intent?: string }): Promise<PdfOptionalContentConfigLike>;
    destroy?(): Promise<void>;
  }

  export interface PdfJsModule {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument(options: { data: ArrayBuffer }): { promise: Promise<PdfDocumentLike> };
    Util: {
      transform(left: number[], right: number[]): number[];
    };
  }

  export interface TesseractLoggerMessage {
    status?: string;
    progress?: number;
  }

  export interface TesseractWorkerLike {
    setParameters(parameters: Record<string, string | number>): Promise<void>;
    recognize(
      image: string | HTMLCanvasElement,
      options?: Record<string, unknown>,
      output?: Record<string, boolean>,
    ): Promise<{ data?: { text?: string; tsv?: string | null } }>;
    terminate(): Promise<void>;
  }

  export interface TesseractModule {
    createWorker(
      language?: string,
      oem?: number,
      options?: {
        logger?: (message: TesseractLoggerMessage) => void;
        errorHandler?: (error: unknown) => void;
      },
    ): Promise<TesseractWorkerLike>;
  }

  export interface HistorySnapshot {
    pages: DrawingPage[];
    activePageId: string;
  }
}
