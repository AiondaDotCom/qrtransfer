import QRCode from 'qrcode';
import { createChunks, serializePacket, ChunkPacket } from './protocol';

export interface SenderCallbacks {
  onProgress: (current: number, total: number) => void;
  onReady: (totalChunks: number) => void;
}

export class Sender {
  private packets: ChunkPacket[] = [];
  private currentIndex = 0;
  private playing = false;
  private timerId: number | null = null;
  private speed = 600;
  private canvas: HTMLCanvasElement;
  private callbacks: SenderCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks: SenderCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
  }

  async loadFile(file: File, chunkSize: number = 900): Promise<void> {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    this.packets = createChunks({ name: file.name, data }, chunkSize);
    this.currentIndex = 0;
    this.callbacks.onReady(this.packets.length);
    await this.renderCurrent();
  }

  private async renderCurrent(): Promise<void> {
    if (this.packets.length === 0) return;
    const packet = this.packets[this.currentIndex];
    const data = serializePacket(packet);
    await QRCode.toCanvas(this.canvas, data, {
      width: 380,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    this.callbacks.onProgress(this.currentIndex, this.packets.length);
  }

  play(): void {
    if (this.playing || this.packets.length === 0) return;
    this.playing = true;
    this.advance();
  }

  private advance(): void {
    if (!this.playing) return;
    this.timerId = window.setTimeout(async () => {
      this.currentIndex = (this.currentIndex + 1) % this.packets.length;
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

  next(): void {
    if (this.packets.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.packets.length;
    this.renderCurrent();
  }

  prev(): void {
    if (this.packets.length === 0) return;
    this.currentIndex =
      (this.currentIndex - 1 + this.packets.length) % this.packets.length;
    this.renderCurrent();
  }

  setSpeed(ms: number): void {
    this.speed = ms;
    if (this.playing) {
      this.pause();
      this.play();
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get totalPackets(): number {
    return this.packets.length;
  }

  destroy(): void {
    this.pause();
    this.packets = [];
    this.currentIndex = 0;
  }
}
