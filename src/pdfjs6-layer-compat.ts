namespace ICPDrawingLab {
  interface PdfOptionalContentConfigIteratorLike extends PdfOptionalContentConfigLike {
    [Symbol.iterator]?: () => IterableIterator<[string, PdfOptionalContentGroupLike]>;
  }

  interface PdfDocumentProxyPrototypeLike {
    __icpLayerIntentPatched?: boolean;
    getOptionalContentConfig(options?: { intent?: string }): Promise<PdfOptionalContentConfigLike>;
  }

  interface PdfJsModuleWithDocumentProxy extends PdfJsModule {
    PDFDocumentProxy?: {
      prototype: PdfDocumentProxyPrototypeLike;
    };
  }

  function installLayerEnumeration(config: PdfOptionalContentConfigLike | null): PdfOptionalContentConfigLike | null {
    if (!config) return null;
    const compatible = config as PdfOptionalContentConfigIteratorLike;
    if (typeof compatible.getGroups === "function") return compatible;
    if (typeof compatible[Symbol.iterator] !== "function") return compatible;

    const getGroups = function (this: PdfOptionalContentConfigIteratorLike): Record<string, PdfOptionalContentGroupLike> {
      return Object.fromEntries(Array.from(this as Iterable<[string, PdfOptionalContentGroupLike]>));
    };

    const prototype = Object.getPrototypeOf(compatible) as PdfOptionalContentConfigIteratorLike | null;
    try {
      if (prototype && typeof prototype.getGroups !== "function") {
        Object.defineProperty(prototype, "getGroups", {
          configurable: true,
          value: getGroups,
          writable: true,
        });
      }
    } catch (error) {
      console.warn("Could not add PDF layer enumeration to the shared prototype.", error);
    }

    if (typeof compatible.getGroups !== "function") {
      Object.defineProperty(compatible, "getGroups", {
        configurable: true,
        value: getGroups,
        writable: true,
      });
    }
    return compatible;
  }

  const originalPdfLayerInfos = pdfLayerInfos;
  const globalNamespace = (globalThis as typeof globalThis & {
    ICPDrawingLab?: {
      pdfLayerInfos?: typeof pdfLayerInfos;
    };
  }).ICPDrawingLab;

  if (globalNamespace) {
    globalNamespace.pdfLayerInfos = (config) => originalPdfLayerInfos(installLayerEnumeration(config));
  }

  async function patchPdfDocumentLayerIntent(): Promise<void> {
    const moduleValue = await getPdfModule() as PdfJsModuleWithDocumentProxy;
    const prototype = moduleValue.PDFDocumentProxy?.prototype;
    if (!prototype || prototype.__icpLayerIntentPatched) return;

    const originalGetOptionalContentConfig = prototype.getOptionalContentConfig;
    prototype.getOptionalContentConfig = function (
      this: PdfDocumentProxyPrototypeLike,
      options: { intent?: string } = {},
    ): Promise<PdfOptionalContentConfigLike> {
      const compatibleOptions = options.intent === "any"
        ? { ...options, intent: "display" }
        : options;
      return originalGetOptionalContentConfig.call(this, compatibleOptions)
        .then((config) => installLayerEnumeration(config) ?? config);
    };
    prototype.__icpLayerIntentPatched = true;
  }

  void patchPdfDocumentLayerIntent().catch((error) => {
    console.warn("Could not align the PDF.js optional-content render intent.", error);
  });
}
