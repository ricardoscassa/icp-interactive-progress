namespace ICPDrawingLab {
  interface PdfOptionalContentConfigIteratorLike extends PdfOptionalContentConfigLike {
    [Symbol.iterator]?: () => IterableIterator<[string, PdfOptionalContentGroupLike]>;
  }

  interface PdfDocumentCompatibilityState extends PdfDocumentLike {
    __icpPdfJs6CompatibilityInstalled?: boolean;
  }

  interface PdfPageCompatibilityState extends PdfPageLike {
    __icpPdfJs6CompatibilityInstalled?: boolean;
  }

  interface PdfModuleCompatibilityState extends PdfJsModule {
    __icpPdfJs6CompatibilityInstalled?: boolean;
  }

  function addLegacyLayerEnumeration(config: PdfOptionalContentConfigLike): PdfOptionalContentConfigLike {
    const compatible = config as PdfOptionalContentConfigIteratorLike;
    if (typeof compatible.getGroups === "function") return compatible;
    if (typeof compatible[Symbol.iterator] !== "function") return compatible;

    const iterable = compatible as Iterable<[string, PdfOptionalContentGroupLike]>;
    compatible.getGroups = () => Object.fromEntries(Array.from(iterable));
    return compatible;
  }

  function makePageRenderIntentCompatible(page: PdfPageLike): PdfPageLike {
    const compatible = page as PdfPageCompatibilityState;
    if (compatible.__icpPdfJs6CompatibilityInstalled) return compatible;

    const originalRender = compatible.render.bind(compatible);
    compatible.render = ((options: Parameters<PdfPageLike["render"]>[0] & { intent?: string }) => {
      const renderOptions = options.optionalContentConfigPromise && !options.intent
        ? { ...options, intent: "any" }
        : options;
      return originalRender(renderOptions);
    }) as PdfPageLike["render"];
    compatible.__icpPdfJs6CompatibilityInstalled = true;
    return compatible;
  }

  function makeDocumentLayerCompatible(documentValue: PdfDocumentLike): PdfDocumentLike {
    const compatible = documentValue as PdfDocumentCompatibilityState;
    if (compatible.__icpPdfJs6CompatibilityInstalled) return compatible;

    const originalOptionalContentConfig = compatible.getOptionalContentConfig?.bind(compatible);
    if (originalOptionalContentConfig) {
      compatible.getOptionalContentConfig = async (options) => addLegacyLayerEnumeration(
        await originalOptionalContentConfig(options),
      );
    }

    const originalGetPage = compatible.getPage.bind(compatible);
    compatible.getPage = async (pageNumber) => makePageRenderIntentCompatible(
      await originalGetPage(pageNumber),
    );

    compatible.__icpPdfJs6CompatibilityInstalled = true;
    return compatible;
  }

  async function installPdfJs6LayerCompatibility(): Promise<void> {
    const moduleValue = await getPdfModule() as PdfModuleCompatibilityState;
    if (moduleValue.__icpPdfJs6CompatibilityInstalled) return;

    const originalGetDocument = moduleValue.getDocument.bind(moduleValue);
    moduleValue.getDocument = (options) => {
      const loadingTask = originalGetDocument(options);
      loadingTask.promise = loadingTask.promise.then(makeDocumentLayerCompatible);
      return loadingTask;
    };
    moduleValue.__icpPdfJs6CompatibilityInstalled = true;
  }

  void installPdfJs6LayerCompatibility().catch((error) => {
    console.error("Could not install PDF.js 6 layer compatibility.", error);
  });
}
