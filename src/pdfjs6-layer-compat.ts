namespace ICPDrawingLab {
  interface PdfOptionalContentConfigIteratorLike extends PdfOptionalContentConfigLike {
    [Symbol.iterator]?: () => IterableIterator<[string, PdfOptionalContentGroupLike]>;
  }

  interface PdfPageRenderPrototypeLike extends PdfPageLike {
    __icpLayerIntentPatched?: boolean;
  }

  interface PdfJsModuleWithPageProxy extends PdfJsModule {
    PDFPageProxy?: {
      prototype: PdfPageRenderPrototypeLike;
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

  async function patchPdfPageRenderIntent(): Promise<void> {
    const moduleValue = await getPdfModule() as PdfJsModuleWithPageProxy;
    const prototype = moduleValue.PDFPageProxy?.prototype;
    if (!prototype || prototype.__icpLayerIntentPatched) return;

    const originalRender = prototype.render;
    prototype.render = function (
      options: Parameters<PdfPageLike["render"]>[0] & { intent?: string },
    ): ReturnType<PdfPageLike["render"]> {
      const compatibleOptions = options.optionalContentConfigPromise && !options.intent
        ? { ...options, intent: "any" }
        : options;
      return originalRender.call(this, compatibleOptions);
    } as PdfPageLike["render"];
    prototype.__icpLayerIntentPatched = true;
  }

  void patchPdfPageRenderIntent().catch((error) => {
    console.warn("Could not patch the PDF.js layer render intent.", error);
  });
}
