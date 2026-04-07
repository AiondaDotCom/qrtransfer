import pako from 'pako';

export interface ChunkPacket {
  v: number;
  i: number;
  t: number;
  n?: string;
  s?: number;
  h?: string;
  tp?: string; // "t" = text, absent = file
  d: string;
}

export interface TransferMetadata {
  filename: string;
  fileSize: number;
  hash: string;
  totalChunks: number;
  type: 'text' | 'file';
}

// CRC32 lookup table
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(data: Uint8Array): string {
  return crc32(data).toString(16).padStart(8, '0');
}

export function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length));
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function compress(data: Uint8Array): Uint8Array {
  return pako.deflate(data, { level: 9 });
}

export function decompress(data: Uint8Array): Uint8Array {
  return pako.inflate(data);
}

export function createChunks(
  file: { name: string; data: Uint8Array },
  chunkSize: number = 900
): ChunkPacket[] {
  const compressed = compress(file.data);
  const b64 = toBase64(compressed);
  const hash = crc32Hex(file.data);

  const totalChunks = Math.max(1, Math.ceil(b64.length / chunkSize));
  const packets: ChunkPacket[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunk = b64.slice(i * chunkSize, (i + 1) * chunkSize);
    const packet: ChunkPacket = {
      v: 1,
      i,
      t: totalChunks,
      d: chunk,
    };
    if (i === 0) {
      packet.n = file.name;
      packet.s = file.data.length;
      packet.h = hash;
    }
    packets.push(packet);
  }

  return packets;
}

export function serializePacket(packet: ChunkPacket): string {
  return JSON.stringify(packet);
}

export function parsePacket(raw: string): ChunkPacket | null {
  try {
    const obj = JSON.parse(raw);
    if (
      obj.v !== 1 ||
      typeof obj.i !== 'number' ||
      typeof obj.t !== 'number' ||
      typeof obj.d !== 'string'
    ) {
      return null;
    }
    return obj as ChunkPacket;
  } catch {
    return null;
  }
}

export type AssemblyResult =
  | { ok: true; data: Uint8Array; metadata: TransferMetadata }
  | { ok: false; error: string };

export function assembleChunks(packets: Map<number, ChunkPacket>): AssemblyResult {
  const chunk0 = packets.get(0);
  if (!chunk0 || !chunk0.n || !chunk0.s || !chunk0.h) {
    return { ok: false, error: 'Missing metadata (chunk 0)' };
  }

  const totalChunks = chunk0.t;
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!packets.has(i)) {
      missing.push(i);
    }
  }
  if (missing.length > 0) {
    return { ok: false, error: `Missing chunks: ${missing.join(', ')}` };
  }

  let b64 = '';
  for (let i = 0; i < totalChunks; i++) {
    b64 += packets.get(i)!.d;
  }

  let data: Uint8Array;
  try {
    const compressed = fromBase64(b64);
    data = decompress(compressed);
  } catch (e) {
    return { ok: false, error: `Decompression failed: ${e}` };
  }

  const hash = crc32Hex(data);
  if (hash !== chunk0.h) {
    return { ok: false, error: `CRC mismatch: expected ${chunk0.h}, got ${hash}` };
  }

  if (data.length !== chunk0.s) {
    return { ok: false, error: `Size mismatch: expected ${chunk0.s}, got ${data.length}` };
  }

  return {
    ok: true,
    data,
    metadata: {
      filename: chunk0.n,
      fileSize: chunk0.s,
      hash: chunk0.h,
      totalChunks,
      type: chunk0.tp === 't' ? 'text' : 'file',
    },
  };
}

export function createTextChunks(
  text: string,
  chunkSize: number = 900
): ChunkPacket[] {
  const data = new TextEncoder().encode(text);
  const compressed = compress(data);
  const b64 = toBase64(compressed);
  const hash = crc32Hex(data);

  const totalChunks = Math.max(1, Math.ceil(b64.length / chunkSize));
  const packets: ChunkPacket[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunk = b64.slice(i * chunkSize, (i + 1) * chunkSize);
    const packet: ChunkPacket = {
      v: 1,
      i,
      t: totalChunks,
      d: chunk,
    };
    if (i === 0) {
      packet.tp = 't';
      packet.n = 'text';
      packet.s = data.length;
      packet.h = hash;
    }
    packets.push(packet);
  }

  return packets;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
