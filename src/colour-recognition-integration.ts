namespace ICPDrawingLab {
  const analysePageBeforeColourDefaults = analysePage;

  type AnalysePageFunction = typeof analysePage;

  const analysePageWithColourDefaults: AnalysePageFunction = (
    page,
    settings,
    onProgress,
  ) => analysePageBeforeColourDefaults(page, {
    useColourRegions: true,
    colourTolerance: 58,
    colourSaturationFloor: 0.14,
    ...settings,
  }, onProgress);

  (ICPDrawingLab as unknown as { analysePage: AnalysePageFunction }).analysePage = analysePageWithColourDefaults;
}
