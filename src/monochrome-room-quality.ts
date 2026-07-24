namespace ICPDrawingLab {
  export interface RoomGeometryQuality {
    areaPixels: number;
    areaRatio: number;
    shortSidePixels: number;
    aspectRatio: number;
    compactness: number;
    clearancePixels: number;
    score: number;
  }

  function roomPixelPoints(page: DrawingPage, points: Point[]): PixelPoint[] {
    return points.map((point) => ({
      x: point.x * page.width,
      y: point.y * page.height,
    }));
  }

  function roomPolygonAreaPixels(points: PixelPoint[]): number {
    let signed = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      signed += current.x * next.y - next.x * current.y;
    }
    return Math.abs(signed) / 2;
  }

  function roomPolygonPerimeterPixels(points: PixelPoint[]): number {
    let perimeter = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      perimeter += Math.hypot(next.x - current.x, next.y - current.y);
    }
    return perimeter;
  }

  function roomPixelBounds(points: PixelPoint[]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  } {
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  function pointInsidePixelPolygon(point: PixelPoint, polygon: PixelPoint[]): boolean {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const current = polygon[index];
      const before = polygon[previous];
      const intersects = current.y > point.y !== before.y > point.y
        && point.x < ((before.x - current.x) * (point.y - current.y))
          / ((before.y - current.y) || Number.EPSILON) + current.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function distanceToPixelSegment(point: PixelPoint, start: PixelPoint, end: PixelPoint): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const factor = clamp(
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
      0,
      1,
    );
    return Math.hypot(
      point.x - (start.x + factor * dx),
      point.y - (start.y + factor * dy),
    );
  }

  function distanceToPixelPolygon(point: PixelPoint, polygon: PixelPoint[]): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < polygon.length; index += 1) {
      nearest = Math.min(
        nearest,
        distanceToPixelSegment(point, polygon[index], polygon[(index + 1) % polygon.length]),
      );
    }
    return Number.isFinite(nearest) ? nearest : 0;
  }

  function estimatedInteriorClearance(points: PixelPoint[]): number {
    if (points.length < 3) return 0;
    const bounds = roomPixelBounds(points);
    const shortest = Math.min(bounds.width, bounds.height);
    const step = clamp(shortest / 14, 3, 18);
    let maximum = 0;

    const evaluate = (point: PixelPoint): void => {
      if (!pointInsidePixelPolygon(point, points)) return;
      maximum = Math.max(maximum, distanceToPixelPolygon(point, points));
    };

    for (let y = bounds.minY + step / 2; y < bounds.maxY; y += step) {
      for (let x = bounds.minX + step / 2; x < bounds.maxX; x += step) {
        evaluate({ x, y });
      }
    }

    const normalized = points.map((point) => ({ x: point.x, y: point.y }));
    evaluate(polygonCentroid(normalized));
    return maximum;
  }

  export function assessRoomGeometry(page: DrawingPage, points: Point[]): RoomGeometryQuality {
    if (points.length < 3) {
      return {
        areaPixels: 0,
        areaRatio: 0,
        shortSidePixels: 0,
        aspectRatio: Number.POSITIVE_INFINITY,
        compactness: 0,
        clearancePixels: 0,
        score: 0,
      };
    }

    const pixelPoints = roomPixelPoints(page, points);
    const bounds = roomPixelBounds(pixelPoints);
    const areaPixels = roomPolygonAreaPixels(pixelPoints);
    const pageArea = Math.max(1, page.width * page.height);
    const perimeter = roomPolygonPerimeterPixels(pixelPoints);
    const compactness = perimeter > 0
      ? clamp(4 * Math.PI * areaPixels / (perimeter * perimeter), 0, 1)
      : 0;
    const shortSidePixels = Math.min(bounds.width, bounds.height);
    const aspectRatio = Math.max(bounds.width, bounds.height) / Math.max(1, shortSidePixels);
    const clearancePixels = estimatedInteriorClearance(pixelPoints);
    const minimumPageDimension = Math.max(1, Math.min(page.width, page.height));

    const areaScore = clamp(areaPixels / (pageArea * 0.02), 0, 1);
    const clearanceScore = clamp(clearancePixels / (minimumPageDimension * 0.045), 0, 1);
    const shortSideScore = clamp(shortSidePixels / (minimumPageDimension * 0.08), 0, 1);
    const aspectScore = clamp((12 - aspectRatio) / 10, 0, 1);
    const compactnessScore = clamp(compactness / 0.55, 0, 1);
    const score = round(
      areaScore * 0.24
      + clearanceScore * 0.28
      + shortSideScore * 0.18
      + aspectScore * 0.14
      + compactnessScore * 0.16,
      3,
    );

    return {
      areaPixels,
      areaRatio: areaPixels / pageArea,
      shortSidePixels,
      aspectRatio,
      compactness,
      clearancePixels,
      score,
    };
  }

  export function selectPlausibleUnassignedRooms(
    page: DrawingPage,
    rooms: RoomShape[],
  ): { kept: RoomShape[]; rejected: RoomShape[] } {
    if (!rooms.length) return { kept: [], rejected: [] };
    const assessed = rooms.map((room) => ({ room, quality: assessRoomGeometry(page, room.points) }));
    const largestArea = Math.max(...assessed.map(({ quality }) => quality.areaPixels), 1);
    const pageArea = Math.max(1, page.width * page.height);
    const minimumPageDimension = Math.max(1, Math.min(page.width, page.height));
    const adaptiveMinimumArea = Math.max(pageArea * 0.0025, largestArea * 0.04);
    const minimumShortSide = Math.max(14, minimumPageDimension * 0.025);
    const minimumClearance = Math.max(6, minimumPageDimension * 0.012);

    const kept: RoomShape[] = [];
    const rejected: RoomShape[] = [];
    for (const candidate of assessed) {
      const { quality } = candidate;
      const plausible = quality.areaPixels >= adaptiveMinimumArea
        && quality.shortSidePixels >= minimumShortSide
        && quality.clearancePixels >= minimumClearance
        && quality.aspectRatio <= 12
        && quality.score >= 0.6;
      (plausible ? kept : rejected).push(candidate.room);
    }
    return { kept, rejected };
  }
}
