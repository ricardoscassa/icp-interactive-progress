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

  export type LabelSource = "pdf-text" | "svg-text" | "ocr" | "manual";
  export type ShapeSource = "automatic" | "manual";
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
  }

  export interface PdfTextItemLike {
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }

  export interface PdfTextContentLike {
    items?: PdfTextItemLike[];
  }

  export interface PdfViewportLike {
    width: number;
    height: number;
    transform: number[];
  }

  export interface PdfPageLike {
    getViewport(options: { scale: number }): PdfViewportLike;
    render(options: {
      canvasContext: CanvasRenderingContext2D;
      viewport: PdfViewportLike;
      background?: string;
    }): { promise: Promise<void> };
    getTextContent(): Promise<PdfTextContentLike>;
  }

  export interface PdfDocumentLike {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageLike>;
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
