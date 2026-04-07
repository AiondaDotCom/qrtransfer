import QRCode from 'qrcode';
import { createChunks, createTextChunks, serializePacket, ChunkPacket } from './protocol';
import { AudioDecoder } from './audio-modem';

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
  private callbacks: SmartSenderCallbacks;
  private decoder: AudioDecoder | null = null;
  private completed = false;

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: SmartSenderCallbacks
  ) {
    this.canvas = canvas;
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

  async startListening(): Promise<void> {
    this.decoder = new AudioDecoder((received, _totalChunks) => {
      this.handleAudioFeedback(received);
    });
    await this.decoder.start();
  }

  private handleAudioFeedback(received: Set<number>): void {
    const total = this.packets.length;
    this.callbacks.onFeedbackReceived(received.size, total);

    const missing: number[] = [];
    for (let i = 0; i < total; i++) {
      if (!received.has(i)) missing.push(i);
    }

    if (missing.length === 0) {
      this.completed = true;
      this.pause();
      this.stopListening();
      this.callbacks.onComplete();
      return;
    }

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

  stopListening(): void {
    if (this.decoder) {
      this.decoder.stop();
      this.decoder = null;
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
    this.stopListening();
    this.packets = [];
    this.playlist = [];
    this.playlistIndex = 0;
    this.completed = false;
  }
}
