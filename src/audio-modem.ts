import { encodeBitfieldRaw, decodeBitfieldRaw } from './feedback';

// FSK Parameters (Bell 202 Pro — optimized for speaker-to-mic)
export const FREQ_ZERO = 1000;  // pleasant mid-range tones
export const FREQ_ONE = 1750;   // ratio 1.75 (non-harmonic), 750 Hz apart
export const BAUD_RATE = 10;    // 100ms per bit — very robust
export const SAMPLE_RATE = 44100;
export const SAMPLES_PER_BIT = Math.round(SAMPLE_RATE / BAUD_RATE);
export const PREAMBLE_BYTE = 0xaa;
export const SYNC_WORD = 0xd5;
export const INTER_FRAME_GAP_MS = 500;
export const GAP_SAMPLES = Math.round((INTER_FRAME_GAP_MS / 1000) * SAMPLE_RATE);

// CRC-8/CCITT (polynomial 0x07)
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

// Build frame: [preamble x2] [sync] [length] [data...] [crc8]
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

// Goertzel algorithm
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

// Generate FSK waveform (for tests + encoder)
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

// Generate waveform at actual device sample rate
function generateWaveformAtRate(frame: Uint8Array, sampleRate: number): Float32Array {
  const samplesPerBit = Math.round(sampleRate / BAUD_RATE);
  const gapSamples = Math.round((INTER_FRAME_GAP_MS / 1000) * sampleRate);
  const totalBits = frame.length * 8;
  const totalSamples = totalBits * samplesPerBit + gapSamples;
  const waveform = new Float32Array(totalSamples);
  let sampleIndex = 0;
  for (let byteIdx = 0; byteIdx < frame.length; byteIdx++) {
    const byte = frame[byteIdx];
    for (let bitIdx = 7; bitIdx >= 0; bitIdx--) {
      const bit = (byte >> bitIdx) & 1;
      const freq = bit ? FREQ_ONE : FREQ_ZERO;
      for (let s = 0; s < samplesPerBit; s++) {
        waveform[sampleIndex] = Math.sin((2 * Math.PI * freq * sampleIndex) / sampleRate) * 0.9;
        sampleIndex++;
      }
    }
  }
  return waveform;
}

// Test-only decoder
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

// FEC 3x repetition
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

// ===== Calibration: measure peak frequency from mic =====
export async function measurePeakFrequency(
  durationMs: number,
  minFreq: number,
  maxFreq: number,
  stepHz: number = 10
): Promise<{ freq: number; magnitude: number }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
  });
  const ctx = new AudioContext();
  await ctx.resume();
  const sr = ctx.sampleRate;
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const allSamples: number[] = [];

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) allSamples.push(input[i]);
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  await new Promise((r) => setTimeout(r, durationMs));

  processor.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  ctx.close();

  // Goertzel sweep to find peak
  const samples = new Float32Array(allSamples);
  let bestFreq = minFreq;
  let bestMag = 0;

  for (let f = minFreq; f <= maxFreq; f += stepHz) {
    const mag = goertzelMagnitude(samples, 0, samples.length, f, sr);
    if (mag > bestMag) {
      bestMag = mag;
      bestFreq = f;
    }
  }

  return { freq: bestFreq, magnitude: bestMag };
}

// ===== Calibration tone player (used by receiver/phone) =====
export class CalibrationTonePlayer {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;

  async playTone(freq: number, durationMs: number): Promise<void> {
    this.stop();
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.osc = this.ctx.createOscillator();
    this.osc.frequency.value = freq;
    this.osc.type = 'sine';
    const gain = this.ctx.createGain();
    gain.gain.value = 0.9;
    this.osc.connect(gain);
    gain.connect(this.ctx.destination);
    this.osc.start();
    await new Promise((r) => setTimeout(r, durationMs));
    this.stop();
  }

  stop(): void {
    if (this.osc) { try { this.osc.stop(); } catch { /* */ } this.osc = null; }
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
  }
}

// ===== AudioEncoder (Bell 202 FSK) =====
export class AudioEncoder {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private _isPlaying = false;

  async start(received: Set<number>, totalChunks: number): Promise<void> {
    this.stop();
    this.ctx = new AudioContext();
    await this.ctx.resume();
    const actualRate = this.ctx.sampleRate;

    // Sliding window: start at first missing chunk, 32-chunk bitfield + offset
    let windowStart = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (!received.has(i)) { windowStart = i; break; }
    }
    if (received.size === totalChunks) windowStart = totalChunks;

    const windowSize = 32;
    const windowSet = new Set<number>();
    for (let i = 0; i < windowSize && (windowStart + i) < totalChunks; i++) {
      if (received.has(windowStart + i)) windowSet.add(i);
    }
    const bitfieldBytes = encodeBitfieldRaw(windowSet, windowSize);

    // Fixed frame: [preamble×2][sync][offset 2B][bitfield 4B][CRC]
    // No length byte — payload is always 6 bytes, known to both sides
    const payload = new Uint8Array(6);
    payload[0] = (windowStart >> 8) & 0xff;
    payload[1] = windowStart & 0xff;
    payload.set(bitfieldBytes, 2);
    const crcVal = crc8(payload);

    const frame = new Uint8Array(4 + 1 + 6 + 1); // preamble×4 + sync + payload + crc
    frame[0] = PREAMBLE_BYTE; frame[1] = PREAMBLE_BYTE;
    frame[2] = PREAMBLE_BYTE; frame[3] = PREAMBLE_BYTE;
    frame[4] = SYNC_WORD;
    frame.set(payload, 5);
    frame[11] = crcVal;

    const waveform = generateWaveformAtRate(frame, actualRate);

    const buffer = this.ctx.createBuffer(1, waveform.length, actualRate);
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
    this._isPlaying = false;
  }

  get isPlaying(): boolean { return this._isPlaying; }
}

// ===== AudioDecoder (Bell 202 FSK with ring buffer) =====
const RING_BUFFER_SIZE = 65536;
const PROCESS_INTERVAL_MS = 500;
const NOISE_THRESHOLD = 0.001;

const enum DecoderState {
  WAIT_PREAMBLE,
  WAIT_SYNC,
  READ_LENGTH,
  READ_DATA,
}

export class AudioDecoder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private processIntervalId: number | null = null;
  private levelIntervalId: number | null = null;
  private _isListening = false;
  private onFeedback: (received: Set<number>, totalChunks: number) => void;
  private onMicLevel: ((level: number) => void) | null = null;
  private onDebug: ((info: string) => void) | null = null;

  private ringBuffer = new Float32Array(RING_BUFFER_SIZE);
  private writePos = 0;
  private readPos = 0;

  private actualSampleRate = SAMPLE_RATE;
  private actualSamplesPerBit = SAMPLES_PER_BIT;
  private freqZero = FREQ_ZERO;
  private freqOne = FREQ_ONE;

  private state: DecoderState = DecoderState.WAIT_PREAMBLE;
  private bitBuffer: number[] = [];
  private dataLength = 0;
  private bytesCollected: number[] = [];
  private startTime = 0;
  private peakLevel = 0;
  private bitsDecoded = 0;
  private silenceCount = 0;
  private preambleFound = 0;
  private crcFails = 0;
  private crcOk = 0;

  constructor(
    onFeedback: (received: Set<number>, totalChunks: number) => void,
    onMicLevel?: (level: number) => void,
    onDebug?: (info: string) => void,
    calibratedFreqs?: { freqZero: number; freqOne: number }
  ) {
    this.onFeedback = onFeedback;
    if (calibratedFreqs) {
      this.freqZero = calibratedFreqs.freqZero;
      this.freqOne = calibratedFreqs.freqOne;
    }
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
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.actualSampleRate = this.ctx.sampleRate;
    this.actualSamplesPerBit = Math.round(this.actualSampleRate / BAUD_RATE);
    this.startTime = Date.now();

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < input.length; i++) {
        this.ringBuffer[this.writePos] = input[i];
        this.writePos = (this.writePos + 1) & (RING_BUFFER_SIZE - 1);
        const abs = Math.abs(input[i]);
        if (abs > peak) peak = abs;
      }
      this.peakLevel = peak;
    };

    source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this._isListening = true;
    this.resetState();

    this.processIntervalId = window.setInterval(() => {
      this.processAccumulated();
    }, PROCESS_INTERVAL_MS);

    this.levelIntervalId = window.setInterval(() => {
      if (this.onMicLevel) this.onMicLevel(this.peakLevel);
      if (this.onDebug) {
        const stateNames = ['PREAMBLE', 'SYNC', 'LENGTH', 'DATA'];
        const extra = this.state === 3 ? ` len:${this.dataLength} got:${this.bytesCollected.length}/${this.dataLength + 1}` : '';
        this.onDebug(
          `Bell202 ${stateNames[this.state]} | bits:${this.bitsDecoded} pre:${this.preambleFound} crc:${this.crcOk}ok/${this.crcFails}fail${extra}`
        );
      }
    }, 500);
  }

  private resetState(): void {
    this.state = DecoderState.WAIT_PREAMBLE;
    this.bitBuffer = [];
    this.dataLength = 0;
    this.bytesCollected = [];
  }

  private availableSamples(): number {
    return (this.writePos - this.readPos + RING_BUFFER_SIZE) & (RING_BUFFER_SIZE - 1);
  }

  private processAccumulated(): void {
    const maxBits = 200;
    let bitsProcessed = 0;

    while (this.availableSamples() >= this.actualSamplesPerBit && bitsProcessed < maxBits) {
      const bit = this.decodeBitFromRing();
      bitsProcessed++;
      if (bit === -1) { this.resetState(); continue; }
      this.feedBit(bit);
    }

    if (this.availableSamples() > this.actualSampleRate) {
      this.readPos = (this.writePos - this.actualSamplesPerBit * 10 + RING_BUFFER_SIZE) & (RING_BUFFER_SIZE - 1);
      this.resetState();
    }
  }

  private decodeBitFromRing(): number {
    const mag0 = this.goertzelFromRing(this.freqZero);
    const mag1 = this.goertzelFromRing(this.freqOne);
    this.readPos = (this.readPos + this.actualSamplesPerBit) & (RING_BUFFER_SIZE - 1);
    const maxMag = Math.max(mag0, mag1);
    if (maxMag < NOISE_THRESHOLD) { this.silenceCount++; return -1; }
    this.bitsDecoded++;
    return mag1 > mag0 ? 1 : 0;
  }

  private goertzelFromRing(targetFreq: number): number {
    const N = this.actualSamplesPerBit;
    const k = Math.round((N * targetFreq) / this.actualSampleRate);
    const w = (2 * Math.PI * k) / N;
    const coeff = 2 * Math.cos(w);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) {
      const idx = (this.readPos + i) & (RING_BUFFER_SIZE - 1);
      s0 = this.ringBuffer[idx] + coeff * s1 - s2;
      s2 = s1; s1 = s0;
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
  }

  private feedBit(bit: number): void {
    switch (this.state) {
      case DecoderState.WAIT_PREAMBLE:
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length > 32) this.bitBuffer.shift();
        if (this.bitBuffer.length >= 20) {
          let alternating = true;
          for (let i = this.bitBuffer.length - 20; i < this.bitBuffer.length - 1; i++) {
            if (this.bitBuffer[i] === this.bitBuffer[i + 1]) { alternating = false; break; }
          }
          if (alternating) {
            this.preambleFound++;
            console.log(`[MODEM] ${((Date.now()-this.startTime)/1000).toFixed(1)}s Preamble #${this.preambleFound}`);
            this.state = DecoderState.WAIT_SYNC;
            this.bitBuffer = [];
          }
        }
        break;

      case DecoderState.WAIT_SYNC:
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length >= 8) {
          const last8 = this.bitBuffer.slice(-8);
          const byte = this.bitsToValue(last8);
          if (byte === SYNC_WORD) {
            console.log(`[MODEM] ${((Date.now()-this.startTime)/1000).toFixed(1)}s Sync found, reading 7 bytes`);
            this.state = DecoderState.READ_DATA;
            this.dataLength = 6;
            this.bitBuffer = [];
            this.bytesCollected = [];
          } else if (this.bitBuffer.length > 32) {
            this.resetState();
          }
        }
        break;

      case DecoderState.READ_DATA:
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length === 8) {
          this.bytesCollected.push(this.bitsToValue(this.bitBuffer));
          this.bitBuffer = [];
          // Read 6 data + 1 CRC = 7 bytes
          if (this.bytesCollected.length === 7) {
            this.validateFrame();
            this.resetState();
          }
        }
        break;
    }
  }

  private bitsToValue(bits: number[]): number {
    let val = 0;
    for (let i = 0; i < 8; i++) val = (val << 1) | bits[i];
    return val;
  }

  private validateFrame(): void {
    // 7 bytes: [6 payload] [1 CRC]
    const payload = new Uint8Array(this.bytesCollected.slice(0, 6));
    const receivedCrc = this.bytesCollected[6];
    const expectedCrc = crc8(payload);

    console.log(`[MODEM] ${((Date.now()-this.startTime)/1000).toFixed(1)}s Frame: [${Array.from(payload).map(x=>'0x'+x.toString(16).padStart(2,'0')).join(',')}] CRC: ${expectedCrc===receivedCrc?'OK':'FAIL'}`);

    if (expectedCrc !== receivedCrc) { this.crcFails++; return; }

    this.crcOk++;
    if (Date.now() - this.startTime < 2000) return;

    // Parse: [offset_hi][offset_lo][bitfield 4 bytes]
    const windowStart = (payload[0] << 8) | payload[1];
    const bitfield = payload.slice(2);
    const windowReceived = decodeBitfieldRaw(bitfield, 32);

    const received = new Set<number>();
    for (const relIdx of windowReceived) {
      received.add(windowStart + relIdx);
    }
    this.onFeedback(received, windowStart + 32);
  }

  stop(): void {
    if (this.processIntervalId !== null) { clearInterval(this.processIntervalId); this.processIntervalId = null; }
    if (this.levelIntervalId !== null) { clearInterval(this.levelIntervalId); this.levelIntervalId = null; }
    if (this.processor) { this.processor.disconnect(); this.processor = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
    this._isListening = false;
    this.resetState();
  }

  get isListening(): boolean { return this._isListening; }
}
