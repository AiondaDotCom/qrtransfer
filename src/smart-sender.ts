import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { createChunks, createTextChunks, serializePacket, ChunkPacket } from './protocol';
import { parseFeedback, getMissingChunks } from './feedback';

export interface SmartSenderCallbacks {
  onReady: (totalChunks: number) => void;
  onProgress: (currentChunk: number, total: number, remaining: number) => void;
  onFeedbackReceived: (received: number, total: number) => void;
  onComplete: () => void;
}

export class SmartSender {
  private packets: ChunkPacket[] = [];
  private playlist: number[] = [];
  private playlistIndex = 0;
  private playing = false;
  private timerId: number | null = null;
  private speed = 100;
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;
  private scanCanvas: HTMLCanvasElement;
  private scanCtx: CanvasRenderingContext2D;
  private callbacks: SmartSenderCallbacks;
  private stream: MediaStream | null = null;
  private scanIntervalId: number | null = null;
  private completed = false;
  private facing: 'environment' | 'user' = 'user';

  constructor(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    scanCanvas: HTMLCanvasElement,
    callbacks: SmartSenderCallbacks
  ) {
    this.canvas = canvas;
    this.video = video;
    this.scanCanvas = scanCanvas;
    this.scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true })!;
    this.callbacks = callbacks;
  }

  async loadFile(file: File, chunkSize: number = 900): Promise<void> {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    this.packets = createChunks({ name: file.name, data }, chunkSize);
    this.init();
  }

  async loadText(text: string, chunkSize: number = 900): Promise<void> {
    this.packets = createTextChunks(text, chunkSize);
    this.init();
  }

  private async init(): Promise<void> {
    this.playlist = this.packets.map((_, i) => i);
    this.playlistIndex = 0;
    this.completed = false;
    this.callbacks.onReady(this.packets.length);
    await this.renderCurrent();
  }

  private async renderCurrent(): Promise<void> {
    if (this.playlist.length === 0 || this.packets.length === 0) return;
    const chunkIndex = this.playlist[this.playlistIndex % this.playlist.length];
    const packet = this.packets[chunkIndex];
    const data = serializePacket(packet);
    await QRCode.toCanvas(this.canvas, data, {
      width: 380,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    this.callbacks.onProgress(chunkIndex, this.packets.length, this.playlist.length);
  }

  async startCamera(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: this.facing,
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    // Scan for feedback QR every 500ms
    this.scanIntervalId = window.setInterval(() => {
      this.scanFeedback();
    }, 500);
  }

  private scanFeedback(): void {
    if (this.video.readyState !== this.video.HAVE_ENOUGH_DATA) return;

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
      const feedback = parseFeedback(code.data);
      if (feedback) {
        this.handleFeedback(feedback);
      }
    }
  }

  private handleFeedback(feedback: ReturnType<typeof parseFeedback>): void {
    if (!feedback) return;

    const missing = getMissingChunks(feedback);
    this.callbacks.onFeedbackReceived(feedback.r, feedback.t);

    if (missing.length === 0) {
      // All chunks received
      this.completed = true;
      this.pause();
      this.stopCamera();
      this.callbacks.onComplete();
      return;
    }

    // Update playlist to only missing chunks
    this.playlist = missing;
    this.playlistIndex = this.playlistIndex % this.playlist.length;
  }

  play(): void {
    if (this.playing || this.packets.length === 0 || this.completed) return;
    this.playing = true;
    this.advance();
  }

  private advance(): void {
    if (!this.playing) return;
    this.timerId = window.setTimeout(async () => {
      if (this.playlist.length === 0) return;
      this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
      await this.renderCurrent();
      this.advance();
    }, this.speed);
  }

  pause(): void {
    this.playing = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  setSpeed(ms: number): void {
    this.speed = ms;
    if (this.playing) {
      this.pause();
      this.play();
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
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stopCamera(): void {
    if (this.scanIntervalId !== null) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get totalPackets(): number {
    return this.packets.length;
  }

  get remainingCount(): number {
    return this.playlist.length;
  }

  get isComplete(): boolean {
    return this.completed;
  }

  destroy(): void {
    this.pause();
    this.stopCamera();
    this.packets = [];
    this.playlist = [];
    this.playlistIndex = 0;
    this.completed = false;
  }
}
