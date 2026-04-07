import { describe, it, expect } from 'vitest';
import {
  encodeBitfield,
  decodeBitfield,
  createFeedbackPacket,
  serializeFeedback,
  parseFeedback,
  getMissingChunks,
  FeedbackPacket,
} from '../src/feedback';
import { parsePacket, serializePacket, createChunks } from '../src/protocol';

describe('encodeBitfield / decodeBitfield', () => {
  it('round-trips empty set', () => {
    const received = new Set<number>();
    const encoded = encodeBitfield(received, 100);
    const decoded = decodeBitfield(encoded, 100);
    expect(decoded.size).toBe(0);
  });

  it('round-trips full set', () => {
    const total = 50;
    const received = new Set<number>();
    for (let i = 0; i < total; i++) received.add(i);
    const encoded = encodeBitfield(received, total);
    const decoded = decodeBitfield(encoded, total);
    expect(decoded.size).toBe(total);
    for (let i = 0; i < total; i++) {
      expect(decoded.has(i)).toBe(true);
    }
  });

  it('round-trips single chunk', () => {
    const received = new Set([7]);
    const encoded = encodeBitfield(received, 20);
    const decoded = decodeBitfield(encoded, 20);
    expect(decoded.size).toBe(1);
    expect(decoded.has(7)).toBe(true);
  });

  it('round-trips arbitrary set', () => {
    const received = new Set([0, 3, 5, 10, 15, 19]);
    const encoded = encodeBitfield(received, 20);
    const decoded = decodeBitfield(encoded, 20);
    expect(decoded).toEqual(received);
  });

  it('handles non-multiple-of-8 total (13 chunks)', () => {
    const received = new Set([0, 4, 8, 12]);
    const encoded = encodeBitfield(received, 13);
    const decoded = decodeBitfield(encoded, 13);
    expect(decoded).toEqual(received);
    // Should not contain indices >= 13
    expect(decoded.has(13)).toBe(false);
  });

  it('handles 1 chunk total', () => {
    const received = new Set([0]);
    const encoded = encodeBitfield(received, 1);
    const decoded = decodeBitfield(encoded, 1);
    expect(decoded).toEqual(received);
  });

  it('handles large scale (10000 chunks)', () => {
    const total = 10000;
    const received = new Set<number>();
    // Receive every 3rd chunk
    for (let i = 0; i < total; i += 3) received.add(i);
    const encoded = encodeBitfield(received, total);
    const decoded = decodeBitfield(encoded, total);
    expect(decoded.size).toBe(received.size);
    for (const idx of received) {
      expect(decoded.has(idx)).toBe(true);
    }
    // Verify non-received chunks are absent
    expect(decoded.has(1)).toBe(false);
    expect(decoded.has(2)).toBe(false);
  });

  it('bitfield size is ceil(total/8) bytes', () => {
    // 100 chunks = 13 bytes = ceil(100/8)
    const encoded = encodeBitfield(new Set(), 100);
    // base64 of 13 bytes = ceil(13/3)*4 = 20 chars
    expect(encoded.length).toBe(20);
  });

  it('ignores out-of-range indices', () => {
    const received = new Set([0, 5, 50]); // 50 is out of range for total=20
    const encoded = encodeBitfield(received, 20);
    const decoded = decodeBitfield(encoded, 20);
    expect(decoded.has(0)).toBe(true);
    expect(decoded.has(5)).toBe(true);
    expect(decoded.has(50)).toBe(false);
    expect(decoded.size).toBe(2);
  });
});

describe('createFeedbackPacket', () => {
  it('creates valid structure', () => {
    const received = new Set([0, 1, 2]);
    const packet = createFeedbackPacket(received, 10);
    expect(packet.v).toBe(1);
    expect(packet.f).toBe(true);
    expect(packet.t).toBe(10);
    expect(packet.r).toBe(3);
    expect(typeof packet.b).toBe('string');
  });
});

describe('serializeFeedback / parseFeedback', () => {
  it('round-trips a feedback packet', () => {
    const received = new Set([0, 3, 7]);
    const packet = createFeedbackPacket(received, 10);
    const serialized = serializeFeedback(packet);
    const parsed = parseFeedback(serialized);
    expect(parsed).toEqual(packet);
  });

  it('returns null for invalid JSON', () => {
    expect(parseFeedback('not json')).toBeNull();
    expect(parseFeedback('')).toBeNull();
    expect(parseFeedback('null')).toBeNull();
  });

  it('returns null for wrong version', () => {
    expect(parseFeedback('{"v":2,"f":true,"t":10,"r":3,"b":"AA=="}')).toBeNull();
  });

  it('returns null for missing f flag', () => {
    expect(parseFeedback('{"v":1,"t":10,"r":3,"b":"AA=="}')).toBeNull();
  });

  it('returns null for f !== true', () => {
    expect(parseFeedback('{"v":1,"f":false,"t":10,"r":3,"b":"AA=="}')).toBeNull();
  });

  it('returns null for missing fields', () => {
    expect(parseFeedback('{"v":1,"f":true}')).toBeNull();
    expect(parseFeedback('{"v":1,"f":true,"t":10}')).toBeNull();
    expect(parseFeedback('{"v":1,"f":true,"t":10,"r":3}')).toBeNull();
  });
});

describe('getMissingChunks', () => {
  it('returns all chunks when none received', () => {
    const packet = createFeedbackPacket(new Set(), 5);
    const missing = getMissingChunks(packet);
    expect(missing).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns empty when all received', () => {
    const packet = createFeedbackPacket(new Set([0, 1, 2, 3, 4]), 5);
    const missing = getMissingChunks(packet);
    expect(missing).toEqual([]);
  });

  it('returns correct missing chunks', () => {
    const packet = createFeedbackPacket(new Set([0, 2, 4]), 5);
    const missing = getMissingChunks(packet);
    expect(missing).toEqual([1, 3]);
  });

  it('handles large set', () => {
    const received = new Set<number>();
    for (let i = 0; i < 100; i += 2) received.add(i); // even chunks
    const packet = createFeedbackPacket(received, 100);
    const missing = getMissingChunks(packet);
    expect(missing.length).toBe(50);
    for (const m of missing) {
      expect(m % 2).toBe(1); // all odd
    }
  });
});

describe('packet discrimination', () => {
  it('parsePacket rejects feedback packets', () => {
    const feedback = createFeedbackPacket(new Set([0, 1]), 10);
    const serialized = serializeFeedback(feedback);
    expect(parsePacket(serialized)).toBeNull();
  });

  it('parseFeedback rejects data packets', () => {
    const chunks = createChunks({ name: 'test.txt', data: new TextEncoder().encode('hello') }, 900);
    const serialized = serializePacket(chunks[0]);
    expect(parseFeedback(serialized)).toBeNull();
  });
});

describe('feedback QR capacity', () => {
  it('feedback for 2000 chunks fits under QR capacity', () => {
    const received = new Set<number>();
    for (let i = 0; i < 1000; i++) received.add(i);
    const packet = createFeedbackPacket(received, 2000);
    const serialized = serializeFeedback(packet);
    expect(serialized.length).toBeLessThan(2000);
  });

  it('feedback for 10000 chunks fits under QR capacity', () => {
    const received = new Set<number>();
    for (let i = 0; i < 5000; i++) received.add(i);
    const packet = createFeedbackPacket(received, 10000);
    const serialized = serializeFeedback(packet);
    // 10000/8 = 1250 bytes raw = ~1668 base64 + ~30 JSON overhead
    expect(serialized.length).toBeLessThan(2000);
  });
});

describe('integration', () => {
  it('simulate partial transfer feedback', () => {
    // Sender has 50 chunks
    const data = new Uint8Array(5000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 137 + 83) % 256;
    const chunks = createChunks({ name: 'data.bin', data }, 200);
    const total = chunks.length;

    // Receiver has received first half
    const received = new Set<number>();
    for (let i = 0; i < Math.floor(total / 2); i++) received.add(i);

    // Create feedback
    const feedback = createFeedbackPacket(received, total);
    const serialized = serializeFeedback(feedback);
    const parsed = parseFeedback(serialized)!;

    // Sender reads feedback
    const missing = getMissingChunks(parsed);
    expect(missing.length).toBe(total - Math.floor(total / 2));

    // All missing are in second half
    for (const m of missing) {
      expect(m).toBeGreaterThanOrEqual(Math.floor(total / 2));
      expect(m).toBeLessThan(total);
    }
  });
});
