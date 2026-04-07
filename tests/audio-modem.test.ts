import { describe, it, expect } from 'vitest';
import {
  crc8,
  buildFrame,
  parseFrame,
  PREAMBLE_BYTE,
  SYNC_WORD,
  goertzelMagnitude,
  FREQ_ZERO,
  FREQ_ONE,
  SAMPLE_RATE,
  SAMPLES_PER_BIT,
  generateWaveform,
  decodeWaveform,
} from '../src/audio-modem';
import { encodeBitfieldRaw, decodeBitfieldRaw } from '../src/feedback';

describe('crc8', () => {
  it('returns 0 for empty data', () => {
    expect(crc8(new Uint8Array(0))).toBe(0);
  });

  it('computes consistent CRC', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    expect(crc8(data)).toBe(crc8(data));
  });

  it('different data produces different CRC', () => {
    const a = new Uint8Array([0x01, 0x02, 0x03]);
    const b = new Uint8Array([0x01, 0x02, 0x04]);
    expect(crc8(a)).not.toBe(crc8(b));
  });

  it('single byte CRC', () => {
    const data = new Uint8Array([0x00]);
    expect(crc8(data)).toBe(0);
    const data2 = new Uint8Array([0x01]);
    expect(crc8(data2)).not.toBe(0);
  });

  it('returns value in 0-255 range', () => {
    for (let i = 0; i < 256; i++) {
      const crc = crc8(new Uint8Array([i]));
      expect(crc).toBeGreaterThanOrEqual(0);
      expect(crc).toBeLessThanOrEqual(255);
    }
  });
});

describe('buildFrame / parseFrame', () => {
  it('round-trips a small bitfield', () => {
    const bitfield = new Uint8Array([0xff, 0x00, 0xab]);
    const frame = buildFrame(bitfield);
    expect(frame.length).toBe(8); // 2+1+1+3+1
    expect(frame[0]).toBe(PREAMBLE_BYTE);
    expect(frame[1]).toBe(PREAMBLE_BYTE);
    expect(frame[2]).toBe(SYNC_WORD);
    expect(frame[3]).toBe(3); // length
    const parsed = parseFrame(frame);
    expect(parsed).toEqual(bitfield);
  });

  it('round-trips single byte', () => {
    const bitfield = new Uint8Array([0x42]);
    const frame = buildFrame(bitfield);
    expect(frame.length).toBe(6); // 2+1+1+1+1
    const parsed = parseFrame(frame);
    expect(parsed).toEqual(bitfield);
  });

  it('round-trips larger payload', () => {
    const bitfield = new Uint8Array(100);
    for (let i = 0; i < 100; i++) bitfield[i] = i;
    const frame = buildFrame(bitfield);
    const parsed = parseFrame(frame);
    expect(parsed).toEqual(bitfield);
  });

  it('returns null for corrupted CRC', () => {
    const frame = buildFrame(new Uint8Array([0x01]));
    frame[frame.length - 1] ^= 0xff; // corrupt CRC
    expect(parseFrame(frame)).toBeNull();
  });

  it('returns null for wrong preamble', () => {
    const frame = buildFrame(new Uint8Array([0x01]));
    frame[0] = 0x00;
    expect(parseFrame(frame)).toBeNull();
  });

  it('returns null for wrong sync word', () => {
    const frame = buildFrame(new Uint8Array([0x01]));
    frame[2] = 0x00;
    expect(parseFrame(frame)).toBeNull();
  });

  it('returns null for truncated frame', () => {
    const frame = buildFrame(new Uint8Array([0x01, 0x02, 0x03]));
    const truncated = frame.slice(0, 5); // missing data + crc
    expect(parseFrame(truncated)).toBeNull();
  });

  it('returns null for too-short frame', () => {
    expect(parseFrame(new Uint8Array([0xaa]))).toBeNull();
    expect(parseFrame(new Uint8Array([]))).toBeNull();
  });

  it('returns null for corrupted data byte', () => {
    const bitfield = new Uint8Array([0x01, 0x02]);
    const frame = buildFrame(bitfield);
    frame[4] ^= 0x01; // corrupt first data byte
    expect(parseFrame(frame)).toBeNull();
  });
});

describe('encodeBitfieldRaw / decodeBitfieldRaw', () => {
  it('round-trips empty set', () => {
    const bytes = encodeBitfieldRaw(new Set(), 20);
    const decoded = decodeBitfieldRaw(bytes, 20);
    expect(decoded.size).toBe(0);
  });

  it('round-trips full set', () => {
    const set = new Set<number>();
    for (let i = 0; i < 20; i++) set.add(i);
    const bytes = encodeBitfieldRaw(set, 20);
    const decoded = decodeBitfieldRaw(bytes, 20);
    expect(decoded).toEqual(set);
  });

  it('round-trips arbitrary set', () => {
    const set = new Set([0, 3, 7, 15, 19]);
    const bytes = encodeBitfieldRaw(set, 20);
    const decoded = decodeBitfieldRaw(bytes, 20);
    expect(decoded).toEqual(set);
  });

  it('byte count is ceil(total/8)', () => {
    expect(encodeBitfieldRaw(new Set(), 1).length).toBe(1);
    expect(encodeBitfieldRaw(new Set(), 8).length).toBe(1);
    expect(encodeBitfieldRaw(new Set(), 9).length).toBe(2);
    expect(encodeBitfieldRaw(new Set(), 100).length).toBe(13);
  });
});

describe('goertzel', () => {
  it('detects 1200 Hz tone', () => {
    const samples = new Float32Array(SAMPLES_PER_BIT);
    for (let i = 0; i < SAMPLES_PER_BIT; i++) {
      samples[i] = Math.sin((2 * Math.PI * FREQ_ZERO * i) / SAMPLE_RATE);
    }
    const mag0 = goertzelMagnitude(samples, 0, SAMPLES_PER_BIT, FREQ_ZERO, SAMPLE_RATE);
    const mag1 = goertzelMagnitude(samples, 0, SAMPLES_PER_BIT, FREQ_ONE, SAMPLE_RATE);
    expect(mag0).toBeGreaterThan(mag1);
  });

  it('detects 2400 Hz tone', () => {
    const samples = new Float32Array(SAMPLES_PER_BIT);
    for (let i = 0; i < SAMPLES_PER_BIT; i++) {
      samples[i] = Math.sin((2 * Math.PI * FREQ_ONE * i) / SAMPLE_RATE);
    }
    const mag0 = goertzelMagnitude(samples, 0, SAMPLES_PER_BIT, FREQ_ZERO, SAMPLE_RATE);
    const mag1 = goertzelMagnitude(samples, 0, SAMPLES_PER_BIT, FREQ_ONE, SAMPLE_RATE);
    expect(mag1).toBeGreaterThan(mag0);
  });

  it('silence has low magnitude', () => {
    const samples = new Float32Array(SAMPLES_PER_BIT); // all zeros
    const mag0 = goertzelMagnitude(samples, 0, SAMPLES_PER_BIT, FREQ_ZERO, SAMPLE_RATE);
    const mag1 = goertzelMagnitude(samples, 0, SAMPLES_PER_BIT, FREQ_ONE, SAMPLE_RATE);
    expect(mag0).toBeLessThan(0.01);
    expect(mag1).toBeLessThan(0.01);
  });
});

describe('integration: frame through bitfield', () => {
  it('builds valid frame from bitfield and parses back', () => {
    const received = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);
    const totalChunks = 50;
    const bitfieldBytes = encodeBitfieldRaw(received, totalChunks);
    const frame = buildFrame(bitfieldBytes);
    const parsed = parseFrame(frame);
    expect(parsed).not.toBeNull();
    const decoded = decodeBitfieldRaw(parsed!, totalChunks);
    expect(decoded).toEqual(received);
  });

  it('frame size stays reasonable for large chunk counts', () => {
    const bitfield = encodeBitfieldRaw(new Set(), 2000);
    const frame = buildFrame(bitfield);
    // 2000 chunks = 250 bytes bitfield + 5 overhead = 255 bytes
    expect(frame.length).toBe(255);
  });
});

describe('loopback: encode → waveform → decode', () => {
  it('decodes a single-byte bitfield from waveform', () => {
    const received = new Set([0, 2, 4, 6]);
    const bitfieldBytes = encodeBitfieldRaw(received, 8);
    const frame = buildFrame(bitfieldBytes);
    const waveform = generateWaveform(frame);

    const result = decodeWaveform(waveform);
    expect(result).not.toBeNull();
    expect(result!.totalChunks).toBe(8);
    for (const idx of received) {
      expect(result!.received.has(idx)).toBe(true);
    }
    expect(result!.received.size).toBe(received.size);
  });

  it('decodes a multi-byte bitfield (100 chunks)', () => {
    const received = new Set<number>();
    for (let i = 0; i < 50; i++) received.add(i); // first half received
    const bitfieldBytes = encodeBitfieldRaw(received, 104); // 13 bytes
    const frame = buildFrame(bitfieldBytes);
    const waveform = generateWaveform(frame);

    const result = decodeWaveform(waveform);
    expect(result).not.toBeNull();
    expect(result!.totalChunks).toBe(104);
    expect(result!.received.size).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(result!.received.has(i)).toBe(true);
    }
    for (let i = 50; i < 104; i++) {
      expect(result!.received.has(i)).toBe(false);
    }
  });

  it('decodes empty bitfield (no chunks received)', () => {
    const bitfieldBytes = encodeBitfieldRaw(new Set(), 16);
    const frame = buildFrame(bitfieldBytes);
    const waveform = generateWaveform(frame);

    const result = decodeWaveform(waveform);
    expect(result).not.toBeNull();
    expect(result!.received.size).toBe(0);
  });

  it('decodes full bitfield (all chunks received)', () => {
    const received = new Set<number>();
    for (let i = 0; i < 24; i++) received.add(i);
    const bitfieldBytes = encodeBitfieldRaw(received, 24);
    const frame = buildFrame(bitfieldBytes);
    const waveform = generateWaveform(frame);

    const result = decodeWaveform(waveform);
    expect(result).not.toBeNull();
    expect(result!.received.size).toBe(24);
  });

  it('individual bits decode correctly from waveform', () => {
    // Test that each bit period has the correct dominant frequency
    const frame = new Uint8Array([0xAA, 0xAA, 0xD5, 0x01, 0xFF, 0x00]); // dummy frame
    const waveform = generateWaveform(frame);

    // First byte 0xAA = 10101010 — alternating frequencies
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const expectedBit = (0xAA >> (7 - bitIdx)) & 1;
      const offset = bitIdx * SAMPLES_PER_BIT;
      const mag0 = goertzelMagnitude(waveform, offset, SAMPLES_PER_BIT, FREQ_ZERO, SAMPLE_RATE);
      const mag1 = goertzelMagnitude(waveform, offset, SAMPLES_PER_BIT, FREQ_ONE, SAMPLE_RATE);

      if (expectedBit === 1) {
        expect(mag1).toBeGreaterThan(mag0);
      } else {
        expect(mag0).toBeGreaterThan(mag1);
      }
    }
  });

  it('returns null for silence', () => {
    const silence = new Float32Array(SAMPLES_PER_BIT * 100); // all zeros
    const result = decodeWaveform(silence);
    expect(result).toBeNull();
  });

  it('returns null for random noise', () => {
    const noise = new Float32Array(SAMPLES_PER_BIT * 100);
    for (let i = 0; i < noise.length; i++) {
      noise[i] = (Math.random() - 0.5) * 0.001; // very low amplitude noise
    }
    const result = decodeWaveform(noise);
    expect(result).toBeNull();
  });
});
