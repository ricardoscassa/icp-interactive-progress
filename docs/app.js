"use strict";
var ICPDrawingLab;
(function (ICPDrawingLab) {
    ICPDrawingLab.PDF_JS_VERSION = "6.1.200";
    ICPDrawingLab.TESSERACT_VERSION = "7";
    ICPDrawingLab.MAX_RENDER_EDGE = 2400;
    function assertElement(selector) {
        const element = document.querySelector(selector);
        if (!element) {
            throw new Error(`Required element not found: ${selector}`);
        }
        return element;
    }
    ICPDrawingLab.assertElement = assertElement;
    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }
    ICPDrawingLab.clamp = clamp;
    function round(value, decimals = 5) {
        const factor = 10 ** decimals;
        return Math.round(value * factor) / factor;
    }
    ICPDrawingLab.round = round;
    function deepClone(value) {
        return structuredClone(value);
    }
    ICPDrawingLab.deepClone = deepClone;
    function uid(prefix) {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return `${prefix}-${crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    ICPDrawingLab.uid = uid;
    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }
    ICPDrawingLab.escapeHtml = escapeHtml;
    function downloadBlob(filename, blob) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    ICPDrawingLab.downloadBlob = downloadBlob;
    function safeFileName(value) {
        return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "drawing-project";
    }
    ICPDrawingLab.safeFileName = safeFileName;
    function readFileAsText(file) {
        return file.text();
    }
    ICPDrawingLab.readFileAsText = readFileAsText;
    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file."));
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(file);
        });
    }
    ICPDrawingLab.readFileAsDataUrl = readFileAsDataUrl;
    function loadImage(source) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.decoding = "async";
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("The drawing image could not be loaded."));
            image.src = source;
        });
    }
    ICPDrawingLab.loadImage = loadImage;
    async function rasterizeImage(source, maximumEdge = ICPDrawingLab.MAX_RENDER_EDGE) {
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
        if (!context)
            throw new Error("Canvas is not supported by this browser.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        return { dataUrl: canvas.toDataURL("image/png"), width, height, canvas };
    }
    ICPDrawingLab.rasterizeImage = rasterizeImage;
    function dynamicImport(url) {
        const importer = new Function("moduleUrl", "return import(moduleUrl);");
        return importer(url);
    }
    ICPDrawingLab.dynamicImport = dynamicImport;
    function percentage(progress) {
        if (!Number.isFinite(progress.total) || progress.total <= 0)
            return 0;
        return clamp(Math.round((progress.completed / progress.total) * 100), 0, 100);
    }
    ICPDrawingLab.percentage = percentage;
    function nowIso() {
        return new Date().toISOString();
    }
    ICPDrawingLab.nowIso = nowIso;
    function setStatus(message, tone = "normal") {
        const status = document.querySelector("#statusMessage");
        if (!status)
            return;
        status.textContent = message;
        status.dataset.tone = tone;
    }
    ICPDrawingLab.setStatus = setStatus;
    function debounce(callback, delayMs) {
        let timer = 0;
        return (...args) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => callback(...args), delayMs);
        };
    }
    ICPDrawingLab.debounce = debounce;
})(ICPDrawingLab || (ICPDrawingLab = {}));
var ICPDrawingLab;
(function (ICPDrawingLab) {
    function normalizedToPixel(point, width, height) {
        return { x: point.x * width, y: point.y * height };
    }
    ICPDrawingLab.normalizedToPixel = normalizedToPixel;
    function pixelToNormalized(point, width, height) {
        return {
            x: ICPDrawingLab.round(ICPDrawingLab.clamp(point.x / Math.max(1, width), 0, 1)),
            y: ICPDrawingLab.round(ICPDrawingLab.clamp(point.y / Math.max(1, height), 0, 1)),
        };
    }
    ICPDrawingLab.pixelToNormalized = pixelToNormalized;
    function polygonCentroid(points) {
        if (!points.length)
            return { x: 0.5, y: 0.5 };
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
    ICPDrawingLab.polygonCentroid = polygonCentroid;
    function pointInPolygon(point, polygon) {
        let inside = false;
        for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
            const currentPoint = polygon[index];
            const previousPoint = polygon[previous];
            const intersects = currentPoint.y > point.y !== previousPoint.y > point.y
                && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y))
                    / ((previousPoint.y - currentPoint.y) || Number.EPSILON) + currentPoint.x;
            if (intersects)
                inside = !inside;
        }
        return inside;
    }
    ICPDrawingLab.pointInPolygon = pointInPolygon;
    function distanceToSegment(point, start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (dx === 0 && dy === 0)
            return Math.hypot(point.x - start.x, point.y - start.y);
        const t = ICPDrawingLab.clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
        const projection = { x: start.x + t * dx, y: start.y + t * dy };
        return Math.hypot(point.x - projection.x, point.y - projection.y);
    }
    ICPDrawingLab.distanceToSegment = distanceToSegment;
    function nearestSegmentIndex(point, polygon) {
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
    ICPDrawingLab.nearestSegmentIndex = nearestSegmentIndex;
    function insertVertex(points, point) {
        if (points.length < 2)
            return [...points, point];
        const index = nearestSegmentIndex(point, points);
        return [...points.slice(0, index + 1), point, ...points.slice(index + 1)];
    }
    ICPDrawingLab.insertVertex = insertVertex;
    function translatePolygon(points, delta) {
        const minimumX = Math.min(...points.map((point) => point.x));
        const maximumX = Math.max(...points.map((point) => point.x));
        const minimumY = Math.min(...points.map((point) => point.y));
        const maximumY = Math.max(...points.map((point) => point.y));
        const clampedDeltaX = ICPDrawingLab.clamp(delta.x, -minimumX, 1 - maximumX);
        const clampedDeltaY = ICPDrawingLab.clamp(delta.y, -minimumY, 1 - maximumY);
        return points.map((point) => ({
            x: ICPDrawingLab.round(point.x + clampedDeltaX),
            y: ICPDrawingLab.round(point.y + clampedDeltaY),
        }));
    }
    ICPDrawingLab.translatePolygon = translatePolygon;
    function pointsToSvg(points, width, height) {
        return points
            .map((point) => {
            const pixel = normalizedToPixel(point, width, height);
            return `${ICPDrawingLab.round(pixel.x, 2)},${ICPDrawingLab.round(pixel.y, 2)}`;
        })
            .join(" ");
    }
    ICPDrawingLab.pointsToSvg = pointsToSvg;
    function progressFill(progress, status) {
        if (status === "rejected" || status === "ignored")
            return "rgba(111, 118, 132, 0.22)";
        if (status === "unreviewed")
            return "rgba(245, 158, 11, 0.28)";
        const value = ICPDrawingLab.percentage(progress);
        if (value < 35)
            return "rgba(220, 68, 55, 0.42)";
        if (value < 70)
            return "rgba(230, 166, 36, 0.42)";
        return "rgba(35, 151, 91, 0.42)";
    }
    ICPDrawingLab.progressFill = progressFill;
    function progressStroke(progress, status) {
        if (status === "rejected" || status === "ignored")
            return "#6f7684";
        if (status === "unreviewed")
            return "#f59e0b";
        const value = ICPDrawingLab.percentage(progress);
        if (value < 35)
            return "#dc4437";
        if (value < 70)
            return "#d49516";
        return "#178b52";
    }
    ICPDrawingLab.progressStroke = progressStroke;
    function viewBoxForPoints(points) {
        if (!points.length)
            return { x: 0, y: 0, width: 0, height: 0 };
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    ICPDrawingLab.viewBoxForPoints = viewBoxForPoints;
    function buildDarkPixelMap(imageData, threshold) {
        const map = new Uint8Array(imageData.width * imageData.height);
        for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
            const alpha = imageData.data[offset + 3];
            if (alpha < 30)
                continue;
            const luminance = imageData.data[offset] * 0.2126
                + imageData.data[offset + 1] * 0.7152
                + imageData.data[offset + 2] * 0.0722;
            map[pixel] = luminance <= threshold ? 1 : 0;
        }
        return map;
    }
    ICPDrawingLab.buildDarkPixelMap = buildDarkPixelMap;
    function wallScore(linesWithDark, lineCount, darkPixels, totalPixels) {
        if (!lineCount || !totalPixels)
            return 0;
        const coverage = linesWithDark / lineCount;
        const ratio = darkPixels / totalPixels;
        if (coverage < 0.34 || ratio < 0.045)
            return 0;
        return Math.min(1.5, (coverage / 0.34 + ratio / 0.045) / 2);
    }
    function verticalWallScore(map, width, height, x, y1, y2) {
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
                if (px < 0 || px >= width)
                    continue;
                totalPixels += 1;
                if (map[y * width + px]) {
                    darkPixels += 1;
                    hasDark = true;
                }
            }
            if (hasDark)
                linesWithDark += 1;
        }
        return wallScore(linesWithDark, endY - startY + 1, darkPixels, totalPixels);
    }
    function horizontalWallScore(map, width, height, y, x1, x2) {
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
                if (py < 0 || py >= height)
                    continue;
                totalPixels += 1;
                if (map[py * width + x]) {
                    darkPixels += 1;
                    hasDark = true;
                }
            }
            if (hasDark)
                linesWithDark += 1;
        }
        return wallScore(linesWithDark, endX - startX + 1, darkPixels, totalPixels);
    }
    function findVerticalWall(map, width, height, centerX, centerY, direction, minimumDistance, maximumDistance, topLimit, bottomLimit) {
        const bandHalf = Math.min(120, Math.max(45, height * 0.07));
        const y1 = topLimit === undefined ? centerY - bandHalf : topLimit + 5;
        const y2 = bottomLimit === undefined ? centerY + bandHalf : bottomLimit - 5;
        for (let distance = minimumDistance; distance <= maximumDistance; distance += 2) {
            const x = centerX + direction * distance;
            if (x <= 2 || x >= width - 3)
                break;
            const score = verticalWallScore(map, width, height, x, y1, y2);
            if (score >= 1)
                return { position: x, score };
        }
        return null;
    }
    function findHorizontalWall(map, width, height, centerX, centerY, direction, minimumDistance, maximumDistance, leftLimit, rightLimit) {
        const bandHalf = Math.min(150, Math.max(45, width * 0.07));
        const x1 = leftLimit === undefined ? centerX - bandHalf : leftLimit + 5;
        const x2 = rightLimit === undefined ? centerX + bandHalf : rightLimit - 5;
        for (let distance = minimumDistance; distance <= maximumDistance; distance += 2) {
            const y = centerY + direction * distance;
            if (y <= 2 || y >= height - 3)
                break;
            const score = horizontalWallScore(map, width, height, y, x1, x2);
            if (score >= 1)
                return { position: y, score };
        }
        return null;
    }
    function detectBoxBoundary(imageData, label, threshold) {
        const width = imageData.width;
        const height = imageData.height;
        const map = buildDarkPixelMap(imageData, threshold);
        const centerX = ICPDrawingLab.clamp(Math.round(label.box.x + label.box.width / 2), 0, width - 1);
        const centerY = ICPDrawingLab.clamp(Math.round(label.box.y + label.box.height / 2), 0, height - 1);
        const minimumDistance = Math.max(18, Math.round(Math.max(label.box.width, label.box.height) * 0.72));
        const maximumX = Math.max(minimumDistance + 10, Math.round(width * 0.42));
        const maximumY = Math.max(minimumDistance + 10, Math.round(height * 0.42));
        let left = findVerticalWall(map, width, height, centerX, centerY, -1, minimumDistance, maximumX);
        let right = findVerticalWall(map, width, height, centerX, centerY, 1, minimumDistance, maximumX);
        let top = null;
        let bottom = null;
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
        if (!left || !right || !top || !bottom)
            return null;
        if (right.position - left.position < 30 || bottom.position - top.position < 30)
            return null;
        if (centerX <= left.position || centerX >= right.position || centerY <= top.position || centerY >= bottom.position)
            return null;
        const confidence = ICPDrawingLab.round(ICPDrawingLab.clamp((left.score + right.score + top.score + bottom.score) / 6, 0, 1), 2);
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
    ICPDrawingLab.detectBoxBoundary = detectBoxBoundary;
})(ICPDrawingLab || (ICPDrawingLab = {}));
var ICPDrawingLab;
(function (ICPDrawingLab) {
    ICPDrawingLab.DEFAULT_ROOM_PATTERN = String.raw `\b(?:ROOM\s*)?([A-Z]{0,4}[-_ ]?\d{2,4}[A-Z]?|[A-Z0-9]{1,6}[-_]\d{2,4}[A-Z]?|[A-Z0-9]*ZL[-_ ]*[A-Z0-9-]+)\b`;
    ICPDrawingLab.FAKE_ROOM_DATABASE = [
        { id: "room-101", code: "101", name: "Electrical Switch Room", building: "1A", level: "L01" },
        { id: "room-102", code: "102", name: "Control Equipment Room", building: "1A", level: "L01" },
        { id: "room-103", code: "103", name: "Mechanical Services Room", building: "1A", level: "L01" },
        { id: "room-104", code: "104", name: "Cable Transit Room", building: "1A", level: "L01" },
        { id: "room-105", code: "105", name: "Valve Gallery", building: "1A", level: "L01" },
        { id: "room-106", code: "106", name: "Instrumentation Room", building: "1A", level: "L01" },
        { id: "room-107", code: "107", name: "Access Lobby", building: "1A", level: "L01" },
        { id: "room-108", code: "108", name: "Pump Room", building: "1A", level: "L01" },
        { id: "room-zl201", code: "ZL-201", name: "Zone Logistics 201", building: "1A", level: "L02" },
        { id: "room-1a201", code: "1A-201", name: "Main Distribution Room", building: "1A", level: "L02" },
    ];
    function normalizeRoomCode(value) {
        return value.toUpperCase().replace(/\bROOM\b/g, "").replace(/[^A-Z0-9]/g, "").trim();
    }
    ICPDrawingLab.normalizeRoomCode = normalizeRoomCode;
    function compileRoomPattern(pattern) {
        try {
            return new RegExp(pattern, "gi");
        }
        catch (error) {
            throw new Error(`Room label pattern is invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    ICPDrawingLab.compileRoomPattern = compileRoomPattern;
    function extractRoomCodes(text, pattern) {
        const regex = compileRoomPattern(pattern);
        const values = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const candidate = String(match[1] ?? match[0] ?? "").trim();
            if (candidate)
                values.push(candidate);
            if (match.index === regex.lastIndex)
                regex.lastIndex += 1;
        }
        return [...new Set(values)];
    }
    ICPDrawingLab.extractRoomCodes = extractRoomCodes;
    function levenshtein(left, right) {
        if (left === right)
            return 0;
        if (!left.length)
            return right.length;
        if (!right.length)
            return left.length;
        const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
        const current = new Array(right.length + 1);
        for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
            current[0] = leftIndex;
            for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
                const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
                current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + cost);
            }
            for (let index = 0; index < current.length; index += 1)
                previous[index] = current[index];
        }
        return previous[right.length];
    }
    function scoreRoomMatch(label, room) {
        const normalizedLabel = normalizeRoomCode(label);
        const normalizedCode = normalizeRoomCode(room.code);
        if (!normalizedLabel || !normalizedCode)
            return 0;
        if (normalizedLabel === normalizedCode)
            return 1;
        if (normalizedLabel.endsWith(normalizedCode) || normalizedCode.endsWith(normalizedLabel))
            return 0.9;
        const distance = levenshtein(normalizedLabel, normalizedCode);
        const maximumLength = Math.max(normalizedLabel.length, normalizedCode.length);
        const similarity = 1 - distance / maximumLength;
        return ICPDrawingLab.round(similarity, 2);
    }
    ICPDrawingLab.scoreRoomMatch = scoreRoomMatch;
    function suggestRoomMatch(label, rooms = ICPDrawingLab.FAKE_ROOM_DATABASE) {
        const ranked = rooms
            .map((room) => ({ room, score: scoreRoomMatch(label, room) }))
            .sort((left, right) => right.score - left.score);
        const best = ranked[0];
        if (!best || best.score < 0.62)
            return { room: null, confidence: null, exact: false };
        return { room: best.room, confidence: best.score, exact: best.score === 1 };
    }
    ICPDrawingLab.suggestRoomMatch = suggestRoomMatch;
    function fakeProgressForRoom(code) {
        const seed = [...normalizeRoomCode(code)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
        const total = 20 + (seed % 51);
        const completed = Math.round(total * ((seed % 87) / 100));
        return { total, completed };
    }
    ICPDrawingLab.fakeProgressForRoom = fakeProgressForRoom;
})(ICPDrawingLab || (ICPDrawingLab = {}));
var ICPDrawingLab;
(function (ICPDrawingLab) {
    const TESSERACT_MODULE_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${ICPDrawingLab.TESSERACT_VERSION}/dist/tesseract.esm.min.js`;
    function intersectingBoxForCode(run, fullText, roomCode) {
        const normalizedFull = fullText.trim();
        if (!normalizedFull || normalizedFull === roomCode)
            return run.box;
        const index = normalizedFull.toUpperCase().indexOf(roomCode.toUpperCase());
        if (index < 0)
            return run.box;
        const characterWidth = run.box.width / Math.max(1, normalizedFull.length);
        return {
            x: run.box.x + index * characterWidth,
            y: run.box.y,
            width: Math.max(8, roomCode.length * characterWidth),
            height: run.box.height,
        };
    }
    function labelsFromTextRuns(runs, roomPattern, pageWidth, pageHeight) {
        const labels = [];
        const seen = new Set();
        for (const run of runs) {
            for (const roomCode of ICPDrawingLab.extractRoomCodes(run.text, roomPattern)) {
                const box = intersectingBoxForCode(run, run.text, roomCode);
                const clampedBox = {
                    x: ICPDrawingLab.clamp(box.x, 0, pageWidth),
                    y: ICPDrawingLab.clamp(box.y, 0, pageHeight),
                    width: ICPDrawingLab.clamp(box.width, 1, pageWidth),
                    height: ICPDrawingLab.clamp(box.height, 1, pageHeight),
                };
                const key = `${ICPDrawingLab.normalizeRoomCode(roomCode)}|${Math.round(clampedBox.x / 8)}|${Math.round(clampedBox.y / 8)}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                labels.push({
                    id: ICPDrawingLab.uid("label"),
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
    ICPDrawingLab.labelsFromTextRuns = labelsFromTextRuns;
    function parseTsv(tsv) {
        const rows = tsv.split(/\r?\n/).slice(1);
        const words = [];
        for (const row of rows) {
            if (!row.trim())
                continue;
            const columns = row.split("\t");
            if (columns.length < 12)
                continue;
            const level = Number(columns[0]);
            const text = columns.slice(11).join("\t").trim();
            if (level !== 5 || !text)
                continue;
            const left = Number(columns[6]);
            const top = Number(columns[7]);
            const width = Number(columns[8]);
            const height = Number(columns[9]);
            const confidenceValue = Number(columns[10]);
            if (![left, top, width, height].every(Number.isFinite))
                continue;
            words.push({
                lineKey: `${columns[1]}-${columns[2]}-${columns[3]}-${columns[4]}`,
                text,
                confidence: Number.isFinite(confidenceValue) ? confidenceValue / 100 : null,
                box: { x: left, y: top, width, height },
            });
        }
        const groups = new Map();
        for (const word of words) {
            const group = groups.get(word.lineKey) ?? [];
            group.push(word);
            groups.set(word.lineKey, group);
        }
        const runs = words.map((word) => ({
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
                    if (!gapsAreReasonable)
                        continue;
                    const x = Math.min(...cluster.map((word) => word.box.x));
                    const y = Math.min(...cluster.map((word) => word.box.y));
                    const maximumX = Math.max(...cluster.map((word) => word.box.x + word.box.width));
                    const maximumY = Math.max(...cluster.map((word) => word.box.y + word.box.height));
                    const confidences = cluster.map((word) => word.confidence).filter((value) => value !== null);
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
    async function runOcr(page, roomPattern, onProgress) {
        const tesseract = await ICPDrawingLab.dynamicImport(TESSERACT_MODULE_URL);
        const worker = await tesseract.createWorker("eng", 1, {
            logger: (message) => onProgress({
                status: String(message.status ?? "OCR processing"),
                progress: ICPDrawingLab.clamp(Number(message.progress) || 0, 0, 1),
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
            if (!tsv.trim())
                return [];
            return labelsFromTextRuns(parseTsv(tsv), roomPattern, page.width, page.height);
        }
        finally {
            await worker.terminate();
        }
    }
    ICPDrawingLab.runOcr = runOcr;
    async function imageDataForPage(page) {
        const image = await ICPDrawingLab.loadImage(page.imageDataUrl);
        const canvas = document.createElement("canvas");
        canvas.width = page.width;
        canvas.height = page.height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context)
            throw new Error("Canvas is not supported by this browser.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, page.width, page.height);
        context.drawImage(image, 0, 0, page.width, page.height);
        return context.getImageData(0, 0, page.width, page.height);
    }
    ICPDrawingLab.imageDataForPage = imageDataForPage;
    async function analysePage(page, settings, onProgress) {
        let labels = page.labels.slice();
        if (settings.forceOcr || labels.length === 0) {
            onProgress("Starting OCR. The first run downloads the OCR model…", 0);
            const ocrLabels = await runOcr(page, settings.roomPattern, (progress) => {
                onProgress(`${progress.status} · ${Math.round(progress.progress * 100)}%`, progress.progress);
            });
            const existingKeys = new Set(labels.map((label) => `${ICPDrawingLab.normalizeRoomCode(label.roomCode)}|${Math.round(label.box.x / 8)}|${Math.round(label.box.y / 8)}`));
            labels = labels.concat(ocrLabels.filter((label) => {
                const key = `${ICPDrawingLab.normalizeRoomCode(label.roomCode)}|${Math.round(label.box.x / 8)}|${Math.round(label.box.y / 8)}`;
                if (existingKeys.has(key))
                    return false;
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
            const existingRoom = page.rooms.find((room) => ICPDrawingLab.normalizeRoomCode(room.displayLabel) === ICPDrawingLab.normalizeRoomCode(label.roomCode));
            if (existingRoom) {
                label.consumedByRoomId = existingRoom.id;
                continue;
            }
            const match = ICPDrawingLab.suggestRoomMatch(label.roomCode);
            if (match.exact)
                exactMatches += 1;
            else if (match.room)
                fuzzyMatches += 1;
            if (!settings.createBoundarySuggestions || !imageData)
                continue;
            const boundary = ICPDrawingLab.detectBoxBoundary(imageData, label, settings.darkThreshold);
            if (!boundary) {
                boundariesFailed += 1;
                continue;
            }
            const room = {
                id: ICPDrawingLab.uid("room-shape"),
                displayLabel: label.roomCode,
                points: boundary.points,
                source: "automatic",
                detectionConfidence: boundary.confidence,
                detectedLabelId: label.id,
                suggestedRoomId: match.room?.id ?? null,
                linkedRoomId: null,
                matchConfidence: match.confidence,
                reviewStatus: "unreviewed",
                progress: ICPDrawingLab.fakeProgressForRoom(label.roomCode),
            };
            page.rooms.push(room);
            label.consumedByRoomId = room.id;
            roomsSuggested += 1;
        }
        onProgress("Analysis complete", 1);
        return { labelsFound: labels.length, roomsSuggested, boundariesFailed, exactMatches, fuzzyMatches };
    }
    ICPDrawingLab.analysePage = analysePage;
})(ICPDrawingLab || (ICPDrawingLab = {}));
var ICPDrawingLab;
(function (ICPDrawingLab) {
    const PDF_MODULE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ICPDrawingLab.PDF_JS_VERSION}/build/pdf.min.mjs`;
    const PDF_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ICPDrawingLab.PDF_JS_VERSION}/build/pdf.worker.min.mjs`;
    let pdfModulePromise = null;
    async function getPdfModule() {
        if (!pdfModulePromise) {
            pdfModulePromise = ICPDrawingLab.dynamicImport(PDF_MODULE_URL).then((module) => {
                module.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
                return module;
            });
        }
        return pdfModulePromise;
    }
    function pdfRenderScale(width, height) {
        const longestEdge = Math.max(width, height) || ICPDrawingLab.MAX_RENDER_EDGE;
        return Math.min(3, ICPDrawingLab.MAX_RENDER_EDGE / longestEdge);
    }
    function textRunsFromPdf(textContent, viewport, pdfjs) {
        const runs = [];
        for (const item of textContent.items ?? []) {
            const text = String(item.str ?? "").trim();
            const transform = item.transform;
            if (!text || !Array.isArray(transform) || transform.length < 6)
                continue;
            const transformed = pdfjs.Util.transform(viewport.transform, transform);
            const fontHeight = Math.max(7, Math.abs(Number(item.height) || transformed[3] || 0));
            const width = Math.max(text.length * fontHeight * 0.42, Math.abs(Number(item.width) || 0));
            runs.push({
                text,
                box: {
                    x: transformed[4],
                    y: transformed[5] - fontHeight,
                    width,
                    height: fontHeight,
                },
                confidence: null,
                source: "pdf-text",
            });
        }
        return runs;
    }
    async function loadPdfFile(file, roomPattern, onProgress) {
        const pdfjs = await getPdfModule();
        const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages = [];
        const baseName = file.name.replace(/\.[^.]+$/, "");
        try {
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
                onProgress(`Rendering PDF page ${pageNumber} of ${pdf.numPages}…`);
                const page = await pdf.getPage(pageNumber);
                const baseViewport = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: pdfRenderScale(baseViewport.width, baseViewport.height) });
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.ceil(viewport.width));
                canvas.height = Math.max(1, Math.ceil(viewport.height));
                const context = canvas.getContext("2d", { alpha: false });
                if (!context)
                    throw new Error("Canvas is not supported by this browser.");
                context.fillStyle = "#ffffff";
                context.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: context, viewport, background: "white" }).promise;
                let labels = [];
                try {
                    const textContent = await page.getTextContent();
                    labels = ICPDrawingLab.labelsFromTextRuns(textRunsFromPdf(textContent, viewport, pdfjs), roomPattern, canvas.width, canvas.height);
                }
                catch (error) {
                    console.warn(`Could not extract text from PDF page ${pageNumber}.`, error);
                }
                pages.push({
                    id: ICPDrawingLab.uid("page"),
                    name: pdf.numPages > 1 ? `${baseName} · Page ${pageNumber}` : baseName,
                    sourceType: "pdf",
                    width: canvas.width,
                    height: canvas.height,
                    imageDataUrl: canvas.toDataURL("image/png"),
                    labels,
                    rooms: [],
                });
            }
        }
        finally {
            if (typeof pdf.destroy === "function")
                await pdf.destroy();
        }
        return pages;
    }
    ICPDrawingLab.loadPdfFile = loadPdfFile;
    function sanitizeSvg(svgText) {
        const parser = new DOMParser();
        const documentValue = parser.parseFromString(svgText, "image/svg+xml");
        if (documentValue.querySelector("parsererror"))
            throw new Error("The SVG file is not valid XML.");
        documentValue.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
        documentValue.querySelectorAll("*").forEach((node) => {
            for (const attribute of Array.from(node.attributes)) {
                const name = attribute.name.toLowerCase();
                const value = attribute.value.trim();
                if (name.startsWith("on"))
                    node.removeAttribute(attribute.name);
                if ((name === "href" || name === "xlink:href") && /^(?:https?:|javascript:|data:text\/html)/i.test(value)) {
                    node.removeAttribute(attribute.name);
                }
            }
        });
        return new XMLSerializer().serializeToString(documentValue.documentElement);
    }
    function svgTextRuns(svgText, targetWidth, targetHeight) {
        const parser = new DOMParser();
        const documentValue = parser.parseFromString(svgText, "image/svg+xml");
        const root = documentValue.documentElement;
        const viewBox = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
        const svgWidth = viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : Number(root.getAttribute("width")) || targetWidth;
        const svgHeight = viewBox.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : Number(root.getAttribute("height")) || targetHeight;
        const offsetX = viewBox.length === 4 && Number.isFinite(viewBox[0]) ? viewBox[0] : 0;
        const offsetY = viewBox.length === 4 && Number.isFinite(viewBox[1]) ? viewBox[1] : 0;
        const scaleX = targetWidth / Math.max(1, svgWidth);
        const scaleY = targetHeight / Math.max(1, svgHeight);
        const runs = [];
        for (const element of Array.from(documentValue.querySelectorAll("text"))) {
            const text = String(element.textContent ?? "").trim();
            const x = Number((element.getAttribute("x") ?? "0").split(/[\s,]+/)[0]);
            const y = Number((element.getAttribute("y") ?? "0").split(/[\s,]+/)[0]);
            const fontSize = Number(element.getAttribute("font-size")) || 18;
            if (!text || !Number.isFinite(x) || !Number.isFinite(y))
                continue;
            runs.push({
                text,
                box: {
                    x: (x - offsetX) * scaleX,
                    y: (y - offsetY - fontSize) * scaleY,
                    width: Math.max(fontSize * 0.5 * text.length * scaleX, 8),
                    height: Math.max(fontSize * scaleY, 8),
                },
                confidence: null,
                source: "svg-text",
            });
        }
        return runs;
    }
    async function loadImageFile(file, roomPattern) {
        const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
        if (isSvg) {
            const sanitized = sanitizeSvg(await file.text());
            const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
            const rasterized = await ICPDrawingLab.rasterizeImage(source);
            return [{
                    id: ICPDrawingLab.uid("page"),
                    name: file.name.replace(/\.[^.]+$/, ""),
                    sourceType: "svg",
                    width: rasterized.width,
                    height: rasterized.height,
                    imageDataUrl: rasterized.dataUrl,
                    labels: ICPDrawingLab.labelsFromTextRuns(svgTextRuns(sanitized, rasterized.width, rasterized.height), roomPattern, rasterized.width, rasterized.height),
                    rooms: [],
                }];
        }
        const source = await ICPDrawingLab.readFileAsDataUrl(file);
        const rasterized = await ICPDrawingLab.rasterizeImage(source);
        return [{
                id: ICPDrawingLab.uid("page"),
                name: file.name.replace(/\.[^.]+$/, ""),
                sourceType: "image",
                width: rasterized.width,
                height: rasterized.height,
                imageDataUrl: rasterized.dataUrl,
                labels: [],
                rooms: [],
            }];
    }
    ICPDrawingLab.loadImageFile = loadImageFile;
    async function loadDrawingFiles(files, roomPattern, onProgress) {
        const pages = [];
        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            onProgress(`Loading ${index + 1} of ${files.length}: ${file.name}`);
            const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
            if (isPdf) {
                pages.push(...await loadPdfFile(file, roomPattern, onProgress));
            }
            else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
                pages.push(...await loadImageFile(file, roomPattern));
            }
            else {
                throw new Error(`Unsupported drawing type: ${file.name}`);
            }
        }
        return pages;
    }
    ICPDrawingLab.loadDrawingFiles = loadDrawingFiles;
    async function loadSamplePage(roomPattern) {
        const response = await fetch("./sample-floor.svg", { cache: "no-store" });
        if (!response.ok)
            throw new Error("The bundled sample drawing could not be loaded.");
        const svgText = await response.text();
        const sanitized = sanitizeSvg(svgText);
        const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
        const rasterized = await ICPDrawingLab.rasterizeImage(source);
        return {
            id: ICPDrawingLab.uid("page"),
            name: "Sample · Building 1A · Level 01",
            sourceType: "sample",
            width: rasterized.width,
            height: rasterized.height,
            imageDataUrl: rasterized.dataUrl,
            labels: ICPDrawingLab.labelsFromTextRuns(svgTextRuns(sanitized, rasterized.width, rasterized.height), roomPattern, rasterized.width, rasterized.height),
            rooms: [],
        };
    }
    ICPDrawingLab.loadSamplePage = loadSamplePage;
})(ICPDrawingLab || (ICPDrawingLab = {}));
var ICPDrawingLab;
(function (ICPDrawingLab) {
    class EditorStore {
        project;
        selectedRoomId = null;
        selectedLabelId = null;
        tool = "select";
        draftPoints = [];
        draftLabel = "";
        view = { scale: 1, translateX: 0, translateY: 0 };
        listeners = new Set();
        undoStack = [];
        redoStack = [];
        maximumHistory = 80;
        constructor(project) {
            this.project = project ?? EditorStore.emptyProject();
        }
        static emptyProject() {
            const timestamp = ICPDrawingLab.nowIso();
            return {
                format: "icp-drawing-lab",
                version: 1,
                name: "ICP Drawing Recognition Test",
                createdAt: timestamp,
                updatedAt: timestamp,
                activePageId: "",
                pages: [],
            };
        }
        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }
        notify() {
            this.project.updatedAt = ICPDrawingLab.nowIso();
            this.listeners.forEach((listener) => listener());
        }
        get activePage() {
            return this.project.pages.find((page) => page.id === this.project.activePageId) ?? this.project.pages[0] ?? null;
        }
        get selectedRoom() {
            return this.activePage?.rooms.find((room) => room.id === this.selectedRoomId) ?? null;
        }
        get selectedLabel() {
            return this.activePage?.labels.find((label) => label.id === this.selectedLabelId) ?? null;
        }
        replacePages(pages, projectName) {
            this.pushHistory();
            this.project.pages = pages;
            this.project.activePageId = pages[0]?.id ?? "";
            if (projectName)
                this.project.name = projectName;
            this.selectedRoomId = null;
            this.selectedLabelId = null;
            this.draftPoints = [];
            this.view = { scale: 1, translateX: 0, translateY: 0 };
            this.notify();
        }
        setActivePage(pageId) {
            if (!this.project.pages.some((page) => page.id === pageId))
                return;
            this.project.activePageId = pageId;
            this.selectedRoomId = null;
            this.selectedLabelId = null;
            this.draftPoints = [];
            this.view = { scale: 1, translateX: 0, translateY: 0 };
            this.notify();
        }
        setTool(tool) {
            this.tool = tool;
            if (tool !== "draw")
                this.draftPoints = [];
            this.notify();
        }
        selectRoom(roomId) {
            this.selectedRoomId = roomId;
            this.selectedLabelId = null;
            this.notify();
        }
        selectLabel(labelId) {
            this.selectedLabelId = labelId;
            this.selectedRoomId = null;
            const label = this.selectedLabel;
            if (label)
                this.draftLabel = label.roomCode;
            this.notify();
        }
        updateView(partial) {
            this.view = { ...this.view, ...partial };
            this.notify();
        }
        addDraftPoint(point) {
            this.draftPoints.push({ x: ICPDrawingLab.round(point.x), y: ICPDrawingLab.round(point.y) });
            this.notify();
        }
        cancelDraft() {
            this.draftPoints = [];
            this.draftLabel = "";
            this.notify();
        }
        finishDraft(label) {
            const page = this.activePage;
            if (!page || this.draftPoints.length < 3)
                return null;
            this.pushHistory();
            const displayLabel = (label ?? this.draftLabel).trim() || `ROOM-${page.rooms.length + 1}`;
            const match = ICPDrawingLab.suggestRoomMatch(displayLabel);
            const room = {
                id: ICPDrawingLab.uid("room-shape"),
                displayLabel,
                points: ICPDrawingLab.deepClone(this.draftPoints),
                source: "manual",
                detectionConfidence: null,
                detectedLabelId: this.selectedLabelId,
                suggestedRoomId: match.room?.id ?? null,
                linkedRoomId: null,
                matchConfidence: match.confidence,
                reviewStatus: "manual",
                progress: ICPDrawingLab.fakeProgressForRoom(displayLabel),
            };
            page.rooms.push(room);
            if (this.selectedLabel)
                this.selectedLabel.consumedByRoomId = room.id;
            this.draftPoints = [];
            this.draftLabel = "";
            this.selectedLabelId = null;
            this.selectedRoomId = room.id;
            this.tool = "select";
            this.notify();
            return room;
        }
        updateSelectedRoom(mutator, recordHistory = true) {
            const room = this.selectedRoom;
            if (!room)
                return;
            if (recordHistory)
                this.pushHistory();
            mutator(room);
            this.notify();
        }
        updateRoom(roomId, mutator, recordHistory = true) {
            const room = this.activePage?.rooms.find((item) => item.id === roomId);
            if (!room)
                return;
            if (recordHistory)
                this.pushHistory();
            mutator(room);
            this.notify();
        }
        deleteSelectedRoom() {
            const page = this.activePage;
            const room = this.selectedRoom;
            if (!page || !room)
                return;
            this.pushHistory();
            page.rooms = page.rooms.filter((item) => item.id !== room.id);
            page.labels.forEach((label) => {
                if (label.consumedByRoomId === room.id)
                    label.consumedByRoomId = null;
            });
            this.selectedRoomId = null;
            this.notify();
        }
        acceptSelectedRoom(linkedRoomId) {
            const room = this.selectedRoom;
            if (!room)
                return;
            this.pushHistory();
            const targetId = linkedRoomId ?? room.suggestedRoomId;
            room.linkedRoomId = targetId ?? null;
            room.reviewStatus = targetId ? "accepted" : "manual";
            this.notify();
        }
        rejectSelectedRoom() {
            this.updateSelectedRoom((room) => {
                room.linkedRoomId = null;
                room.reviewStatus = "rejected";
            });
        }
        ignoreSelectedLabel() {
            const label = this.selectedLabel;
            if (!label)
                return;
            this.pushHistory();
            label.consumedByRoomId = "ignored";
            this.selectedLabelId = null;
            this.notify();
        }
        startTransaction() {
            return this.captureSnapshot();
        }
        commitTransaction(before) {
            const after = this.captureSnapshot();
            if (JSON.stringify(before) === JSON.stringify(after))
                return;
            this.undoStack.push(before);
            if (this.undoStack.length > this.maximumHistory)
                this.undoStack.shift();
            this.redoStack = [];
            this.notify();
        }
        canUndo() {
            return this.undoStack.length > 0;
        }
        canRedo() {
            return this.redoStack.length > 0;
        }
        undo() {
            const snapshot = this.undoStack.pop();
            if (!snapshot)
                return;
            this.redoStack.push(this.captureSnapshot());
            this.restoreSnapshot(snapshot);
        }
        redo() {
            const snapshot = this.redoStack.pop();
            if (!snapshot)
                return;
            this.undoStack.push(this.captureSnapshot());
            this.restoreSnapshot(snapshot);
        }
        resetHistory() {
            this.undoStack = [];
            this.redoStack = [];
        }
        exportProject() {
            return ICPDrawingLab.deepClone(this.project);
        }
        importProject(project) {
            validateProject(project);
            this.project = ICPDrawingLab.deepClone(project);
            this.selectedRoomId = null;
            this.selectedLabelId = null;
            this.draftPoints = [];
            this.view = { scale: 1, translateX: 0, translateY: 0 };
            this.resetHistory();
            this.notify();
        }
        pushHistory() {
            this.undoStack.push(this.captureSnapshot());
            if (this.undoStack.length > this.maximumHistory)
                this.undoStack.shift();
            this.redoStack = [];
        }
        captureSnapshot() {
            return {
                pages: ICPDrawingLab.deepClone(this.project.pages),
                activePageId: this.project.activePageId,
            };
        }
        restoreSnapshot(snapshot) {
            this.project.pages = ICPDrawingLab.deepClone(snapshot.pages);
            this.project.activePageId = snapshot.activePageId;
            this.selectedRoomId = null;
            this.selectedLabelId = null;
            this.draftPoints = [];
            this.notify();
        }
    }
    ICPDrawingLab.EditorStore = EditorStore;
    function validateProject(value) {
        if (!value || typeof value !== "object")
            throw new Error("The project JSON is not an object.");
        const project = value;
        if (project.format !== "icp-drawing-lab" || project.version !== 1) {
            throw new Error("This is not a supported ICP Drawing Lab project.");
        }
        if (!Array.isArray(project.pages))
            throw new Error("The project does not contain drawing pages.");
        for (const page of project.pages) {
            if (!page || typeof page !== "object" || !Array.isArray(page.rooms) || !Array.isArray(page.labels)) {
                throw new Error("A drawing page in the project is invalid.");
            }
            for (const room of page.rooms) {
                if (!Array.isArray(room.points) || room.points.length < 3) {
                    throw new Error(`Room ${String(room.displayLabel ?? room.id)} has invalid geometry.`);
                }
                if (room.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
                    throw new Error(`Room ${String(room.displayLabel ?? room.id)} contains invalid coordinates.`);
                }
            }
        }
    }
    ICPDrawingLab.validateProject = validateProject;
})(ICPDrawingLab || (ICPDrawingLab = {}));
var ICPDrawingLab;
(function (ICPDrawingLab) {
    class DrawingRenderer {
        store;
        viewport = ICPDrawingLab.assertElement("#stageViewport");
        surface = ICPDrawingLab.assertElement("#stageSurface");
        canvas = ICPDrawingLab.assertElement("#drawingCanvas");
        overlay = ICPDrawingLab.assertElement("#drawingOverlay");
        pageTabs = ICPDrawingLab.assertElement("#pageTabs");
        roomList = ICPDrawingLab.assertElement("#roomList");
        inspector = ICPDrawingLab.assertElement("#inspectorContent");
        analysisSummary = ICPDrawingLab.assertElement("#analysisSummary");
        emptyState = ICPDrawingLab.assertElement("#emptyStage");
        draftLabelInput = ICPDrawingLab.assertElement("#draftRoomLabel");
        finishDraftButton = ICPDrawingLab.assertElement("#finishDraftButton");
        cancelDraftButton = ICPDrawingLab.assertElement("#cancelDraftButton");
        zoomOutput = ICPDrawingLab.assertElement("#zoomOutput");
        undoButton = ICPDrawingLab.assertElement("#undoButton");
        redoButton = ICPDrawingLab.assertElement("#redoButton");
        loadedPageId = null;
        drag = null;
        constructor(store) {
            this.store = store;
            this.bindStageEvents();
            this.bindPanelEvents();
            store.subscribe(() => this.render());
        }
        async render() {
            this.renderToolState();
            this.renderPageTabs();
            this.renderRoomList();
            this.renderInspector();
            this.renderAnalysisSummary();
            this.renderStageGeometry();
            await this.renderDrawingImage();
        }
        fitToViewport() {
            const page = this.store.activePage;
            if (!page)
                return;
            const widthScale = (this.viewport.clientWidth - 32) / page.width;
            const heightScale = (this.viewport.clientHeight - 32) / page.height;
            const scale = ICPDrawingLab.clamp(Math.min(widthScale, heightScale), 0.1, 4);
            const translateX = (this.viewport.clientWidth - page.width * scale) / 2;
            const translateY = (this.viewport.clientHeight - page.height * scale) / 2;
            this.store.updateView({ scale, translateX, translateY });
        }
        zoomBy(factor, anchorClient) {
            const page = this.store.activePage;
            if (!page)
                return;
            const view = this.store.view;
            const nextScale = ICPDrawingLab.clamp(view.scale * factor, 0.08, 8);
            const viewportRect = this.viewport.getBoundingClientRect();
            const anchor = anchorClient ?? {
                x: viewportRect.left + viewportRect.width / 2,
                y: viewportRect.top + viewportRect.height / 2,
            };
            const localX = (anchor.x - viewportRect.left - view.translateX) / view.scale;
            const localY = (anchor.y - viewportRect.top - view.translateY) / view.scale;
            const translateX = anchor.x - viewportRect.left - localX * nextScale;
            const translateY = anchor.y - viewportRect.top - localY * nextScale;
            this.store.updateView({ scale: nextScale, translateX, translateY });
        }
        async renderDrawingImage() {
            const page = this.store.activePage;
            if (!page) {
                this.loadedPageId = null;
                return;
            }
            if (this.loadedPageId === page.id && this.canvas.width === page.width && this.canvas.height === page.height)
                return;
            this.loadedPageId = page.id;
            const image = await ICPDrawingLab.loadImage(page.imageDataUrl);
            this.canvas.width = page.width;
            this.canvas.height = page.height;
            const context = this.canvas.getContext("2d", { alpha: false });
            if (!context)
                throw new Error("Canvas is not supported by this browser.");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, page.width, page.height);
            context.drawImage(image, 0, 0, page.width, page.height);
        }
        renderStageGeometry() {
            const page = this.store.activePage;
            const hasPage = Boolean(page);
            this.emptyState.hidden = hasPage;
            this.surface.hidden = !hasPage;
            if (!page)
                return;
            this.surface.style.width = `${page.width}px`;
            this.surface.style.height = `${page.height}px`;
            this.surface.style.transform = `translate(${this.store.view.translateX}px, ${this.store.view.translateY}px) scale(${this.store.view.scale})`;
            this.canvas.style.width = `${page.width}px`;
            this.canvas.style.height = `${page.height}px`;
            this.overlay.setAttribute("viewBox", `0 0 ${page.width} ${page.height}`);
            this.overlay.setAttribute("width", String(page.width));
            this.overlay.setAttribute("height", String(page.height));
            this.zoomOutput.textContent = `${Math.round(this.store.view.scale * 100)}%`;
            const rooms = page.rooms.map((room) => this.roomSvg(room, page)).join("");
            const labels = page.labels
                .filter((label) => !label.consumedByRoomId)
                .map((label) => this.labelSvg(label))
                .join("");
            const draft = this.draftSvg(page);
            this.overlay.innerHTML = `${rooms}${labels}${draft}`;
        }
        roomSvg(room, page) {
            const selected = room.id === this.store.selectedRoomId;
            const fill = ICPDrawingLab.progressFill(room.progress, room.reviewStatus);
            const stroke = ICPDrawingLab.progressStroke(room.progress, room.reviewStatus);
            const centroid = ICPDrawingLab.normalizedToPixel(ICPDrawingLab.polygonCentroid(room.points), page.width, page.height);
            const label = ICPDrawingLab.escapeHtml(room.displayLabel);
            const percent = ICPDrawingLab.percentage(room.progress);
            const dash = room.reviewStatus === "unreviewed" ? "8 6" : room.reviewStatus === "rejected" ? "4 6" : "";
            const handles = selected
                ? room.points.map((point, index) => {
                    const pixel = ICPDrawingLab.normalizedToPixel(point, page.width, page.height);
                    return `<circle class="vertex-handle" data-room-id="${room.id}" data-vertex-index="${index}" cx="${pixel.x}" cy="${pixel.y}" r="7" />`;
                }).join("")
                : "";
            return `
        <g class="room-shape ${selected ? "is-selected" : ""}" data-room-id="${room.id}">
          <polygon class="room-polygon" data-room-id="${room.id}" points="${ICPDrawingLab.pointsToSvg(room.points, page.width, page.height)}"
            fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 4 : 2.5}" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke" />
          <g class="room-map-label" data-room-id="${room.id}" transform="translate(${centroid.x} ${centroid.y})">
            <rect x="-48" y="-24" width="96" height="48" rx="8" />
            <text class="room-code" text-anchor="middle" y="-4">${label}</text>
            <text class="room-progress" text-anchor="middle" y="15">${percent}%</text>
          </g>
          ${handles}
        </g>`;
        }
        labelSvg(label) {
            const selected = label.id === this.store.selectedLabelId;
            const centerX = label.box.x + label.box.width / 2;
            const centerY = label.box.y + label.box.height / 2;
            return `
        <g class="label-marker ${selected ? "is-selected" : ""}" data-label-id="${label.id}" transform="translate(${centerX} ${centerY})">
          <circle r="11" />
          <line x1="-16" y1="0" x2="16" y2="0" />
          <line x1="0" y1="-16" x2="0" y2="16" />
          <text x="16" y="-10">${ICPDrawingLab.escapeHtml(label.roomCode)}</text>
        </g>`;
        }
        draftSvg(page) {
            if (!this.store.draftPoints.length)
                return "";
            const points = ICPDrawingLab.pointsToSvg(this.store.draftPoints, page.width, page.height);
            const handles = this.store.draftPoints.map((point) => {
                const pixel = ICPDrawingLab.normalizedToPixel(point, page.width, page.height);
                return `<circle class="draft-handle" cx="${pixel.x}" cy="${pixel.y}" r="6" />`;
            }).join("");
            return `<g class="draft-room"><polyline points="${points}" />${handles}</g>`;
        }
        renderToolState() {
            document.querySelectorAll("[data-editor-tool]").forEach((button) => {
                const active = button.dataset.editorTool === this.store.tool;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", String(active));
            });
            this.undoButton.disabled = !this.store.canUndo();
            this.redoButton.disabled = !this.store.canRedo();
            const drawing = this.store.tool === "draw";
            document.body.classList.toggle("is-drawing", drawing);
            this.finishDraftButton.disabled = this.store.draftPoints.length < 3;
            this.cancelDraftButton.disabled = this.store.draftPoints.length === 0;
            if (document.activeElement !== this.draftLabelInput)
                this.draftLabelInput.value = this.store.draftLabel;
        }
        renderPageTabs() {
            this.pageTabs.innerHTML = this.store.project.pages.map((page) => `
        <button type="button" class="page-tab ${page.id === this.store.project.activePageId ? "is-active" : ""}" data-page-id="${page.id}">
          <span>${ICPDrawingLab.escapeHtml(page.name)}</span>
          <small>${page.rooms.length} rooms</small>
        </button>`).join("");
        }
        renderRoomList() {
            const page = this.store.activePage;
            if (!page) {
                this.roomList.innerHTML = `<div class="panel-empty">Upload a plan to start mapping rooms.</div>`;
                return;
            }
            const roomRows = page.rooms.map((room) => {
                const linkedRoom = ICPDrawingLab.FAKE_ROOM_DATABASE.find((item) => item.id === room.linkedRoomId);
                const status = room.reviewStatus.replace("-", " ");
                return `<button type="button" class="room-list-row ${room.id === this.store.selectedRoomId ? "is-active" : ""}" data-select-room="${room.id}">
          <span class="room-list-main"><strong>${ICPDrawingLab.escapeHtml(room.displayLabel)}</strong><small>${ICPDrawingLab.escapeHtml(linkedRoom?.name ?? "Not linked")}</small></span>
          <span class="review-pill" data-status="${room.reviewStatus}">${ICPDrawingLab.escapeHtml(status)}</span>
        </button>`;
            }).join("");
            const unmatchedRows = page.labels.filter((label) => !label.consumedByRoomId).map((label) => `
        <button type="button" class="room-list-row label-row ${label.id === this.store.selectedLabelId ? "is-active" : ""}" data-select-label="${label.id}">
          <span class="room-list-main"><strong>${ICPDrawingLab.escapeHtml(label.roomCode)}</strong><small>${ICPDrawingLab.escapeHtml(label.source)} · no boundary</small></span>
          <span class="review-pill" data-status="unreviewed">label</span>
        </button>`).join("");
            this.roomList.innerHTML = roomRows || unmatchedRows
                ? `${roomRows}${unmatchedRows}`
                : `<div class="panel-empty">No room labels or boundaries yet. Run recognition or draw manually.</div>`;
        }
        renderInspector() {
            const room = this.store.selectedRoom;
            if (room) {
                const options = [`<option value="">Not linked</option>`, ...ICPDrawingLab.FAKE_ROOM_DATABASE.map((item) => `
          <option value="${item.id}" ${item.id === (room.linkedRoomId ?? room.suggestedRoomId) ? "selected" : ""}>
            ${ICPDrawingLab.escapeHtml(item.building)} · ${ICPDrawingLab.escapeHtml(item.level)} · ${ICPDrawingLab.escapeHtml(item.code)} — ${ICPDrawingLab.escapeHtml(item.name)}
          </option>`)].join("");
                const suggested = ICPDrawingLab.FAKE_ROOM_DATABASE.find((item) => item.id === room.suggestedRoomId);
                this.inspector.innerHTML = `
          <div class="inspector-heading">
            <div><span class="eyebrow">Selected room</span><h3>${ICPDrawingLab.escapeHtml(room.displayLabel)}</h3></div>
            <span class="review-pill" data-status="${room.reviewStatus}">${ICPDrawingLab.escapeHtml(room.reviewStatus)}</span>
          </div>
          <label class="field"><span>Displayed label</span><input data-room-field="displayLabel" value="${ICPDrawingLab.escapeHtml(room.displayLabel)}" /></label>
          <label class="field"><span>Linked fake database room</span><select data-room-field="linkedRoomId">${options}</select></label>
          ${suggested ? `<div class="suggestion-card"><span>Automatic suggestion</span><strong>${ICPDrawingLab.escapeHtml(suggested.code)} — ${ICPDrawingLab.escapeHtml(suggested.name)}</strong><small>Match confidence ${Math.round((room.matchConfidence ?? 0) * 100)}%</small></div>` : `<div class="suggestion-card is-muted">No reliable automatic database match.</div>`}
          <div class="button-grid">
            <button type="button" class="button success" data-inspector-action="accept-room">Accept link</button>
            <button type="button" class="button" data-inspector-action="reject-room">Reject</button>
          </div>
          <div class="metric-fields">
            <label class="field"><span>Total scope</span><input type="number" min="0" data-progress-field="total" value="${room.progress.total}" /></label>
            <label class="field"><span>Completed</span><input type="number" min="0" data-progress-field="completed" value="${room.progress.completed}" /></label>
          </div>
          <dl class="metadata-list">
            <div><dt>Progress</dt><dd>${ICPDrawingLab.percentage(room.progress)}%</dd></div>
            <div><dt>Geometry source</dt><dd>${ICPDrawingLab.escapeHtml(room.source)}</dd></div>
            <div><dt>Boundary confidence</dt><dd>${room.detectionConfidence === null ? "—" : `${Math.round(room.detectionConfidence * 100)}%`}</dd></div>
            <div><dt>Vertices</dt><dd>${room.points.length}</dd></div>
          </dl>
          <button type="button" class="button danger full-width" data-inspector-action="delete-room">Delete room geometry</button>`;
                return;
            }
            const label = this.store.selectedLabel;
            if (label) {
                const suggestion = ICPDrawingLab.suggestRoomMatch(label.roomCode);
                this.inspector.innerHTML = `
          <div class="inspector-heading"><div><span class="eyebrow">Unmapped label</span><h3>${ICPDrawingLab.escapeHtml(label.roomCode)}</h3></div><span class="review-pill" data-status="unreviewed">${ICPDrawingLab.escapeHtml(label.source)}</span></div>
          <p class="panel-copy">The label was recognized, but a reliable boundary was not created. Draw around the room and the label will be carried into the new geometry.</p>
          ${suggestion.room ? `<div class="suggestion-card"><span>Suggested database room</span><strong>${ICPDrawingLab.escapeHtml(suggestion.room.code)} — ${ICPDrawingLab.escapeHtml(suggestion.room.name)}</strong><small>${Math.round((suggestion.confidence ?? 0) * 100)}% match</small></div>` : ""}
          <button type="button" class="button primary full-width" data-inspector-action="draw-label">Draw this room</button>
          <button type="button" class="button full-width" data-inspector-action="ignore-label">Ignore label</button>`;
                return;
            }
            this.inspector.innerHTML = `<div class="panel-empty large"><strong>Nothing selected</strong><span>Select a suggested room, an unmatched label, or draw a new polygon.</span></div>`;
        }
        renderAnalysisSummary() {
            const page = this.store.activePage;
            if (!page) {
                this.analysisSummary.innerHTML = `<span>No drawing loaded</span>`;
                return;
            }
            const accepted = page.rooms.filter((room) => room.reviewStatus === "accepted" || room.reviewStatus === "manual").length;
            const review = page.rooms.filter((room) => room.reviewStatus === "unreviewed").length;
            const unmatched = page.labels.filter((label) => !label.consumedByRoomId).length;
            this.analysisSummary.innerHTML = `
        <div><strong>${page.labels.length}</strong><span>labels</span></div>
        <div><strong>${page.rooms.length}</strong><span>boundaries</span></div>
        <div><strong>${accepted}</strong><span>approved</span></div>
        <div><strong>${review + unmatched}</strong><span>to review</span></div>`;
        }
        bindStageEvents() {
            this.overlay.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
            window.addEventListener("pointermove", (event) => this.handlePointerMove(event));
            window.addEventListener("pointerup", () => this.handlePointerUp());
            this.overlay.addEventListener("dblclick", (event) => {
                if (this.store.tool !== "draw")
                    return;
                event.preventDefault();
                this.store.finishDraft(this.draftLabelInput.value);
            });
            this.viewport.addEventListener("wheel", (event) => {
                if (!this.store.activePage)
                    return;
                event.preventDefault();
                this.zoomBy(event.deltaY < 0 ? 1.12 : 0.89, { x: event.clientX, y: event.clientY });
            }, { passive: false });
            this.viewport.addEventListener("pointerdown", (event) => {
                if (event.target !== this.viewport && event.target !== this.surface && event.target !== this.canvas)
                    return;
                if (this.store.tool === "pan" || event.button === 1 || event.altKey) {
                    this.drag = {
                        type: "pan",
                        clientX: event.clientX,
                        clientY: event.clientY,
                        originalX: this.store.view.translateX,
                        originalY: this.store.view.translateY,
                    };
                }
            });
        }
        handlePointerDown(event) {
            const target = event.target;
            const page = this.store.activePage;
            if (!page)
                return;
            if (this.store.tool === "pan" || event.button === 1 || event.altKey) {
                this.drag = {
                    type: "pan",
                    clientX: event.clientX,
                    clientY: event.clientY,
                    originalX: this.store.view.translateX,
                    originalY: this.store.view.translateY,
                };
                return;
            }
            const local = this.eventToNormalized(event);
            if (this.store.tool === "draw") {
                event.preventDefault();
                this.store.addDraftPoint(local);
                return;
            }
            const labelElement = target.closest("[data-label-id]");
            if (labelElement?.dataset.labelId) {
                this.store.selectLabel(labelElement.dataset.labelId);
                return;
            }
            const vertex = target.closest("[data-vertex-index]");
            const roomElement = target.closest("[data-room-id]");
            const roomId = roomElement?.dataset.roomId;
            if (this.store.tool === "delete-vertex" && vertex?.dataset.roomId && vertex.dataset.vertexIndex) {
                const vertexIndex = Number(vertex.dataset.vertexIndex);
                this.store.updateRoom(vertex.dataset.roomId, (room) => {
                    if (room.points.length > 3)
                        room.points.splice(vertexIndex, 1);
                });
                return;
            }
            if (this.store.tool === "add-vertex" && roomId) {
                this.store.selectRoom(roomId);
                this.store.updateRoom(roomId, (room) => {
                    room.points = ICPDrawingLab.insertVertex(room.points, local);
                });
                return;
            }
            if (vertex?.dataset.roomId && vertex.dataset.vertexIndex !== undefined) {
                this.store.selectRoom(vertex.dataset.roomId);
                this.drag = {
                    type: "vertex",
                    roomId: vertex.dataset.roomId,
                    vertexIndex: Number(vertex.dataset.vertexIndex),
                    before: this.store.startTransaction(),
                };
                return;
            }
            if (roomId) {
                this.store.selectRoom(roomId);
                const room = this.store.selectedRoom;
                if (!room)
                    return;
                this.drag = {
                    type: "room",
                    roomId,
                    start: local,
                    originalPoints: ICPDrawingLab.deepClone(room.points),
                    before: this.store.startTransaction(),
                };
                return;
            }
            this.store.selectRoom(null);
        }
        handlePointerMove(event) {
            if (!this.drag)
                return;
            if (this.drag.type === "pan") {
                this.store.updateView({
                    translateX: this.drag.originalX + event.clientX - this.drag.clientX,
                    translateY: this.drag.originalY + event.clientY - this.drag.clientY,
                });
                return;
            }
            const point = this.eventToNormalized(event);
            if (this.drag.type === "vertex") {
                this.store.updateRoom(this.drag.roomId, (room) => {
                    room.points[this.drag && this.drag.type === "vertex" ? this.drag.vertexIndex : 0] = point;
                }, false);
                return;
            }
            const delta = { x: point.x - this.drag.start.x, y: point.y - this.drag.start.y };
            this.store.updateRoom(this.drag.roomId, (room) => {
                room.points = ICPDrawingLab.translatePolygon(this.drag && this.drag.type === "room" ? this.drag.originalPoints : room.points, delta);
            }, false);
        }
        handlePointerUp() {
            if (!this.drag)
                return;
            if (this.drag.type === "vertex" || this.drag.type === "room") {
                this.store.commitTransaction(this.drag.before);
            }
            this.drag = null;
        }
        eventToNormalized(event) {
            const page = this.store.activePage;
            if (!page)
                return { x: 0, y: 0 };
            const rect = this.viewport.getBoundingClientRect();
            const x = (event.clientX - rect.left - this.store.view.translateX) / this.store.view.scale;
            const y = (event.clientY - rect.top - this.store.view.translateY) / this.store.view.scale;
            return ICPDrawingLab.pixelToNormalized({ x, y }, page.width, page.height);
        }
        bindPanelEvents() {
            this.pageTabs.addEventListener("click", (event) => {
                const button = event.target.closest("[data-page-id]");
                if (button?.dataset.pageId) {
                    this.loadedPageId = null;
                    this.store.setActivePage(button.dataset.pageId);
                    window.requestAnimationFrame(() => this.fitToViewport());
                }
            });
            this.roomList.addEventListener("click", (event) => {
                const room = event.target.closest("[data-select-room]");
                if (room?.dataset.selectRoom)
                    this.store.selectRoom(room.dataset.selectRoom);
                const label = event.target.closest("[data-select-label]");
                if (label?.dataset.selectLabel)
                    this.store.selectLabel(label.dataset.selectLabel);
            });
            this.inspector.addEventListener("change", (event) => this.handleInspectorChange(event));
            this.inspector.addEventListener("click", (event) => this.handleInspectorClick(event));
            this.draftLabelInput.addEventListener("input", () => {
                this.store.draftLabel = this.draftLabelInput.value;
            });
        }
        handleInspectorChange(event) {
            const target = event.target;
            const roomField = target.dataset.roomField;
            if (roomField === "displayLabel") {
                this.store.updateSelectedRoom((room) => {
                    room.displayLabel = target.value.trim() || room.displayLabel;
                    room.progress = ICPDrawingLab.fakeProgressForRoom(room.displayLabel);
                    const suggestion = ICPDrawingLab.suggestRoomMatch(room.displayLabel);
                    room.suggestedRoomId = suggestion.room?.id ?? null;
                    room.matchConfidence = suggestion.confidence;
                });
            }
            if (roomField === "linkedRoomId") {
                this.store.updateSelectedRoom((room) => {
                    room.linkedRoomId = target.value || null;
                    if (target.value)
                        room.reviewStatus = "accepted";
                });
            }
            const progressField = target.dataset.progressField;
            if (progressField) {
                this.store.updateSelectedRoom((room) => {
                    room.progress[progressField] = Math.max(0, Number(target.value) || 0);
                    if (room.progress.completed > room.progress.total && room.progress.total > 0) {
                        room.progress.completed = room.progress.total;
                    }
                });
            }
        }
        handleInspectorClick(event) {
            const button = event.target.closest("[data-inspector-action]");
            const action = button?.dataset.inspectorAction;
            if (!action)
                return;
            if (action === "accept-room") {
                const select = this.inspector.querySelector("[data-room-field='linkedRoomId']");
                this.store.acceptSelectedRoom(select?.value || null);
            }
            if (action === "reject-room")
                this.store.rejectSelectedRoom();
            if (action === "delete-room" && confirm("Delete this room geometry?"))
                this.store.deleteSelectedRoom();
            if (action === "draw-label") {
                const label = this.store.selectedLabel;
                if (!label)
                    return;
                this.store.draftLabel = label.roomCode;
                this.store.setTool("draw");
            }
            if (action === "ignore-label")
                this.store.ignoreSelectedLabel();
        }
    }
    ICPDrawingLab.DrawingRenderer = DrawingRenderer;
})(ICPDrawingLab || (ICPDrawingLab = {}));
var ICPDrawingLab;
(function (ICPDrawingLab) {
    class DrawingLabApplication {
        store = new ICPDrawingLab.EditorStore();
        renderer = new ICPDrawingLab.DrawingRenderer(this.store);
        planInput = ICPDrawingLab.assertElement("#planFileInput");
        projectInput = ICPDrawingLab.assertElement("#projectFileInput");
        projectName = ICPDrawingLab.assertElement("#projectName");
        analyseButton = ICPDrawingLab.assertElement("#analyseButton");
        analysisProgress = ICPDrawingLab.assertElement("#analysisProgress");
        roomPatternInput = ICPDrawingLab.assertElement("#roomPattern");
        forceOcrInput = ICPDrawingLab.assertElement("#forceOcr");
        boundariesInput = ICPDrawingLab.assertElement("#createBoundaries");
        darkThresholdInput = ICPDrawingLab.assertElement("#darkThreshold");
        constructor() {
            this.roomPatternInput.value = ICPDrawingLab.DEFAULT_ROOM_PATTERN;
            this.projectName.value = this.store.project.name;
            this.bindActions();
            void this.loadSample();
        }
        bindActions() {
            ICPDrawingLab.assertElement("#uploadPlanButton").addEventListener("click", () => this.planInput.click());
            this.planInput.addEventListener("change", () => void this.handlePlanFiles());
            ICPDrawingLab.assertElement("#loadSampleButton").addEventListener("click", () => void this.loadSample());
            this.analyseButton.addEventListener("click", () => void this.analyseActivePage());
            ICPDrawingLab.assertElement("#clearAutomaticButton").addEventListener("click", () => this.clearAutomaticSuggestions());
            ICPDrawingLab.assertElement("#saveProjectButton").addEventListener("click", () => this.saveProject());
            ICPDrawingLab.assertElement("#loadProjectButton").addEventListener("click", () => this.projectInput.click());
            this.projectInput.addEventListener("change", () => void this.loadProject());
            document.querySelectorAll("[data-editor-tool]").forEach((button) => {
                button.addEventListener("click", () => {
                    const tool = button.dataset.editorTool;
                    if (tool)
                        this.store.setTool(tool);
                });
            });
            ICPDrawingLab.assertElement("#undoButton").addEventListener("click", () => this.store.undo());
            ICPDrawingLab.assertElement("#redoButton").addEventListener("click", () => this.store.redo());
            ICPDrawingLab.assertElement("#zoomInButton").addEventListener("click", () => this.renderer.zoomBy(1.2));
            ICPDrawingLab.assertElement("#zoomOutButton").addEventListener("click", () => this.renderer.zoomBy(0.83));
            ICPDrawingLab.assertElement("#fitButton").addEventListener("click", () => this.renderer.fitToViewport());
            ICPDrawingLab.assertElement("#finishDraftButton").addEventListener("click", () => {
                const label = ICPDrawingLab.assertElement("#draftRoomLabel").value;
                this.store.finishDraft(label);
            });
            ICPDrawingLab.assertElement("#cancelDraftButton").addEventListener("click", () => this.store.cancelDraft());
            this.projectName.addEventListener("change", () => {
                this.store.project.name = this.projectName.value.trim() || "ICP Drawing Recognition Test";
                this.store.notify();
            });
            this.store.subscribe(() => {
                if (document.activeElement !== this.projectName)
                    this.projectName.value = this.store.project.name;
            });
            window.addEventListener("keydown", (event) => this.handleKeyboard(event));
            window.addEventListener("resize", ICPDrawingLab.debounce(() => {
                if (this.store.activePage && this.store.view.scale === 1)
                    this.renderer.fitToViewport();
            }, 150));
        }
        recognitionSettings() {
            return {
                roomPattern: this.roomPatternInput.value.trim() || ICPDrawingLab.DEFAULT_ROOM_PATTERN,
                forceOcr: this.forceOcrInput.checked,
                createBoundarySuggestions: this.boundariesInput.checked,
                darkThreshold: ICPDrawingLab.clamp(Number(this.darkThresholdInput.value) || 155, 50, 245),
            };
        }
        async handlePlanFiles() {
            const files = Array.from(this.planInput.files ?? []);
            this.planInput.value = "";
            if (!files.length)
                return;
            this.setBusy(true);
            try {
                const pages = await ICPDrawingLab.loadDrawingFiles(files, this.recognitionSettings().roomPattern, (message) => ICPDrawingLab.setStatus(message));
                const name = files.length === 1
                    ? files[0].name.replace(/\.[^.]+$/, "")
                    : `Drawing test · ${files.length} files`;
                this.store.replacePages(pages, name);
                this.store.resetHistory();
                ICPDrawingLab.setStatus(`${pages.length} drawing page${pages.length === 1 ? "" : "s"} loaded.`, "success");
                window.requestAnimationFrame(() => this.renderer.fitToViewport());
            }
            catch (error) {
                console.error(error);
                ICPDrawingLab.setStatus(error instanceof Error ? error.message : "The drawing could not be loaded.", "error");
            }
            finally {
                this.setBusy(false);
            }
        }
        async loadSample() {
            this.setBusy(true);
            try {
                const page = await ICPDrawingLab.loadSamplePage(this.recognitionSettings().roomPattern);
                this.store.replacePages([page], "ICP Drawing Recognition Sample");
                this.store.resetHistory();
                ICPDrawingLab.setStatus(`${page.labels.length} labels read from the sample SVG. Run Recognize & Suggest.`, "success");
                window.requestAnimationFrame(() => this.renderer.fitToViewport());
            }
            catch (error) {
                console.error(error);
                ICPDrawingLab.setStatus(error instanceof Error ? error.message : "The sample drawing could not be loaded.", "error");
            }
            finally {
                this.setBusy(false);
            }
        }
        async analyseActivePage() {
            const page = this.store.activePage;
            if (!page) {
                ICPDrawingLab.setStatus("Upload a drawing before running recognition.", "warning");
                return;
            }
            const settings = this.recognitionSettings();
            try {
                ICPDrawingLab.compileRoomPattern(settings.roomPattern);
            }
            catch (error) {
                ICPDrawingLab.setStatus(error instanceof Error ? error.message : String(error), "error");
                return;
            }
            this.setBusy(true);
            this.analysisProgress.hidden = false;
            this.analysisProgress.value = 0;
            const before = this.store.startTransaction();
            try {
                const summary = await ICPDrawingLab.analysePage(page, settings, (message, progress) => {
                    ICPDrawingLab.setStatus(message);
                    if (progress !== undefined)
                        this.analysisProgress.value = progress;
                });
                this.store.commitTransaction(before);
                ICPDrawingLab.setStatus(`Recognition complete: ${summary.labelsFound} labels, ${summary.roomsSuggested} boundary suggestions, ${summary.boundariesFailed} labels without a box.`, summary.boundariesFailed ? "warning" : "success");
            }
            catch (error) {
                console.error(error);
                ICPDrawingLab.setStatus(error instanceof Error ? error.message : "Recognition could not be completed.", "error");
            }
            finally {
                this.analysisProgress.hidden = true;
                this.setBusy(false);
            }
        }
        clearAutomaticSuggestions() {
            const page = this.store.activePage;
            if (!page)
                return;
            const automaticCount = page.rooms.filter((room) => room.source === "automatic").length;
            if (!automaticCount) {
                ICPDrawingLab.setStatus("There are no automatic suggestions to clear.", "warning");
                return;
            }
            if (!confirm(`Clear ${automaticCount} automatic room suggestion${automaticCount === 1 ? "" : "s"}? Manual rooms will remain.`))
                return;
            const before = this.store.startTransaction();
            const removedIds = new Set(page.rooms.filter((room) => room.source === "automatic").map((room) => room.id));
            page.rooms = page.rooms.filter((room) => room.source !== "automatic");
            page.labels.forEach((label) => {
                if (label.consumedByRoomId && removedIds.has(label.consumedByRoomId))
                    label.consumedByRoomId = null;
            });
            this.store.selectedRoomId = null;
            this.store.commitTransaction(before);
            ICPDrawingLab.setStatus("Automatic suggestions cleared.", "success");
        }
        saveProject() {
            const project = this.store.exportProject();
            project.name = this.projectName.value.trim() || project.name;
            const json = JSON.stringify(project, null, 2);
            const sizeMb = new Blob([json]).size / 1024 / 1024;
            if (sizeMb > 45 && !confirm(`This project JSON is ${sizeMb.toFixed(1)} MB because it contains embedded drawing images. Continue?`))
                return;
            ICPDrawingLab.downloadBlob(`${ICPDrawingLab.safeFileName(project.name)}.icp-drawing.json`, new Blob([json], { type: "application/json" }));
            ICPDrawingLab.setStatus("Project JSON downloaded.", "success");
        }
        async loadProject() {
            const file = this.projectInput.files?.[0];
            this.projectInput.value = "";
            if (!file)
                return;
            try {
                const parsed = JSON.parse(await ICPDrawingLab.readFileAsText(file));
                ICPDrawingLab.validateProject(parsed);
                this.store.importProject(parsed);
                ICPDrawingLab.setStatus(`Project loaded: ${parsed.pages.length} page${parsed.pages.length === 1 ? "" : "s"}.`, "success");
                window.requestAnimationFrame(() => this.renderer.fitToViewport());
            }
            catch (error) {
                console.error(error);
                ICPDrawingLab.setStatus(error instanceof Error ? error.message : "The project JSON could not be loaded.", "error");
            }
        }
        handleKeyboard(event) {
            const target = event.target;
            const typing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
            const modifier = event.metaKey || event.ctrlKey;
            if (modifier && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (event.shiftKey)
                    this.store.redo();
                else
                    this.store.undo();
                return;
            }
            if (modifier && event.key.toLowerCase() === "y") {
                event.preventDefault();
                this.store.redo();
                return;
            }
            if (typing)
                return;
            if (event.key === "Escape")
                this.store.cancelDraft();
            if (event.key === "Enter" && this.store.tool === "draw") {
                event.preventDefault();
                this.store.finishDraft(ICPDrawingLab.assertElement("#draftRoomLabel").value);
            }
            if ((event.key === "Delete" || event.key === "Backspace") && this.store.selectedRoom) {
                event.preventDefault();
                if (confirm("Delete the selected room geometry?"))
                    this.store.deleteSelectedRoom();
            }
            const shortcuts = {
                v: "select",
                d: "draw",
                a: "add-vertex",
                x: "delete-vertex",
                h: "pan",
            };
            const tool = shortcuts[event.key.toLowerCase()];
            if (tool)
                this.store.setTool(tool);
        }
        setBusy(busy) {
            this.analyseButton.disabled = busy;
            ICPDrawingLab.assertElement("#uploadPlanButton").disabled = busy;
            ICPDrawingLab.assertElement("#loadSampleButton").disabled = busy;
            document.body.classList.toggle("is-busy", busy);
        }
    }
    window.addEventListener("DOMContentLoaded", () => {
        try {
            new DrawingLabApplication();
        }
        catch (error) {
            console.error(error);
            ICPDrawingLab.setStatus(error instanceof Error ? error.message : "The application could not start.", "error");
        }
    });
})(ICPDrawingLab || (ICPDrawingLab = {}));
//# sourceMappingURL=app.js.map