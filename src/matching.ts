namespace ICPDrawingLab {
  export const DEFAULT_ROOM_PATTERN = String.raw`\b(?:ROOM\s*)?([A-Z]{0,4}[-_ ]?\d{2,4}[A-Z]?|[A-Z0-9]{1,6}[-_]\d{2,4}[A-Z]?|[A-Z0-9]*ZL[-_ ]*[A-Z0-9-]+)\b`;

  export const FAKE_ROOM_DATABASE: RoomRecord[] = [
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

  export function normalizeRoomCode(value: string): string {
    return value.toUpperCase().replace(/\bROOM\b/g, "").replace(/[^A-Z0-9]/g, "").trim();
  }

  export function compileRoomPattern(pattern: string): RegExp {
    try {
      return new RegExp(pattern, "gi");
    } catch (error) {
      throw new Error(`Room label pattern is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  export function extractRoomCodes(text: string, pattern: string): string[] {
    const regex = compileRoomPattern(pattern);
    const values: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const candidate = String(match[1] ?? match[0] ?? "").trim();
      if (candidate) values.push(candidate);
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
    return [...new Set(values)];
  }

  function levenshtein(left: string, right: string): number {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    const current = new Array<number>(right.length + 1);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      current[0] = leftIndex;
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + cost,
        );
      }
      for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
    }
    return previous[right.length];
  }

  export function scoreRoomMatch(label: string, room: RoomRecord): number {
    const normalizedLabel = normalizeRoomCode(label);
    const normalizedCode = normalizeRoomCode(room.code);
    if (!normalizedLabel || !normalizedCode) return 0;
    if (normalizedLabel === normalizedCode) return 1;
    if (normalizedLabel.endsWith(normalizedCode) || normalizedCode.endsWith(normalizedLabel)) return 0.9;
    const distance = levenshtein(normalizedLabel, normalizedCode);
    const maximumLength = Math.max(normalizedLabel.length, normalizedCode.length);
    const similarity = 1 - distance / maximumLength;
    return round(similarity, 2);
  }

  export function suggestRoomMatch(label: string, rooms = FAKE_ROOM_DATABASE): {
    room: RoomRecord | null;
    confidence: number | null;
    exact: boolean;
  } {
    const ranked = rooms
      .map((room) => ({ room, score: scoreRoomMatch(label, room) }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best || best.score < 0.62) return { room: null, confidence: null, exact: false };
    return { room: best.room, confidence: best.score, exact: best.score === 1 };
  }

  export function fakeProgressForRoom(code: string): ProgressData {
    const seed = [...normalizeRoomCode(code)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const total = 20 + (seed % 51);
    const completed = Math.round(total * ((seed % 87) / 100));
    return { total, completed };
  }
}
