import { encodeBitfieldRaw, decodeBitfieldRaw } from './feedback';

// FSK Parameters
export const FREQ_ZERO = 1200;
export const FREQ_ONE = 2400;
export const BAUD_RATE = 100;
export const SAMPLE_RATE = 44100;
export const SAMPLES_PER_BIT = Math.round(SAMPLE_RATE / BAUD_RATE); // 441
export const PREAMBLE_BYTE = 0xaa;
export const SYNC_WORD = 0xd5;
export const INTER_FRAME_GAP_MS = 50;
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

// Build a frame: [preamble x2] [sync] [length] [data...] [crc8]
export function buildFrame(bitfieldBytes: Uint8Array): Uint8Array {
  const len = bitfieldBytes.length;
  const frame = new Uint8Array(2 + 1 + 1 + len + 1); // preamble(2) + sync(1) + length(1) + data + crc(1)
  frame[0] = PREAMBLE_BYTE;
  frame[1] = PREAMBLE_BYTE;
  frame[2] = SYNC_WORD;
  frame[3] = len;
  frame.set(bitfieldBytes, 4);

  // CRC over length + data
  const crcData = new Uint8Array(1 + len);
  crcData[0] = len;
  crcData.set(bitfieldBytes, 1);
  frame[4 + len] = crc8(crcData);

  return frame;
}

// Parse a frame, validate CRC, return bitfield bytes or null
export function parseFrame(frameBytes: Uint8Array): Uint8Array | null {
  if (frameBytes.length < 5) return null; // minimum: 2 preamble + 1 sync + 1 length + 1 crc
  if (frameBytes[0] !== PREAMBLE_BYTE || frameBytes[1] !== PREAMBLE_BYTE) return null;
  if (frameBytes[2] !== SYNC_WORD) return null;

  const len = frameBytes[3];
  if (frameBytes.length < 4 + len + 1) return null;

  const data = frameBytes.slice(4, 4 + len);
  const receivedCrc = frameBytes[4 + len];

  const crcData = new Uint8Array(1 + len);
  crcData[0] = len;
  crcData.set(data, 1);

  if (crc8(crcData) !== receivedCrc) return null;

  return data;
}

// Generate FSK waveform from frame bytes (exported for testing)
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
        waveform[sampleIndex] = Math.sin(
          (2 * Math.PI * freq * sampleIndex) / SAMPLE_RATE
        ) * 0.9; // high amplitude for speaker-to-mic transfer
        sampleIndex++;
      }
    }
  }
  // Gap samples remain 0 (silence)

  return waveform;
}

// Pure decoder function for testing — no Web Audio dependency
// Takes a waveform and tries to decode a feedback frame from it
export function decodeWaveform(
  waveform: Float32Array
): { received: Set<number>; totalChunks: number } | null {
  const bits: number[] = [];
  let offset = 0;

  // Decode all bits from the waveform
  while (offset + SAMPLES_PER_BIT <= waveform.length) {
    const mag0 = goertzelMagnitude(waveform, offset, SAMPLES_PER_BIT, FREQ_ZERO, SAMPLE_RATE);
    const mag1 = goertzelMagnitude(waveform, offset, SAMPLES_PER_BIT, FREQ_ONE, SAMPLE_RATE);
    offset += SAMPLES_PER_BIT;

    const maxMag = Math.max(mag0, mag1);
    if (maxMag < 0.001) {
      // Silence — if we have accumulated bits, try to parse
      if (bits.length > 0) break;
      continue;
    }

    bits.push(mag1 > mag0 ? 1 : 0);
  }

  if (bits.length < 32) return null; // too few bits for any frame

  // Convert bits to bytes
  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) {
      val = (val << 1) | bits[i + j];
    }
    bytes.push(val);
  }

  // Find preamble + sync in byte stream
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === PREAMBLE_BYTE && bytes[i + 1] === PREAMBLE_BYTE && bytes[i + 2] === SYNC_WORD) {
      const dataLen = bytes[i + 3];
      if (i + 4 + dataLen + 1 > bytes.length) return null; // not enough data

      const frameBytes = new Uint8Array(bytes.slice(i, i + 4 + dataLen + 1));
      const bitfieldBytes = parseFrame(frameBytes);
      if (!bitfieldBytes) return null;

      const totalChunks = dataLen * 8;
      const received = decodeBitfieldRaw(bitfieldBytes, totalChunks);
      return { received, totalChunks };
    }
  }

  return null;
}

// Goertzel algorithm: compute magnitude of a specific frequency in a sample buffer
export function goertzelMagnitude(
  samples: Float32Array,
  offset: number,
  length: number,
  targetFreq: number,
  sampleRate: number
): number {
  const k = Math.round((length * targetFreq) / sampleRate);
  const w = (2 * Math.PI * k) / length;
  const cosW = Math.cos(w);
  const coeff = 2 * cosW;

  let s0 = 0;
  let s1 = 0;
  let s2 = 0;

  for (let i = 0; i < length; i++) {
    s0 = (samples[offset + i] || 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

// Generate waveform using a specific sample rate (for real audio output)
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
        waveform[sampleIndex] = Math.sin(
          (2 * Math.PI * freq * sampleIndex) / sampleRate
        ) * 0.9;
        sampleIndex++;
      }
    }
  }
  return waveform;
}

// ===== AudioEncoder: plays FSK audio (used by receiver) =====
export class AudioEncoder {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private _isPlaying = false;

  async start(received: Set<number>, totalChunks: number): Promise<void> {
    this.stop();
    this.ctx = new AudioContext();
    await this.ctx.resume(); // ensure not suspended
    const actualRate = this.ctx.sampleRate;

    const bitfieldBytes = encodeBitfieldRaw(received, totalChunks);
    const frame = buildFrame(bitfieldBytes);
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
    // Restart with new data
    this.start(received, totalChunks);
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // ignore if already stopped
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this._isPlaying = false;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }
}

// ===== AudioDecoder: listens via microphone (used by sender) =====
// Uses a non-blocking architecture:
// - ScriptProcessorNode just copies samples to a ring buffer (fast, no allocation)
// - setInterval processes accumulated samples every 500ms (controlled, won't block UI)

const RING_BUFFER_SIZE = 65536; // ~1.5 seconds at 44100 Hz
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
  private _isListening = false;
  private onFeedback: (received: Set<number>, totalChunks: number) => void;
  private onMicLevel: ((level: number) => void) | null = null;
  private onDebug: ((info: string) => void) | null = null;
  private peakLevel = 0;
  private bitsDecoded = 0;
  private silenceCount = 0;
  private preambleFound = 0;

  // Ring buffer for samples — no allocations during audio callback
  private ringBuffer = new Float32Array(RING_BUFFER_SIZE);
  private writePos = 0;
  private readPos = 0;

  // Actual audio parameters (set after AudioContext creation)
  private actualSampleRate = SAMPLE_RATE;
  private actualSamplesPerBit = SAMPLES_PER_BIT;

  // Decoder state
  private state: DecoderState = DecoderState.WAIT_PREAMBLE;
  private bitBuffer: number[] = [];
  private dataLength = 0;
  private bytesCollected: number[] = [];
  private startTime = 0;

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
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new AudioContext();
    await this.ctx.resume(); // ensure not suspended
    this.actualSampleRate = this.ctx.sampleRate;
    this.actualSamplesPerBit = Math.round(this.actualSampleRate / BAUD_RATE);
    this.startTime = Date.now();

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);

    // Audio callback: copy samples to ring buffer + track peak level
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

    // Process samples on a timer — won't block the main thread
    this.processIntervalId = window.setInterval(() => {
      this.processAccumulated();
    }, PROCESS_INTERVAL_MS);
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
    // Report mic level for UI feedback
    if (this.onMicLevel) {
      this.onMicLevel(this.peakLevel);
    }

    // Report debug info
    if (this.onDebug) {
      const stateNames = ['PREAMBLE', 'SYNC', 'LENGTH', 'DATA'];
      this.onDebug(
        `${stateNames[this.state]} | bits:${this.bitsDecoded} sil:${this.silenceCount} pre:${this.preambleFound} buf:${this.availableSamples()} rate:${this.actualSampleRate} spb:${this.actualSamplesPerBit}`
      );
    }

    // Process up to a limited number of bits per interval to avoid blocking
    const maxBits = 200;
    let bitsProcessed = 0;

    while (this.availableSamples() >= this.actualSamplesPerBit && bitsProcessed < maxBits) {
      const bit = this.decodeBitFromRing();
      bitsProcessed++;

      if (bit === -1) {
        this.resetState();
        continue;
      }

      this.feedBit(bit);
    }

    // If we're falling behind, skip ahead to stay near real-time
    if (this.availableSamples() > this.actualSampleRate) {
      this.readPos = (this.writePos - this.actualSamplesPerBit * 10 + RING_BUFFER_SIZE) & (RING_BUFFER_SIZE - 1);
      this.resetState();
    }
  }

  private decodeBitFromRing(): number {
    const mag0 = this.goertzelFromRing(FREQ_ZERO);
    const mag1 = this.goertzelFromRing(FREQ_ONE);

    // Advance read position
    this.readPos = (this.readPos + this.actualSamplesPerBit) & (RING_BUFFER_SIZE - 1);

    const maxMag = Math.max(mag0, mag1);
    if (maxMag < NOISE_THRESHOLD) {
      this.silenceCount++;
      return -1;
    }

    this.bitsDecoded++;
    return mag1 > mag0 ? 1 : 0;
  }

  private goertzelFromRing(targetFreq: number): number {
    const N = this.actualSamplesPerBit;
    const k = Math.round((N * targetFreq) / this.actualSampleRate);
    const w = (2 * Math.PI * k) / N;
    const coeff = 2 * Math.cos(w);

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    for (let i = 0; i < N; i++) {
      const idx = (this.readPos + i) & (RING_BUFFER_SIZE - 1);
      s0 = this.ringBuffer[idx] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
  }

  private feedBit(bit: number): void {
    switch (this.state) {
      case DecoderState.WAIT_PREAMBLE:
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length > 16) this.bitBuffer.shift();

        if (this.bitBuffer.length >= 12) {
          let alternating = true;
          for (let i = this.bitBuffer.length - 12; i < this.bitBuffer.length - 1; i++) {
            if (this.bitBuffer[i] === this.bitBuffer[i + 1]) {
              alternating = false;
              break;
            }
          }
          if (alternating) {
            this.preambleFound++;
            this.state = DecoderState.WAIT_SYNC;
            this.bitBuffer = [];
          }
        }
        break;

      case DecoderState.WAIT_SYNC:
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length === 8) {
          const byte = this.bitsToValue(this.bitBuffer);
          if (byte === SYNC_WORD) {
            this.state = DecoderState.READ_LENGTH;
            this.bitBuffer = [];
          } else if (byte === PREAMBLE_BYTE) {
            this.bitBuffer = [];
          } else {
            this.resetState();
          }
        }
        break;

      case DecoderState.READ_LENGTH:
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length === 8) {
          this.dataLength = this.bitsToValue(this.bitBuffer);
          this.bitBuffer = [];
          this.bytesCollected = [];
          if (this.dataLength === 0 || this.dataLength > 200) {
            this.resetState();
          } else {
            this.state = DecoderState.READ_DATA;
          }
        }
        break;

      case DecoderState.READ_DATA:
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length === 8) {
          this.bytesCollected.push(this.bitsToValue(this.bitBuffer));
          this.bitBuffer = [];

          if (this.bytesCollected.length === this.dataLength + 1) {
            this.validateFrame();
            this.resetState();
          }
        }
        break;
    }
  }

  private bitsToValue(bits: number[]): number {
    let val = 0;
    for (let i = 0; i < 8; i++) {
      val = (val << 1) | bits[i];
    }
    return val;
  }

  private validateFrame(): void {
    const data = new Uint8Array(this.bytesCollected.slice(0, this.dataLength));
    const receivedCrc = this.bytesCollected[this.dataLength];

    const crcInput = new Uint8Array(1 + this.dataLength);
    crcInput[0] = this.dataLength;
    crcInput.set(data, 1);

    if (crc8(crcInput) !== receivedCrc) return;

    // Don't fire feedback in the first 2 seconds (avoid false positives from startup noise)
    if (Date.now() - this.startTime < 2000) return;

    const totalChunks = this.dataLength * 8;
    const received = decodeBitfieldRaw(data, totalChunks);
    this.onFeedback(received, totalChunks);
  }

  stop(): void {
    if (this.processIntervalId !== null) {
      clearInterval(this.processIntervalId);
      this.processIntervalId = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this._isListening = false;
    this.resetState();
  }

  get isListening(): boolean {
    return this._isListening;
  }
}
