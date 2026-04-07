# QR Transfer

Offline file transfer via QR codes. One single HTML file — no server, no cloud, no tracking.

**[Try it live](https://aiondadotcom.github.io/qrtransfer/)** | [Download HTML](https://github.com/AiondaDotCom/qrtransfer/releases/latest)

## How it works

1. Open `index.html` on both devices (sender and receiver)
2. **Sender**: Select a file → QR codes are generated and displayed in sequence
3. **Receiver**: Start camera → point at sender's screen → chunks are scanned automatically
4. When all chunks are received, the file is assembled with CRC32 integrity check and offered for download

## Features

- **Single HTML file** — everything bundled, works offline
- **No server required** — runs entirely in the browser
- **CRC32 integrity check** — detects corrupted transfers
- **Gzip compression** — reduces transfer size
- **Configurable chunk size and speed** — tune for your setup
- **Visual chunk grid** — see transfer progress in real-time
- **Drag & drop** file selection
- **Responsive** — works on desktop and mobile

## Quick Start

Download `dist/index.html` and open it in any modern browser. That's it.

## Development

```bash
npm install
npm run dev      # Start dev server
npm test         # Run unit tests
npm run build    # Build single HTML file to dist/
```

## Protocol

Files are compressed (gzip level 9), base64-encoded, and split into chunks. Each chunk becomes a QR code containing a JSON packet:

```json
{
  "v": 1,           // protocol version
  "i": 0,           // chunk index
  "t": 50,          // total chunks
  "n": "file.pdf",  // filename (chunk 0 only)
  "s": 123456,      // file size in bytes (chunk 0 only)
  "h": "a1b2c3d4",  // CRC32 hex of original file (chunk 0 only)
  "d": "base64..."  // chunk data
}
```

The receiver collects chunks in any order, reassembles, decompresses, and verifies the CRC32 checksum.

## Recommended file sizes

| Size | Transfer time (est.) | Experience |
|------|---------------------|------------|
| < 10 KB | seconds | Instant |
| 10-100 KB | 1-5 min | Comfortable |
| 100 KB - 1 MB | 5-30 min | Feasible |
| > 1 MB | 30+ min | Use only as last resort |

## Tech Stack

- TypeScript
- Vite + vite-plugin-singlefile
- [qrcode](https://www.npmjs.com/package/qrcode) — QR generation
- [jsQR](https://www.npmjs.com/package/jsqr) — QR scanning
- [pako](https://www.npmjs.com/package/pako) — gzip compression
- [Vitest](https://vitest.dev/) — unit testing

## License

MIT
