import { decodeBitfieldRaw } from './feedback';
// @ts-ignore — ggwave is a WASM factory module with no type defs
import ggwave_factory from 'ggwave';

// ===== Constants (kept for backward compat / tests) =====
export const FREQ_ZERO = 1200;
export const FREQ_ONE = 2400;
export const BAUD_RATE = 50;
export const SAMPLE_RATE = 44100;
export const SAMPLES_PER_BIT = Math.round(SAMPLE_RATE / BAUD_RATE);
export const PREAMBLE_BYTE = 0xaa;
export const SYNC_WORD = 0xd5;
export const INTER_FRAME_GAP_MS = 50;
export const GAP_SAMPLES = Math.round((INTER_FRAME_GAP_MS / 1000) * SAMPLE_RATE);

// ===== CRC-8 (kept for frame tests) =====
export function crc8(data: Uint8Array): number {
  let crc = 0x00;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

// ===== Frame building (kept for tests) =====
export function buildFrame(bitfieldBytes: Uint8Array): Uint8Array {
  const len = bitfieldBytes.length;
  const frame = new Uint8Array(2 + 1 + 1 + len + 1);
  frame[0] = PREAMBLE_BYTE; frame[1] = PREAMBLE_BYTE;
  frame[2] = SYNC_WORD; frame[3] = len;
  frame.set(bitfieldBytes, 4);
  const crcData = new Uint8Array(1 + len);
  crcData[0] = len; crcData.set(bitfieldBytes, 1);
  frame[4 + len] = crc8(crcData);
  return frame;
}

export function parseFrame(frameBytes: Uint8Array): Uint8Array | null {
  if (frameBytes.length < 5) return null;
  if (frameBytes[0] !== PREAMBLE_BYTE || frameBytes[1] !== PREAMBLE_BYTE) return null;
  if (frameBytes[2] !== SYNC_WORD) return null;
  const len = frameBytes[3];
  if (frameBytes.length < 4 + len + 1) return null;
  const data = frameBytes.slice(4, 4 + len);
  const receivedCrc = frameBytes[4 + len];
  const crcData = new Uint8Array(1 + len);
  crcData[0] = len; crcData.set(data, 1);
  if (crc8(crcData) !== receivedCrc) return null;
  return data;
}

// ===== Goertzel + waveform (kept for tests) =====
export function goertzelMagnitude(
  samples: Float32Array, offset: number, length: number,
  targetFreq: number, sampleRate: number
): number {
  const k = Math.round((length * targetFreq) / sampleRate);
  const w = (2 * Math.PI * k) / length;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < length; i++) {
    s0 = (samples[offset + i] || 0) + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

export function generateWaveform(frame: Uint8Array): Float32Array {
  const totalBits = frame.length * 8;
  const totalSamples = totalBits * SAMPLES_PER_BIT + GAP_SAMPLES;
  const waveform = new Float32Array(totalSamples);
  let sampleIndex = 0;
  for (let byteIdx = 0; byteIdx < frame.length; byteIdx++) {
    const byte = frame[byteIdx];
    for (let bitIdx = 7; bitIdx >= 0; bitIdx--) {
      const bit = (byte >> bitIdx) & 1;
      const freq = bit ? FREQ_ONE : FREQ_ZERO;
      for (let s = 0; s < SAMPLES_PER_BIT; s++) {
        waveform[sampleIndex] = Math.sin((2 * Math.PI * freq * sampleIndex) / SAMPLE_RATE) * 0.9;
        sampleIndex++;
      }
    }
  }
  return waveform;
}

export function decodeWaveform(waveform: Float32Array): { received: Set<number>; totalChunks: number } | null {
  const bits: number[] = [];
  let offset = 0;
  while (offset + SAMPLES_PER_BIT <= waveform.length) {
    const mag0 = goertzelMagnitude(waveform, offset, SAMPLES_PER_BIT, FREQ_ZERO, SAMPLE_RATE);
    const mag1 = goertzelMagnitude(waveform, offset, SAMPLES_PER_BIT, FREQ_ONE, SAMPLE_RATE);
    offset += SAMPLES_PER_BIT;
    if (Math.max(mag0, mag1) < 0.001) { if (bits.length > 0) break; continue; }
    bits.push(mag1 > mag0 ? 1 : 0);
  }
  if (bits.length < 32) return null;
  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    bytes.push(val);
  }
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === PREAMBLE_BYTE && bytes[i + 1] === PREAMBLE_BYTE && bytes[i + 2] === SYNC_WORD) {
      const dataLen = bytes[i + 3];
      if (i + 4 + dataLen + 1 > bytes.length) return null;
      const frameBytes = new Uint8Array(bytes.slice(i, i + 4 + dataLen + 1));
      const bitfieldBytes = parseFrame(frameBytes);
      if (!bitfieldBytes) return null;
      const totalChunks = dataLen * 8;
      return { received: decodeBitfieldRaw(bitfieldBytes, totalChunks), totalChunks };
    }
  }
  return null;
}

export function fecEncode(data: Uint8Array): Uint8Array {
  const bits: number[] = [];
  for (let i = 0; i < data.length; i++)
    for (let b = 7; b >= 0; b--) { const bit = (data[i] >> b) & 1; bits.push(bit, bit, bit); }
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
  return out;
}

export function fecDecode(encoded: Uint8Array, originalBitCount: number): Uint8Array {
  const bits: number[] = [];
  for (let i = 0; i < encoded.length; i++)
    for (let b = 7; b >= 0; b--) bits.push((encoded[i] >> b) & 1);
  const out = new Uint8Array(Math.ceil(originalBitCount / 8));
  for (let i = 0; i < originalBitCount; i++) {
    const a = bits[i * 3] ?? 0, b = bits[i * 3 + 1] ?? 0, c = bits[i * 3 + 2] ?? 0;
    if (a + b + c >= 2) out[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
  }
  return out;
}

// ===== ggwave singleton =====
let ggwaveReady: Promise<any> | null = null;
function getGgwave(): Promise<any> {
  if (!ggwaveReady) ggwaveReady = ggwave_factory();
  return ggwaveReady!;
}

// ===== AudioEncoder (ggwave-based) =====
export class AudioEncoder {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private _isPlaying = false;
  private ggwave: any = null;
  private instance: any = null;

  async start(received: Set<number>, totalChunks: number): Promise<void> {
    this.stop();

    this.ggwave = await getGgwave();
    const params = this.ggwave.getDefaultParameters();
    params.sampleRateOut = 48000;
    params.operatingMode = this.ggwave.GGWAVE_OPERATING_MODE_TX;
    this.instance = this.ggwave.init(params);

    const payload = `QRT:${received.size}:${totalChunks}`;
    const waveform = this.ggwave.encode(
      this.instance, payload,
      this.ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 10
    );

    this.ctx = new AudioContext();
    await this.ctx.resume();

    const buffer = this.ctx.createBuffer(1, waveform.length, 48000);
    buffer.getChannelData(0).set(waveform);

    this.source = this.ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.connect(this.ctx.destination);
    this.source.start();
    this._isPlaying = true;
  }

  update(received: Set<number>, totalChunks: number): void {
    this.start(received, totalChunks);
  }

  stop(): void {
    if (this.source) {
      try { this.source.stop(); } catch { /* */ }
      this.source.disconnect();
      this.source = null;
    }
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
    if (this.instance !== null && this.ggwave) {
      this.ggwave.free(this.instance);
      this.instance = null;
    }
    this._isPlaying = false;
  }

  get isPlaying(): boolean { return this._isPlaying; }
}

// ===== AudioDecoder (ggwave-based) =====
export class AudioDecoder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private levelIntervalId: number | null = null;
  private _isListening = false;
  private onFeedback: (received: Set<number>, totalChunks: number) => void;
  private onMicLevel: ((level: number) => void) | null = null;
  private onDebug: ((info: string) => void) | null = null;
  private ggwave: any = null;
  private instance: any = null;
  private startTime = 0;
  private decodeCount = 0;
  private peakLevel = 0;

  constructor(
    onFeedback: (received: Set<number>, totalChunks: number) => void,
    onMicLevel?: (level: number) => void,
    onDebug?: (info: string) => void
  ) {
    this.onFeedback = onFeedback;
    this.onMicLevel = onMicLevel ?? null;
    this.onDebug = onDebug ?? null;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    });

    this.ggwave = await getGgwave();
    const params = this.ggwave.getDefaultParameters();
    params.sampleRateInp = 48000;
    params.operatingMode = this.ggwave.GGWAVE_OPERATING_MODE_RX;
    this.instance = this.ggwave.init(params);
    this.startTime = Date.now();
    this.decodeCount = 0;

    this.ctx = new AudioContext({ sampleRate: 48000 });
    await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    // ggwave expects 1024 samples per frame
    this.processor = this.ctx.createScriptProcessor(1024, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);

      // Track peak
      let peak = 0;
      for (let i = 0; i < input.length; i++) {
        const abs = Math.abs(input[i]);
        if (abs > peak) peak = abs;
      }
      this.peakLevel = peak;

      // Feed to ggwave (expects Int8Array)
      const int8 = new Int8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        int8[i] = Math.max(-128, Math.min(127, Math.round(input[i] * 128)));
      }

      const result = this.ggwave.decode(this.instance, int8);
      if (result && result.length > 0) {
        const text = new TextDecoder().decode(result);
        this.handleDecoded(text);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this._isListening = true;

    this.levelIntervalId = window.setInterval(() => {
      if (this.onMicLevel) this.onMicLevel(this.peakLevel);
      if (this.onDebug) {
        this.onDebug(`ggwave RX | decoded:${this.decodeCount}`);
      }
    }, 500);
  }

  private handleDecoded(text: string): void {
    const match = text.match(/^QRT:(\d+):(\d+)$/);
    if (!match) return;

    this.decodeCount++;
    const recvCount = parseInt(match[1]);
    const totalChunks = parseInt(match[2]);

    if (Date.now() - this.startTime < 2000) return;

    const received = new Set<number>();
    for (let i = 0; i < recvCount; i++) received.add(i);
    this.onFeedback(received, totalChunks);
  }

  stop(): void {
    if (this.levelIntervalId !== null) {
      clearInterval(this.levelIntervalId);
      this.levelIntervalId = null;
    }
    if (this.processor) { this.processor.disconnect(); this.processor = null; }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
    if (this.instance !== null && this.ggwave) {
      this.ggwave.free(this.instance);
      this.instance = null;
    }
    this._isListening = false;
  }

  get isListening(): boolean { return this._isListening; }
}
