namespace ICPDrawingLab {
  export const PDF_JS_VERSION = "6.1.200";
  export const TESSERACT_VERSION = "7";
  export const MAX_RENDER_EDGE = 2400;

  export function assertElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Required element not found: ${selector}`);
    }
    return element;
  }

  export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  export function round(value: number, decimals = 5): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  export function deepClone<T>(value: T): T {
    return structuredClone(value);
  }

  export function uid(prefix: string): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  export function escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  export function downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  export function safeFileName(value: string): string {
    return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "drawing-project";
  }

  export function readFileAsText(file: File): Promise<string> {
    return file.text();
  }

  export function readFileAsDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }

  export function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The drawing image could not be loaded."));
      image.src = source;
    });
  }

  export async function rasterizeImage(source: string, maximumEdge = MAX_RENDER_EDGE): Promise<{
    dataUrl: string;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
  }> {
    const image = await loadImage(source);
    const naturalWidth = Math.max(1, image.naturalWidth || image.width);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height);
    const scale = Math.min(1, maximumEdge / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is not supported by this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png"), width, height, canvas };
  }

  export function dynamicImport<T>(url: string): Promise<T> {
    const importer = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<T>;
    return importer(url);
  }

  export function percentage(progress: ProgressData): number {
    if (!Number.isFinite(progress.total) || progress.total <= 0) return 0;
    return clamp(Math.round((progress.completed / progress.total) * 100), 0, 100);
  }

  export function nowIso(): string {
    return new Date().toISOString();
  }

  export function setStatus(message: string, tone: "normal" | "success" | "warning" | "error" = "normal"): void {
    const status = document.querySelector<HTMLElement>("#statusMessage");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  export function debounce<TArgs extends unknown[]>(callback: (...args: TArgs) => void, delayMs: number): (...args: TArgs) => void {
    let timer = 0;
    return (...args: TArgs) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delayMs);
    };
  }
}
