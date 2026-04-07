import { describe, it, expect } from 'vitest';
import {
  crc32,
  crc32Hex,
  toBase64,
  fromBase64,
  compress,
  decompress,
  createChunks,
  serializePacket,
  parsePacket,
  assembleChunks,
  formatFileSize,
  ChunkPacket,
} from '../src/protocol';

describe('crc32', () => {
  it('computes correct CRC32 for empty data', () => {
    const data = new Uint8Array(0);
    expect(crc32(data)).toBe(0);
  });

  it('computes correct CRC32 for known input', () => {
    const data = new TextEncoder().encode('Hello, World!');
    // Known CRC32 for "Hello, World!"
    expect(crc32Hex(data)).toBe('ec4ac3d0');
  });

  it('computes correct CRC32 for single byte', () => {
    const data = new Uint8Array([0x61]); // 'a'
    expect(crc32Hex(data)).toBe('e8b7be43');
  });

  it('returns consistent results', () => {
    const data = new TextEncoder().encode('test data');
    expect(crc32(data)).toBe(crc32(data));
  });

  it('returns different results for different inputs', () => {
    const data1 = new TextEncoder().encode('hello');
    const data2 = new TextEncoder().encode('world');
    expect(crc32(data1)).not.toBe(crc32(data2));
  });
});

describe('base64', () => {
  it('round-trips empty data', () => {
    const data = new Uint8Array(0);
    const encoded = toBase64(data);
    const decoded = fromBase64(encoded);
    expect(decoded.length).toBe(0);
  });

  it('round-trips ASCII text', () => {
    const original = new TextEncoder().encode('Hello, World!');
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips binary data', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips large data', () => {
    const original = new Uint8Array(10000);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
  });
});

describe('compression', () => {
  it('round-trips data', () => {
    const original = new TextEncoder().encode('Hello, World! This is a test of compression.');
    const compressed = compress(original);
    const decompressed = decompress(compressed);
    expect(decompressed).toEqual(original);
  });

  it('actually compresses repetitive data', () => {
    const original = new TextEncoder().encode('AAAA'.repeat(1000));
    const compressed = compress(original);
    expect(compressed.length).toBeLessThan(original.length);
  });

  it('round-trips empty data', () => {
    const original = new Uint8Array(0);
    const compressed = compress(original);
    const decompressed = decompress(compressed);
    expect(decompressed.length).toBe(0);
  });

  it('round-trips binary data', () => {
    const original = new Uint8Array(1000);
    for (let i = 0; i < original.length; i++) original[i] = Math.floor(Math.random() * 256);
    const compressed = compress(original);
    const decompressed = decompress(compressed);
    expect(decompressed).toEqual(original);
  });
});

describe('createChunks', () => {
  it('creates a single chunk for small data', () => {
    const data = new TextEncoder().encode('Hello');
    const chunks = createChunks({ name: 'test.txt', data }, 900);
    expect(chunks.length).toBe(1);
    expect(chunks[0].v).toBe(1);
    expect(chunks[0].i).toBe(0);
    expect(chunks[0].t).toBe(1);
    expect(chunks[0].n).toBe('test.txt');
    expect(chunks[0].s).toBe(5);
    expect(chunks[0].h).toBeDefined();
    expect(chunks[0].d).toBeDefined();
  });

  it('creates multiple chunks for larger data', () => {
    // Use random-ish data that doesn't compress well
    const data = new Uint8Array(5000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 137 + 83) % 256;
    const chunks = createChunks({ name: 'big.bin', data }, 200);
    expect(chunks.length).toBeGreaterThan(1);

    // Only first chunk has metadata
    expect(chunks[0].n).toBe('big.bin');
    expect(chunks[0].s).toBe(5000);
    expect(chunks[0].h).toBeDefined();

    // Other chunks don't have metadata
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].n).toBeUndefined();
      expect(chunks[i].s).toBeUndefined();
      expect(chunks[i].h).toBeUndefined();
    }

    // All chunks have correct total
    for (const chunk of chunks) {
      expect(chunk.t).toBe(chunks.length);
      expect(chunk.v).toBe(1);
    }

    // Indices are sequential
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].i).toBe(i);
    }
  });

  it('creates at least one chunk for empty data', () => {
    const data = new Uint8Array(0);
    const chunks = createChunks({ name: 'empty.txt', data }, 900);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('respects chunk size', () => {
    const data = new Uint8Array(10000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = createChunks({ name: 'data.bin', data }, 200);

    // Each chunk's data should be at most 200 chars
    for (const chunk of chunks) {
      expect(chunk.d.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('serializePacket / parsePacket', () => {
  it('round-trips a packet', () => {
    const packet: ChunkPacket = {
      v: 1,
      i: 5,
      t: 10,
      d: 'SGVsbG8=',
    };
    const serialized = serializePacket(packet);
    const parsed = parsePacket(serialized);
    expect(parsed).toEqual(packet);
  });

  it('round-trips a metadata packet', () => {
    const packet: ChunkPacket = {
      v: 1,
      i: 0,
      t: 10,
      n: 'test.pdf',
      s: 12345,
      h: 'abcd1234',
      d: 'SGVsbG8=',
    };
    const serialized = serializePacket(packet);
    const parsed = parsePacket(serialized);
    expect(parsed).toEqual(packet);
  });

  it('returns null for invalid JSON', () => {
    expect(parsePacket('not json')).toBeNull();
    expect(parsePacket('{}')).toBeNull();
    expect(parsePacket('{"v":2,"i":0,"t":1,"d":"x"}')).toBeNull(); // wrong version
    expect(parsePacket('{"v":1,"t":1,"d":"x"}')).toBeNull(); // missing i
    expect(parsePacket('{"v":1,"i":0,"d":"x"}')).toBeNull(); // missing t
    expect(parsePacket('{"v":1,"i":0,"t":1}')).toBeNull(); // missing d
  });

  it('returns null for non-string input to parsePacket edge cases', () => {
    expect(parsePacket('')).toBeNull();
    expect(parsePacket('null')).toBeNull();
    expect(parsePacket('[]')).toBeNull();
  });
});

describe('assembleChunks', () => {
  it('assembles a single chunk correctly', () => {
    const original = new TextEncoder().encode('Hello, World!');
    const chunks = createChunks({ name: 'hello.txt', data: original }, 900);

    const map = new Map<number, ChunkPacket>();
    for (const chunk of chunks) {
      map.set(chunk.i, chunk);
    }

    const result = assembleChunks(map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(original);
      expect(result.metadata.filename).toBe('hello.txt');
      expect(result.metadata.fileSize).toBe(original.length);
      expect(result.metadata.hash).toBe(crc32Hex(original));
    }
  });

  it('assembles multiple chunks correctly', () => {
    const original = new Uint8Array(5000);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    const chunks = createChunks({ name: 'data.bin', data: original }, 300);
    expect(chunks.length).toBeGreaterThan(1);

    const map = new Map<number, ChunkPacket>();
    for (const chunk of chunks) {
      map.set(chunk.i, chunk);
    }

    const result = assembleChunks(map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(original);
      expect(result.metadata.filename).toBe('data.bin');
      expect(result.metadata.fileSize).toBe(5000);
      expect(result.metadata.totalChunks).toBe(chunks.length);
    }
  });

  it('assembles chunks in any order', () => {
    const original = new TextEncoder().encode('The quick brown fox jumps over the lazy dog. '.repeat(50));
    const chunks = createChunks({ name: 'fox.txt', data: original }, 200);

    // Shuffle chunks
    const shuffled = [...chunks].sort(() => Math.random() - 0.5);

    const map = new Map<number, ChunkPacket>();
    for (const chunk of shuffled) {
      map.set(chunk.i, chunk);
    }

    const result = assembleChunks(map);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(original);
    }
  });

  it('detects missing chunks', () => {
    const original = new Uint8Array(5000);
    for (let i = 0; i < original.length; i++) original[i] = (i * 137 + 83) % 256;
    const chunks = createChunks({ name: 'data.bin', data: original }, 200);

    const map = new Map<number, ChunkPacket>();
    // Skip chunk 2
    for (const chunk of chunks) {
      if (chunk.i !== 2) {
        map.set(chunk.i, chunk);
      }
    }

    const result = assembleChunks(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Missing chunk');
    }
  });

  it('detects missing metadata (chunk 0)', () => {
    const map = new Map<number, ChunkPacket>();
    map.set(1, { v: 1, i: 1, t: 3, d: 'abc' });
    map.set(2, { v: 1, i: 2, t: 3, d: 'def' });

    const result = assembleChunks(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Missing metadata');
    }
  });

  it('detects CRC mismatch', () => {
    const original = new TextEncoder().encode('Hello');
    const chunks = createChunks({ name: 'test.txt', data: original }, 900);

    // Corrupt the hash
    chunks[0].h = '00000000';

    const map = new Map<number, ChunkPacket>();
    for (const chunk of chunks) {
      map.set(chunk.i, chunk);
    }

    const result = assembleChunks(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('CRC mismatch');
    }
  });

  it('detects size mismatch', () => {
    const original = new TextEncoder().encode('Hello');
    const chunks = createChunks({ name: 'test.txt', data: original }, 900);

    // Corrupt the size
    chunks[0].s = 999;

    const map = new Map<number, ChunkPacket>();
    for (const chunk of chunks) {
      map.set(chunk.i, chunk);
    }

    const result = assembleChunks(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('mismatch');
    }
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
    expect(formatFileSize(5242880)).toBe('5.0 MB');
  });
});

describe('end-to-end', () => {
  it('handles various file types via round-trip', () => {
    const testCases = [
      { name: 'small.txt', data: new TextEncoder().encode('Hi') },
      { name: 'medium.txt', data: new TextEncoder().encode('x'.repeat(10000)) },
      { name: 'binary.dat', data: (() => { const d = new Uint8Array(8000); for (let i = 0; i < d.length; i++) d[i] = i % 256; return d; })() },
    ];

    for (const { name, data } of testCases) {
      const chunks = createChunks({ name, data }, 500);
      const map = new Map<number, ChunkPacket>();
      for (const chunk of chunks) {
        map.set(chunk.i, chunk);
      }
      const result = assembleChunks(map);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(data);
        expect(result.metadata.filename).toBe(name);
      }
    }
  });

  it('every packet serializes under QR capacity', () => {
    const data = new Uint8Array(10000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = createChunks({ name: 'test.bin', data }, 900);

    for (const chunk of chunks) {
      const serialized = serializePacket(chunk);
      // QR Version 40 at M EC: ~2331 bytes. We should be well under.
      expect(serialized.length).toBeLessThan(2000);
    }
  });
});
