import './styles.css';
import { Sender } from './sender';
import { Receiver } from './receiver';
import { formatFileSize, TransferMetadata } from './protocol';

// ===== DOM Elements =====
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const tabSend = $<HTMLButtonElement>('tab-send');
const tabReceive = $<HTMLButtonElement>('tab-receive');
const sendPanel = $('send-panel');
const receivePanel = $('receive-panel');

// Send mode toggle
const modeFile = $<HTMLButtonElement>('mode-file');
const modeText = $<HTMLButtonElement>('mode-text');
const textInputZone = $('text-input-zone');
const textInput = $<HTMLTextAreaElement>('text-input');
const textCharCount = $('text-char-count');
const btnGenerateQR = $<HTMLButtonElement>('btn-generate-qr');

// Audio feedback toggles
const sendAudioEnabled = $<HTMLInputElement>('send-audio-enabled');
const recvAudioEnabled = $<HTMLInputElement>('recv-audio-enabled');
const audioIndicator = $('audio-feedback-indicator');
const audioIndicatorText = $('audio-indicator-text');
const audioIndicatorDetail = $('audio-indicator-detail');

// Send elements
const dropZone = $('drop-zone');
const fileInput = $<HTMLInputElement>('file-input');
const sendActive = $('send-active');
const fileName = $('file-name');
const fileSize = $('file-size');
const chunkCount = $('chunk-count');
const chunkSizeSlider = $<HTMLInputElement>('chunk-size');
const chunkSizeVal = $('chunk-size-val');
const speedSlider = $<HTMLInputElement>('speed');
const speedVal = $('speed-val');
const qrCanvas = $<HTMLCanvasElement>('qr-canvas');
const qrOverlay = $('qr-overlay');
const sendCurrent = $('send-current');
const sendTotal = $('send-total');
const sendProgress = $('send-progress');
const btnPrev = $<HTMLButtonElement>('btn-prev');
const btnPlay = $<HTMLButtonElement>('btn-play');
const btnNext = $<HTMLButtonElement>('btn-next');
const iconPlay = $('icon-play');
const iconPause = $('icon-pause');
const playLabel = $('play-label');

// Receive elements
const receiveIdle = $('receive-idle');
const receiveActive = $('receive-active');
const btnStartScan = $<HTMLButtonElement>('btn-start-scan');
const btnStopScan = $<HTMLButtonElement>('btn-stop-scan');
const btnResetScan = $<HTMLButtonElement>('btn-reset-scan');
const cameraVideo = $<HTMLVideoElement>('camera');
const scanCanvas = $<HTMLCanvasElement>('scan-canvas');
const scanIndicator = $('scan-indicator');
const recvInfo = $('recv-info');
const recvFilename = $('recv-filename');
const recvFilesize = $('recv-filesize');
const recvCurrent = $('recv-current');
const recvTotal = $('recv-total');
const recvProgress = $('recv-progress');
const chunkGrid = $('chunk-grid');
const receiveComplete = $('receive-complete');
const recvSummary = $('recv-summary');
const recvCrc = $('recv-crc');
const btnDownload = $<HTMLButtonElement>('btn-download');
const textResult = $('text-result');
const textContent = $<HTMLPreElement>('text-content');
const btnCopy = $<HTMLButtonElement>('btn-copy');
const copyLabel = $('copy-label');

// ===== State =====
let sender: Sender | null = null;
let receiver: Receiver | null = null;
let currentFile: File | null = null;
let currentText: string | null = null;
let sendMode: 'file' | 'text' = 'file';
let downloadBlob: Blob | null = null;
let downloadFilename = '';
let receivedText: string | null = null;
let receivedFileData: Uint8Array | null = null;
let receivedFilename = '';

// ===== Tab Switching =====
function switchTab(tab: 'send' | 'receive') {
  tabSend.classList.toggle('active', tab === 'send');
  tabReceive.classList.toggle('active', tab === 'receive');
  sendPanel.classList.toggle('active', tab === 'send');
  receivePanel.classList.toggle('active', tab === 'receive');
}

tabSend.addEventListener('click', () => switchTab('send'));
tabReceive.addEventListener('click', () => switchTab('receive'));

// ===== Send: Mode Toggle =====
function switchSendMode(mode: 'file' | 'text') {
  sendMode = mode;
  modeFile.classList.toggle('active', mode === 'file');
  modeText.classList.toggle('active', mode === 'text');

  // Reset active send display when switching modes
  if (sender) {
    sender.destroy();
    sender = null;
  }
  sendActive.classList.add('hidden');

  if (mode === 'file') {
    dropZone.classList.remove('hidden');
    textInputZone.classList.add('hidden');
  } else {
    dropZone.classList.add('hidden');
    textInputZone.classList.remove('hidden');
    textInput.focus();
  }
}

modeFile.addEventListener('click', () => switchSendMode('file'));
modeText.addEventListener('click', () => switchSendMode('text'));

// ===== Send: Text Input =====
textInput.addEventListener('input', () => {
  textCharCount.textContent = `${textInput.value.length} characters`;
});

btnGenerateQR.addEventListener('click', () => handleText(textInput.value));

async function handleText(text: string) {
  if (!text.trim()) return;
  currentText = text;
  currentFile = null;

  if (sender) sender.destroy();

  sender = new Sender(qrCanvas, {
    onReady: (total) => {
      textInputZone.classList.add('hidden');
      sendActive.classList.remove('hidden');
      fileName.textContent = 'Text snippet';
      fileSize.textContent = formatFileSize(new TextEncoder().encode(text).length);
      chunkCount.textContent = `${total} chunk${total > 1 ? 's' : ''}`;
      sendTotal.textContent = String(total);
      sendCurrent.textContent = '1';
      sendProgress.style.width = `${(1 / total) * 100}%`;
      if (total === 1) {
        qrOverlay.classList.add('hidden');
      } else {
        qrOverlay.classList.remove('hidden');
      }
      updatePlayButton();
    },
    onProgress: (current, total) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
      sendProgress.style.width = `${((current + 1) / total) * 100}%`;
    },
  });

  const chunkSize = parseInt(chunkSizeSlider.value);
  await sender.loadText(text, chunkSize);

  // Auto-play if multiple chunks
  if (sender.totalPackets > 1) {
    qrOverlay.classList.add('hidden');
    sender.play();
    updatePlayButton();
  }
}

// ===== Send: File Selection =====
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) {
    handleFile(fileInput.files[0]);
  }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files[0]) {
    handleFile(e.dataTransfer.files[0]);
  }
});

async function handleFile(file: File) {
  currentFile = file;

  if (sender) {
    sender.destroy();
  }

  sender = new Sender(qrCanvas, {
    onReady: (total) => {
      dropZone.classList.add('hidden');
      sendActive.classList.remove('hidden');
      fileName.textContent = file.name;
      fileSize.textContent = formatFileSize(file.size);
      chunkCount.textContent = `${total} chunks`;
      sendTotal.textContent = String(total);
      sendCurrent.textContent = '1';
      sendProgress.style.width = `${(1 / total) * 100}%`;
      qrOverlay.classList.remove('hidden');
      updatePlayButton();
    },
    onProgress: (current, total) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
      sendProgress.style.width = `${((current + 1) / total) * 100}%`;
    },
    onFeedbackReceived: (received, total) => {
      chunkCount.textContent = `${total - received} remaining`;
      audioIndicatorText.textContent = 'Feedback received!';
      audioIndicatorDetail.textContent = `${received}/${total}`;
      audioIndicator.classList.add('received');
      setTimeout(() => audioIndicator.classList.remove('received'), 600);
    },
    onTransferComplete: () => {
      chunkCount.textContent = 'Transfer complete!';
      audioIndicatorText.textContent = 'All chunks confirmed!';
      audioIndicatorDetail.textContent = '';
      audioIndicator.classList.add('received');
    },
    onMicLevel: (level) => {
      // Show mic activity level — helps debug audio feedback issues
      if (!audioIndicator.classList.contains('hidden')) {
        const pct = Math.min(100, Math.round(level * 1000));
        const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
        audioIndicatorDetail.textContent = `Mic: ${bar} ${pct}%`;
      }
    },
  });

  const chunkSize = parseInt(chunkSizeSlider.value);
  await sender.loadFile(file, chunkSize);
}

// ===== Send: Controls =====
btnPlay.addEventListener('click', async () => {
  if (!sender) return;
  if (sender.isPlaying) {
    sender.pause();
  } else {
    qrOverlay.classList.add('hidden');
    // Start audio feedback listening if enabled
    if (sendAudioEnabled.checked && !sender.isListening) {
      try {
        await sender.startListening();
        audioIndicator.classList.remove('hidden');
        audioIndicatorText.textContent = 'Listening for audio feedback...';
        audioIndicatorDetail.textContent = '';
      } catch { /* mic optional */ }
    }
    sender.play();
  }
  updatePlayButton();
});

btnPrev.addEventListener('click', () => {
  if (!sender) return;
  qrOverlay.classList.add('hidden');
  sender.prev();
});

btnNext.addEventListener('click', () => {
  if (!sender) return;
  qrOverlay.classList.add('hidden');
  sender.next();
});

function updatePlayButton() {
  if (!sender) return;
  const playing = sender.isPlaying;
  iconPlay.classList.toggle('hidden', playing);
  iconPause.classList.toggle('hidden', !playing);
  playLabel.textContent = playing ? 'Pause' : 'Play';
}

// ===== Send: Settings =====
chunkSizeSlider.addEventListener('input', () => {
  chunkSizeVal.textContent = `${chunkSizeSlider.value} B`;
});

chunkSizeSlider.addEventListener('change', async () => {
  if (!sender) return;
  if (!currentFile && !currentText) return;
  sender.destroy();
  sender = new Sender(qrCanvas, {
    onReady: (total) => {
      chunkCount.textContent = `${total} chunk${total > 1 ? 's' : ''}`;
      sendTotal.textContent = String(total);
      sendCurrent.textContent = '1';
      sendProgress.style.width = `${(1 / total) * 100}%`;
      qrOverlay.classList.remove('hidden');
      updatePlayButton();
    },
    onProgress: (current, total) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
      sendProgress.style.width = `${((current + 1) / total) * 100}%`;
    },
  });
  const cs = parseInt(chunkSizeSlider.value);
  if (currentFile) {
    await sender.loadFile(currentFile, cs);
  } else if (currentText) {
    await sender.loadText(currentText, cs);
  }
});

speedSlider.addEventListener('input', () => {
  speedVal.textContent = `${speedSlider.value} ms`;
  if (sender) {
    sender.setSpeed(parseInt(speedSlider.value));
  }
});

// ===== Receive: Camera =====
let scanFlashTimeout: number | null = null;

btnStartScan.addEventListener('click', async () => {
  receiveIdle.classList.add('hidden');
  receiveActive.classList.remove('hidden');
  receiveComplete.classList.add('hidden');
  recvInfo.classList.add('hidden');

  receiver = new Receiver(cameraVideo, scanCanvas, {
    onChunkReceived: (index, total, received) => {
      recvInfo.classList.remove('hidden');

      // Update filename from chunk 0
      if (index === 0) {
        // We need to get metadata from the receiver... let's read it from the DOM update
      }

      recvCurrent.textContent = String(received);
      recvTotal.textContent = String(total);
      recvProgress.style.width = `${(received / total) * 100}%`;

      // Update chunk grid
      updateChunkGrid(total, receiver!.receivedChunks);

      // Flash indicator
      scanIndicator.classList.remove('hidden');
      if (scanFlashTimeout) clearTimeout(scanFlashTimeout);
      scanFlashTimeout = window.setTimeout(() => {
        scanIndicator.classList.add('hidden');
      }, 500);
    },
    onComplete: (data, metadata) => {
      showComplete(data, metadata);
    },
    onError: (error) => {
      showError(error);
    },
  });

  try {
    await receiver.start();
    if (recvAudioEnabled.checked) {
      receiver.startAudioFeedback();
    }
  } catch (err) {
    showError(`Camera access denied: ${err}`);
    receiveIdle.classList.remove('hidden');
    receiveActive.classList.add('hidden');
  }
});

btnStopScan.addEventListener('click', () => {
  if (receiver) {
    receiver.stop();
  }
  receiveIdle.classList.remove('hidden');
  receiveActive.classList.add('hidden');
});

btnResetScan.addEventListener('click', () => {
  if (receiver) {
    receiver.reset();
  }
  recvInfo.classList.add('hidden');
  receiveComplete.classList.add('hidden');
  chunkGrid.innerHTML = '';
  recvCurrent.textContent = '0';
  recvTotal.textContent = '0';
  recvProgress.style.width = '0%';

  // Restart
  btnStartScan.click();
});

function updateChunkGrid(total: number, received: Set<number>) {
  if (chunkGrid.children.length !== total) {
    chunkGrid.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const cell = document.createElement('div');
      cell.className = 'chunk-cell';
      cell.title = `Chunk ${i}`;
      chunkGrid.appendChild(cell);
    }
  }

  const cells = chunkGrid.children;
  for (let i = 0; i < total; i++) {
    const cell = cells[i] as HTMLElement;
    if (received.has(i) && !cell.classList.contains('received')) {
      cell.classList.add('received', 'just-received');
      setTimeout(() => cell.classList.remove('just-received'), 400);
    }
  }

  // Update filename/size from first chunk
  if (received.has(0)) {
    // Parse info from receiver state — we read the filename from the first packet
    const firstCell = chunkGrid.querySelector('.chunk-cell');
    if (firstCell && recvFilename.textContent === '-') {
      // The metadata is in the assembled chunks; we need another way
      // Let's try to get it from the chunk data
    }
  }
}

function showComplete(data: Uint8Array, metadata: TransferMetadata) {
  receiveComplete.classList.remove('hidden');
  recvInfo.classList.remove('hidden');
  recvCrc.textContent = `CRC32: ${metadata.hash}`;

  // Hide camera
  const cameraWrapper = receiveActive.querySelector('.camera-wrapper') as HTMLElement;
  if (cameraWrapper) cameraWrapper.classList.add('hidden');
  const recvControls = receiveActive.querySelector('.receive-controls') as HTMLElement;
  if (recvControls) recvControls.classList.add('hidden');

  if (metadata.type === 'text') {
    const text = new TextDecoder().decode(data);
    receivedText = text;
    recvFilename.textContent = 'Text snippet';
    recvFilesize.textContent = formatFileSize(metadata.fileSize);
    recvSummary.textContent = `Text (${formatFileSize(metadata.fileSize)})`;
    textResult.classList.remove('hidden');
    textContent.textContent = text;
    btnDownload.classList.add('hidden');
  } else {
    receivedText = null;
    receivedFileData = data;
    receivedFilename = metadata.filename;
    recvFilename.textContent = metadata.filename;
    recvFilesize.textContent = formatFileSize(metadata.fileSize);
    recvSummary.textContent = `${metadata.filename} (${formatFileSize(metadata.fileSize)})`;
    textResult.classList.add('hidden');
    btnDownload.classList.remove('hidden');
    downloadBlob = new Blob([data as unknown as BlobPart]);
    downloadFilename = metadata.filename;
  }
}

// ===== Receive: Copy & Re-send =====
btnCopy.addEventListener('click', async () => {
  if (!receivedText) return;
  try {
    await navigator.clipboard.writeText(receivedText);
    copyLabel.textContent = 'Copied!';
    setTimeout(() => { copyLabel.textContent = 'Copy to Clipboard'; }, 2000);
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = receivedText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyLabel.textContent = 'Copied!';
    setTimeout(() => { copyLabel.textContent = 'Copy to Clipboard'; }, 2000);
  }
});

const btnResend = $<HTMLButtonElement>('btn-resend');
btnResend.addEventListener('click', async () => {
  if (receivedText) {
    switchTab('send');
    switchSendMode('text');
    textInput.value = receivedText;
    textCharCount.textContent = `${receivedText.length} characters`;
    handleText(receivedText);
  } else if (receivedFileData) {
    // Create a File object from received data and send it
    const file = new File([receivedFileData as unknown as BlobPart], receivedFilename);
    switchTab('send');
    switchSendMode('file');
    await handleFile(file);
  }
});

// ===== Receive: New Transfer =====
const btnReceiveNew = $<HTMLButtonElement>('btn-receive-new');
btnReceiveNew.addEventListener('click', () => {
  if (receiver) receiver.reset();
  // Reset UI
  recvInfo.classList.add('hidden');
  receiveComplete.classList.add('hidden');
  textResult.classList.add('hidden');
  chunkGrid.innerHTML = '';
  recvCurrent.textContent = '0';
  recvTotal.textContent = '0';
  recvProgress.style.width = '0%';
  recvFilename.textContent = '-';
  recvFilesize.textContent = '-';
  // Show camera and controls again
  const cameraWrapper = receiveActive.querySelector('.camera-wrapper') as HTMLElement;
  if (cameraWrapper) cameraWrapper.classList.remove('hidden');
  const recvControls = receiveActive.querySelector('.receive-controls') as HTMLElement;
  if (recvControls) recvControls.classList.remove('hidden');
  // Restart scanning
  btnStartScan.click();
});

btnDownload.addEventListener('click', () => {
  if (!downloadBlob) return;
  const url = URL.createObjectURL(downloadBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

function showError(message: string) {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// ===== Camera Flip (Receive) =====
const btnFlipCam = $<HTMLButtonElement>('btn-flip-cam');
btnFlipCam.addEventListener('click', () => {
  if (receiver) receiver.flipCamera();
});

