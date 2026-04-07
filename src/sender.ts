import QRCode from 'qrcode';
import { createChunks, createTextChunks, serializePacket, ChunkPacket } from './protocol';
import { AudioDecoder } from './audio-modem';

export interface SenderCallbacks {
  onProgress: (current: number, total: number) => void;
  onReady: (totalChunks: number) => void;
  onFeedbackReceived?: (receivedCount: number, total: number, receivedSet: Set<number>) => void;
  onTransferComplete?: () => void;
  onMicLevel?: (level: number) => void;
  onAudioDebug?: (info: string) => void;
}

export class Sender {
  private packets: ChunkPacket[] = [];
  private currentIndex = 0;
  private playing = false;
  private timerId: number | null = null;
  private speed = 100;
  private canvas: HTMLCanvasElement;
  private callbacks: SenderCallbacks;

  // Audio feedback (optional)
  private decoder: AudioDecoder | null = null;
  private playlist: number[] | null = null;
  private playlistIndex = 0;
  private completed = false;

  constructor(canvas: HTMLCanvasElement, callbacks: SenderCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
  }

  async loadFile(file: File, chunkSize: number = 900): Promise<void> {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    this.packets = createChunks({ name: file.name, data }, chunkSize);
    this.currentIndex = 0;
    this.playlist = null;
    this.playlistIndex = 0;
    this.completed = false;
    this.callbacks.onReady(this.packets.length);
    await this.renderCurrent();
  }

  async loadText(text: string, chunkSize: number = 900): Promise<void> {
    this.packets = createTextChunks(text, chunkSize);
    this.currentIndex = 0;
    this.playlist = null;
    this.playlistIndex = 0;
    this.completed = false;
    this.callbacks.onReady(this.packets.length);
    await this.renderCurrent();
  }

  private async renderCurrent(): Promise<void> {
    if (this.packets.length === 0) return;
    let idx: number;
    if (this.playlist) {
      if (this.playlist.length === 0) return;
      idx = this.playlist[this.playlistIndex % this.playlist.length];
    } else {
      idx = this.currentIndex;
    }
    const packet = this.packets[idx];
    const data = serializePacket(packet);
    await QRCode.toCanvas(this.canvas, data, {
      width: 380,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    this.callbacks.onProgress(idx, this.packets.length);
  }

  play(): void {
    if (this.playing || this.packets.length === 0 || this.completed) return;
    this.playing = true;
    this.advance();
  }

  private advance(): void {
    if (!this.playing) return;
    this.timerId = window.setTimeout(async () => {
      if (this.playlist) {
        if (this.playlist.length === 0) return;
        this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
      } else {
        this.currentIndex = (this.currentIndex + 1) % this.packets.length;
      }
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
    if (this.playlist) {
      if (this.playlist.length === 0) return;
      this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
    } else {
      this.currentIndex = (this.currentIndex + 1) % this.packets.length;
    }
    this.renderCurrent();
  }

  prev(): void {
    if (this.packets.length === 0) return;
    if (this.playlist) {
      if (this.playlist.length === 0) return;
      this.playlistIndex = (this.playlistIndex - 1 + this.playlist.length) % this.playlist.length;
    } else {
      this.currentIndex = (this.currentIndex - 1 + this.packets.length) % this.packets.length;
    }
    this.renderCurrent();
  }

  setSpeed(ms: number): void {
    this.speed = ms;
    if (this.playing) {
      this.pause();
      this.play();
    }
  }

  // ===== Audio Feedback =====
  async startListening(): Promise<void> {
    this.decoder = new AudioDecoder(
      (received) => { this.handleAudioFeedback(received); },
      this.callbacks.onMicLevel,
      this.callbacks.onAudioDebug
    );
    await this.decoder.start();
  }

  stopListening(): void {
    if (this.decoder) {
      this.decoder.stop();
      this.decoder = null;
    }
  }

  private handleAudioFeedback(received: Set<number>): void {
    const total = this.packets.length;
    if (this.callbacks.onFeedbackReceived) {
      this.callbacks.onFeedbackReceived(received.size, total, received);
    }

    const missing: number[] = [];
    for (let i = 0; i < total; i++) {
      if (!received.has(i)) missing.push(i);
    }

    if (missing.length === 0) {
      this.completed = true;
      this.pause();
      this.stopListening();
      if (this.callbacks.onTransferComplete) {
        this.callbacks.onTransferComplete();
      }
      return;
    }

    this.playlist = missing;
    this.playlistIndex = this.playlistIndex % this.playlist.length;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isListening(): boolean {
    return this.decoder?.isListening ?? false;
  }

  get totalPackets(): number {
    return this.packets.length;
  }

  get remainingCount(): number {
    return this.playlist ? this.playlist.length : this.packets.length;
  }

  destroy(): void {
    this.pause();
    this.stopListening();
    this.packets = [];
    this.currentIndex = 0;
    this.playlist = null;
    this.playlistIndex = 0;
    this.completed = false;
  }
}
