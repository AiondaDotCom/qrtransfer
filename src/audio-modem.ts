import { encodeBitfieldRaw, decodeBitfieldRaw } from './feedback';

// FSK Parameters
export const FREQ_ZERO = 1200;
export const FREQ_ONE = 2400;
export const BAUD_RATE = 300;
export const SAMPLE_RATE = 44100;
export const SAMPLES_PER_BIT = Math.round(SAMPLE_RATE / BAUD_RATE); // 147
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

// Generate FSK waveform from frame bytes
function generateWaveform(frame: Uint8Array): Float32Array {
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
        ) * 0.5; // amplitude 0.5 to avoid clipping
        sampleIndex++;
      }
    }
  }
  // Gap samples remain 0 (silence)

  return waveform;
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

// ===== AudioEncoder: plays FSK audio (used by receiver) =====
export class AudioEncoder {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private _isPlaying = false;

  start(received: Set<number>, totalChunks: number): void {
    this.stop();
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

    const bitfieldBytes = encodeBitfieldRaw(received, totalChunks);
    const frame = buildFrame(bitfieldBytes);
    const waveform = generateWaveform(frame);

    const buffer = this.ctx.createBuffer(1, waveform.length, SAMPLE_RATE);
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
  private _isListening = false;
  private onFeedback: (received: Set<number>, totalChunks: number) => void;

  // Decoder state
  private state: DecoderState = DecoderState.WAIT_PREAMBLE;
  private sampleBuffer: Float32Array = new Float32Array(0);
  private sampleOffset = 0;
  private bitBuffer: number[] = [];
  private preambleCount = 0;
  private dataLength = 0;
  private bytesCollected: number[] = [];
  private noiseThreshold = 0.01;

  constructor(
    onFeedback: (received: Set<number>, totalChunks: number) => void
  ) {
    this.onFeedback = onFeedback;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

    const source = this.ctx.createMediaStreamSource(this.stream);
    // 4096 samples per buffer gives ~93ms chunks, good for processing
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      this.processSamples(input);
    };

    source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this._isListening = true;
    this.resetState();
  }

  private resetState(): void {
    this.state = DecoderState.WAIT_PREAMBLE;
    this.bitBuffer = [];
    this.preambleCount = 0;
    this.dataLength = 0;
    this.bytesCollected = [];
    this.sampleOffset = 0;
  }

  private processSamples(samples: Float32Array): void {
    // Append to our sample buffer
    const combined = new Float32Array(
      this.sampleBuffer.length - this.sampleOffset + samples.length
    );
    combined.set(
      this.sampleBuffer.subarray(this.sampleOffset),
      0
    );
    combined.set(samples, this.sampleBuffer.length - this.sampleOffset);
    this.sampleBuffer = combined;
    this.sampleOffset = 0;

    // Process complete bit periods
    while (this.sampleOffset + SAMPLES_PER_BIT <= this.sampleBuffer.length) {
      const bit = this.decodeBit(
        this.sampleBuffer,
        this.sampleOffset,
        SAMPLES_PER_BIT
      );
      this.sampleOffset += SAMPLES_PER_BIT;

      if (bit === -1) {
        // Silence/noise — reset
        this.resetState();
        continue;
      }

      this.feedBit(bit);
    }

    // Trim processed samples
    if (this.sampleOffset > 0) {
      this.sampleBuffer = this.sampleBuffer.slice(this.sampleOffset);
      this.sampleOffset = 0;
    }
  }

  private decodeBit(
    samples: Float32Array,
    offset: number,
    length: number
  ): number {
    const mag0 = goertzelMagnitude(samples, offset, length, FREQ_ZERO, SAMPLE_RATE);
    const mag1 = goertzelMagnitude(samples, offset, length, FREQ_ONE, SAMPLE_RATE);

    const maxMag = Math.max(mag0, mag1);
    if (maxMag < this.noiseThreshold) return -1; // silence

    return mag1 > mag0 ? 1 : 0;
  }

  private feedBit(bit: number): void {
    switch (this.state) {
      case DecoderState.WAIT_PREAMBLE:
        // Look for alternating 10101010 pattern
        this.bitBuffer.push(bit);
        if (this.bitBuffer.length > 16) this.bitBuffer.shift();

        // Check for at least 12 alternating bits
        if (this.bitBuffer.length >= 12) {
          let alternating = true;
          for (let i = this.bitBuffer.length - 12; i < this.bitBuffer.length - 1; i++) {
            if (this.bitBuffer[i] === this.bitBuffer[i + 1]) {
              alternating = false;
              break;
            }
          }
          if (alternating) {
            this.state = DecoderState.WAIT_SYNC;
            this.bitBuffer = [];
            this.preambleCount = 0;
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
            // Still in preamble, keep waiting
            this.bitBuffer = [];
          } else {
            // Bad sync, reset
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
            this.resetState(); // sanity check
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

          // Need dataLength bytes of data + 1 byte CRC
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

    // CRC over [length, data...]
    const crcInput = new Uint8Array(1 + this.dataLength);
    crcInput[0] = this.dataLength;
    crcInput.set(data, 1);

    if (crc8(crcInput) !== receivedCrc) return; // CRC mismatch, discard

    // Decode bitfield — totalChunks = dataLength * 8
    const totalChunks = this.dataLength * 8;
    const received = decodeBitfieldRaw(data, totalChunks);
    this.onFeedback(received, totalChunks);
  }

  stop(): void {
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
