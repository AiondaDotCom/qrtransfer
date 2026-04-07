import jsQR from 'jsqr';
import { parsePacket, assembleChunks, ChunkPacket, TransferMetadata } from './protocol';
import { AudioEncoder } from './audio-modem';

export interface SmartReceiverCallbacks {
  onChunkReceived: (index: number, total: number, received: number) => void;
  onComplete: (data: Uint8Array, metadata: TransferMetadata) => void;
  onError: (error: string) => void;
  onFeedbackUpdated: (received: number, total: number) => void;
}

export class SmartReceiver {
  private video: HTMLVideoElement;
  private scanCanvas: HTMLCanvasElement;
  private scanCtx: CanvasRenderingContext2D;
  private chunks: Map<number, ChunkPacket> = new Map();
  private totalChunks = 0;
  private scanning = false;
  private animFrameId: number | null = null;
  private callbacks: SmartReceiverCallbacks;
  private stream: MediaStream | null = null;
  private feedbackDirty = false;
  private feedbackThrottleId: number | null = null;
  private encoder: AudioEncoder | null = null;
  private facing: 'environment' | 'user' = 'environment';

  constructor(
    video: HTMLVideoElement,
    scanCanvas: HTMLCanvasElement,
    callbacks: SmartReceiverCallbacks
  ) {
    this.video = video;
    this.scanCanvas = scanCanvas;
    this.scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true })!;
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

    this.encoder = new AudioEncoder();

    // Throttle audio feedback updates to every 200ms
    this.feedbackThrottleId = window.setInterval(() => {
      if (this.feedbackDirty && this.totalChunks > 0) {
        this.feedbackDirty = false;
        if (!this.encoder!.isPlaying) {
          this.encoder!.start(this.receivedChunks, this.totalChunks);
        } else {
          this.encoder!.update(this.receivedChunks, this.totalChunks);
        }
        this.callbacks.onFeedbackUpdated(this.chunks.size, this.totalChunks);
      }
    }, 200);
  }

  private scanLoop(): void {
    if (!this.scanning) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      this.scanCanvas.width = this.video.videoWidth;
      this.scanCanvas.height = this.video.videoHeight;
      this.scanCtx.drawImage(this.video, 0, 0);

      const imageData = this.scanCtx.getImageData(
        0,
        0,
        this.scanCanvas.width,
        this.scanCanvas.height
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
    this.feedbackDirty = true;

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
    if (this.feedbackThrottleId !== null) {
      clearInterval(this.feedbackThrottleId);
      this.feedbackThrottleId = null;
    }
    if (this.encoder) {
      this.encoder.stop();
      this.encoder = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
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

  get receivedChunks(): Set<number> {
    return new Set(this.chunks.keys());
  }

  get receivedCount(): number {
    return this.chunks.size;
  }

  get total(): number {
    return this.totalChunks;
  }

  reset(): void {
    this.stop();
    this.chunks.clear();
    this.totalChunks = 0;
    this.feedbackDirty = false;
  }
}
