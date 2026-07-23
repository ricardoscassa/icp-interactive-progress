namespace ICPDrawingLab {
  export function normalizedToPixel(point: Point, width: number, height: number): PixelPoint {
    return { x: point.x * width, y: point.y * height };
  }

  export function pixelToNormalized(point: PixelPoint, width: number, height: number): Point {
    return {
      x: round(clamp(point.x / Math.max(1, width), 0, 1)),
      y: round(clamp(point.y / Math.max(1, height), 0, 1)),
    };
  }

  export function polygonCentroid(points: Point[]): Point {
    if (!points.length) return { x: 0.5, y: 0.5 };
    let signedArea = 0;
    let centroidX = 0;
    let centroidY = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const cross = current.x * next.y - next.x * current.y;
      signedArea += cross;
      centroidX += (current.x + next.x) * cross;
      centroidY += (current.y + next.y) * cross;
    }
    signedArea *= 0.5;
    if (Math.abs(signedArea) < 1e-8) {
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      };
    }
    return {
      x: centroidX / (6 * signedArea),
      y: centroidY / (6 * signedArea),
    };
  }

  export function pointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const currentPoint = polygon[index];
      const previousPoint = polygon[previous];
      const intersects = currentPoint.y > point.y !== previousPoint.y > point.y
        && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y))
          / ((previousPoint.y - currentPoint.y) || Number.EPSILON) + currentPoint.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  export function distanceToSegment(point: Point, start: Point, end: Point): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    const projection = { x: start.x + t * dx, y: start.y + t * dy };
    return Math.hypot(point.x - projection.x, point.y - projection.y);
  }

  export function nearestSegmentIndex(point: Point, polygon: Point[]): number {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    polygon.forEach((start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      const distance = distanceToSegment(point, start, end);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  export function insertVertex(points: Point[], point: Point): Point[] {
    if (points.length < 2) return [...points, point];
    const index = nearestSegmentIndex(point, points);
    return [...points.slice(0, index + 1), point, ...points.slice(index + 1)];
  }

  export function translatePolygon(points: Point[], delta: Point): Point[] {
    const minimumX = Math.min(...points.map((point) => point.x));
    const maximumX = Math.max(...points.map((point) => point.x));
    const minimumY = Math.min(...points.map((point) => point.y));
    const maximumY = Math.max(...points.map((point) => point.y));
    const clampedDeltaX = clamp(delta.x, -minimumX, 1 - maximumX);
    const clampedDeltaY = clamp(delta.y, -minimumY, 1 - maximumY);
    return points.map((point) => ({
      x: round(point.x + clampedDeltaX),
      y: round(point.y + clampedDeltaY),
    }));
  }

  export function pointsToSvg(points: Point[], width: number, height: number): string {
    return points
      .map((point) => {
        const pixel = normalizedToPixel(point, width, height);
        return `${round(pixel.x, 2)},${round(pixel.y, 2)}`;
      })
      .join(" ");
  }

  export function progressFill(progress: ProgressData, status: ReviewStatus): string {
    if (status === "rejected" || status === "ignored") return "rgba(111, 118, 132, 0.22)";
    if (status === "unreviewed") return "rgba(245, 158, 11, 0.28)";
    const value = percentage(progress);
    if (value < 35) return "rgba(220, 68, 55, 0.42)";
    if (value < 70) return "rgba(230, 166, 36, 0.42)";
    return "rgba(35, 151, 91, 0.42)";
  }

  export function progressStroke(progress: ProgressData, status: ReviewStatus): string {
    if (status === "rejected" || status === "ignored") return "#6f7684";
    if (status === "unreviewed") return "#f59e0b";
    const value = percentage(progress);
    if (value < 35) return "#dc4437";
    if (value < 70) return "#d49516";
    return "#178b52";
  }

  export function viewBoxForPoints(points: Point[]): BoundingBox {
    if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  export function buildDarkPixelMap(imageData: ImageData, threshold: number): Uint8Array {
    const map = new Uint8Array(imageData.width * imageData.height);
    for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
      const alpha = imageData.data[offset + 3];
      if (alpha < 30) continue;
      const luminance = imageData.data[offset] * 0.2126
        + imageData.data[offset + 1] * 0.7152
        + imageData.data[offset + 2] * 0.0722;
      map[pixel] = luminance <= threshold ? 1 : 0;
    }
    return map;
  }

  interface WallResult {
    position: number;
    score: number;
  }

  function wallScore(linesWithDark: number, lineCount: number, darkPixels: number, totalPixels: number): number {
    if (!lineCount || !totalPixels) return 0;
    const coverage = linesWithDark / lineCount;
    const ratio = darkPixels / totalPixels;
    if (coverage < 0.34 || ratio < 0.045) return 0;
    return Math.min(1.5, (coverage / 0.34 + ratio / 0.045) / 2);
  }

  function verticalWallScore(map: Uint8Array, width: number, height: number, x: number, y1: number, y2: number): number {
    const lineThickness = 5;
    const half = Math.floor(lineThickness / 2);
    const startY = Math.max(0, Math.round(Math.min(y1, y2)));
    const endY = Math.min(height - 1, Math.round(Math.max(y1, y2)));
    let linesWithDark = 0;
    let darkPixels = 0;
    let totalPixels = 0;
    for (let y = startY; y <= endY; y += 1) {
      let hasDark = false;
      for (let offset = -half; offset <= half; offset += 1) {
        const px = Math.round(x + offset);
        if (px < 0 || px >= width) continue;
        totalPixels += 1;
        if (map[y * width + px]) {
          darkPixels += 1;
          hasDark = true;
        }
      }
      if (hasDark) linesWithDark += 1;
    }
    return wallScore(linesWithDark, endY - startY + 1, darkPixels, totalPixels);
  }

  function horizontalWallScore(map: Uint8Array, width: number, height: number, y: number, x1: number, x2: number): number {
    const lineThickness = 5;
    const half = Math.floor(lineThickness / 2);
    const startX = Math.max(0, Math.round(Math.min(x1, x2)));
    const endX = Math.min(width - 1, Math.round(Math.max(x1, x2)));
    let linesWithDark = 0;
    let darkPixels = 0;
    let totalPixels = 0;
    for (let x = startX; x <= endX; x += 1) {
      let hasDark = false;
      for (let offset = -half; offset <= half; offset += 1) {
        const py = Math.round(y + offset);
        if (py < 0 || py >= height) continue;
        totalPixels += 1;
        if (map[py * width + x]) {
          darkPixels += 1;
          hasDark = true;
        }
      }
      if (hasDark) linesWithDark += 1;
    }
    return wallScore(linesWithDark, endX - startX + 1, darkPixels, totalPixels);
  }

  function findVerticalWall(
    map: Uint8Array,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
    direction: -1 | 1,
    minimumDistance: number,
    maximumDistance: number,
    topLimit?: number,
    bottomLimit?: number,
  ): WallResult | null {
    const bandHalf = Math.min(120, Math.max(45, height * 0.07));
    const y1 = topLimit === undefined ? centerY - bandHalf : topLimit + 5;
    const y2 = bottomLimit === undefined ? centerY + bandHalf : bottomLimit - 5;
    for (let distance = minimumDistance; distance <= maximumDistance; distance += 2) {
      const x = centerX + direction * distance;
      if (x <= 2 || x >= width - 3) break;
      const score = verticalWallScore(map, width, height, x, y1, y2);
      if (score >= 1) return { position: x, score };
    }
    return null;
  }

  function findHorizontalWall(
    map: Uint8Array,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
    direction: -1 | 1,
    minimumDistance: number,
    maximumDistance: number,
    leftLimit?: number,
    rightLimit?: number,
  ): WallResult | null {
    const bandHalf = Math.min(150, Math.max(45, width * 0.07));
    const x1 = leftLimit === undefined ? centerX - bandHalf : leftLimit + 5;
    const x2 = rightLimit === undefined ? centerX + bandHalf : rightLimit - 5;
    for (let distance = minimumDistance; distance <= maximumDistance; distance += 2) {
      const y = centerY + direction * distance;
      if (y <= 2 || y >= height - 3) break;
      const score = horizontalWallScore(map, width, height, y, x1, x2);
      if (score >= 1) return { position: y, score };
    }
    return null;
  }

  export function detectBoxBoundary(
    imageData: ImageData,
    label: DetectedLabel,
    threshold: number,
  ): { points: Point[]; confidence: number } | null {
    const width = imageData.width;
    const height = imageData.height;
    const map = buildDarkPixelMap(imageData, threshold);
    const centerX = clamp(Math.round(label.box.x + label.box.width / 2), 0, width - 1);
    const centerY = clamp(Math.round(label.box.y + label.box.height / 2), 0, height - 1);
    const minimumDistance = Math.max(18, Math.round(Math.max(label.box.width, label.box.height) * 0.72));
    const maximumX = Math.max(minimumDistance + 10, Math.round(width * 0.42));
    const maximumY = Math.max(minimumDistance + 10, Math.round(height * 0.42));

    let left = findVerticalWall(map, width, height, centerX, centerY, -1, minimumDistance, maximumX);
    let right = findVerticalWall(map, width, height, centerX, centerY, 1, minimumDistance, maximumX);
    let top: WallResult | null = null;
    let bottom: WallResult | null = null;

    if (left && right) {
      top = findHorizontalWall(map, width, height, centerX, centerY, -1, minimumDistance, maximumY, left.position, right.position);
      bottom = findHorizontalWall(map, width, height, centerX, centerY, 1, minimumDistance, maximumY, left.position, right.position);
    }
    if ((!left || !right) && (!top || !bottom)) {
      top = top ?? findHorizontalWall(map, width, height, centerX, centerY, -1, minimumDistance, maximumY);
      bottom = bottom ?? findHorizontalWall(map, width, height, centerX, centerY, 1, minimumDistance, maximumY);
      if (top && bottom) {
        left = left ?? findVerticalWall(map, width, height, centerX, centerY, -1, minimumDistance, maximumX, top.position, bottom.position);
        right = right ?? findVerticalWall(map, width, height, centerX, centerY, 1, minimumDistance, maximumX, top.position, bottom.position);
      }
    }

    if (!left || !right || !top || !bottom) return null;
    if (right.position - left.position < 30 || bottom.position - top.position < 30) return null;
    if (centerX <= left.position || centerX >= right.position || centerY <= top.position || centerY >= bottom.position) return null;

    const confidence = round(clamp((left.score + right.score + top.score + bottom.score) / 6, 0, 1), 2);
    return {
      confidence,
      points: [
        pixelToNormalized({ x: left.position, y: top.position }, width, height),
        pixelToNormalized({ x: right.position, y: top.position }, width, height),
        pixelToNormalized({ x: right.position, y: bottom.position }, width, height),
        pixelToNormalized({ x: left.position, y: bottom.position }, width, height),
      ],
    };
  }
  export function boundingBoxCenterInsideArea(box: BoundingBox, area: BoundingBox | null): boolean {
    if (!area) return true;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    return centerX >= area.x
      && centerX <= area.x + area.width
      && centerY >= area.y
      && centerY <= area.y + area.height;
  }

}
