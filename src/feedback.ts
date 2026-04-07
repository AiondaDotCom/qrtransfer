import { toBase64, fromBase64 } from './protocol';

export interface FeedbackPacket {
  v: number;
  f: true;
  t: number; // total chunks
  r: number; // received count
  b: string; // base64-encoded bitfield
}

export function encodeBitfield(received: Set<number>, totalChunks: number): string {
  const byteCount = Math.ceil(totalChunks / 8);
  const bytes = new Uint8Array(byteCount);
  for (const idx of received) {
    if (idx >= 0 && idx < totalChunks) {
      const byteIndex = Math.floor(idx / 8);
      const bitIndex = idx % 8;
      bytes[byteIndex] |= 1 << bitIndex;
    }
  }
  return toBase64(bytes);
}

export function decodeBitfield(b64: string, totalChunks: number): Set<number> {
  const bytes = fromBase64(b64);
  const result = new Set<number>();
  for (let i = 0; i < totalChunks; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    if (byteIndex < bytes.length && (bytes[byteIndex] & (1 << bitIndex)) !== 0) {
      result.add(i);
    }
  }
  return result;
}

export function createFeedbackPacket(
  received: Set<number>,
  totalChunks: number
): FeedbackPacket {
  return {
    v: 1,
    f: true,
    t: totalChunks,
    r: received.size,
    b: encodeBitfield(received, totalChunks),
  };
}

export function serializeFeedback(packet: FeedbackPacket): string {
  return JSON.stringify(packet);
}

export function parseFeedback(raw: string): FeedbackPacket | null {
  try {
    const obj = JSON.parse(raw);
    if (
      obj.v !== 1 ||
      obj.f !== true ||
      typeof obj.t !== 'number' ||
      typeof obj.r !== 'number' ||
      typeof obj.b !== 'string'
    ) {
      return null;
    }
    return obj as FeedbackPacket;
  } catch {
    return null;
  }
}

export function getMissingChunks(packet: FeedbackPacket): number[] {
  const received = decodeBitfield(packet.b, packet.t);
  const missing: number[] = [];
  for (let i = 0; i < packet.t; i++) {
    if (!received.has(i)) {
      missing.push(i);
    }
  }
  return missing;
}
