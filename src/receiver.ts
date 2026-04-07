import jsQR from 'jsqr';
import { parsePacket, assembleChunks, ChunkPacket, TransferMetadata } from './protocol';

export interface ReceiverCallbacks {
  onChunkReceived: (index: number, total: number, received: number) => void;
  onComplete: (data: Uint8Array, metadata: TransferMetadata) => void;
  onError: (error: string) => void;
}

export class Receiver {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chunks: Map<number, ChunkPacket> = new Map();
  private totalChunks = 0;
  private scanning = false;
  private animFrameId: number | null = null;
  private callbacks: ReceiverCallbacks;
  private stream: MediaStream | null = null;
  private lastScannedIndex = -1;
  private facing: 'environment' | 'user' = 'environment';

  constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    callbacks: ReceiverCallbacks
  ) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: this.facing,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.scanning = true;
    this.scanLoop();
  }

  private scanLoop(): void {
    if (!this.scanning) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.ctx.drawImage(this.video, 0, 0);

      const imageData = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height
      );
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        this.handleQRData(code.data);
      }
    }

    this.animFrameId = requestAnimationFrame(() => this.scanLoop());
  }

  private handleQRData(raw: string): void {
    const packet = parsePacket(raw);
    if (!packet) return;
    if (this.chunks.has(packet.i)) return;

    this.chunks.set(packet.i, packet);
    this.totalChunks = packet.t;
    this.lastScannedIndex = packet.i;

    this.callbacks.onChunkReceived(packet.i, packet.t, this.chunks.size);

    if (this.chunks.size === packet.t) {
      this.stop();
      const result = assembleChunks(this.chunks);
      if (result.ok) {
        this.callbacks.onComplete(result.data, result.metadata);
      } else {
        this.callbacks.onError(result.error);
      }
    }
  }

  stop(): void {
    this.scanning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  get receivedChunks(): Set<number> {
    return new Set(this.chunks.keys());
  }

  get receivedCount(): number {
    return this.chunks.size;
  }

  get total(): number {
    return this.totalChunks;
  }

  get lastIndex(): number {
    return this.lastScannedIndex;
  }

  async flipCamera(): Promise<void> {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: this.facing,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  reset(): void {
    this.stop();
    this.chunks.clear();
    this.totalChunks = 0;
    this.lastScannedIndex = -1;
  }
}
