# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

QR Transfer — offline file transfer via QR codes. Builds into a **single self-contained HTML file** (no server, no external assets). Hosted at https://qr.aionda.com.

## Commands

```bash
npm run dev          # Vite dev server (root is src/)
npm run build        # tsc + vite build → dist/index.html (single file)
npm test             # vitest run
npm run test:watch   # vitest watch mode
npm test -- --grep "crc32"  # run specific test by pattern
```

## Build & Deploy

The `vite-plugin-singlefile` plugin inlines all JS and CSS into `dist/index.html`. Vite root is `src/`, output goes to `dist/`.

Deployment is manual: build, then copy `dist/index.html` to the `gh-pages` branch and push. The `gh-pages` branch has a `CNAME` file pointing to `qr.aionda.com` (Cloudflare proxy enabled).

## Architecture

**Data flow (send):** File → `protocol.createChunks()` (gzip + base64 + split) → `Sender` renders QR codes to canvas via `qrcode` lib → auto-cycles through chunks.

**Data flow (receive):** Camera → `Receiver.scanLoop()` (requestAnimationFrame + `jsqr`) → `protocol.parsePacket()` → accumulate in Map → `protocol.assembleChunks()` (concat + decompress + CRC32 verify) → download.

**Key files:**
- `src/protocol.ts` — chunking, compression (pako), CRC32, serialization. All data logic lives here.
- `src/sender.ts` — `Sender` class: loads file, generates QR codes, play/pause/prev/next.
- `src/receiver.ts` — `Receiver` class: camera access, scan loop, chunk collection, auto-assembly on completion.
- `src/main.ts` — DOM wiring: tabs, drag-drop, sliders, progress bars, chunk grid visualization. Instantiates Sender/Receiver with callbacks.
- `src/index.html` — full HTML structure (header, send panel, receive panel).
- `src/styles.css` — dark theme UI.

**Protocol format (JSON per QR code):**
- Chunk 0 carries metadata: filename (`n`), file size (`s`), CRC32 hash (`h`)
- All chunks carry: version (`v`=1), index (`i`), total (`t`), base64 data (`d`)
- Chunks can be scanned in any order; receiver assembles by index

## Testing

Tests cover `protocol.ts` only (33 tests): CRC32, base64, compression, chunking, serialization, assembly, error detection (missing chunks, CRC mismatch, size mismatch), and end-to-end round-trips. Sender/Receiver are not unit-tested (they require DOM/camera).

Note: test data must not compress too well or you get single-chunk results. Use pseudo-random patterns like `(i * 137 + 83) % 256`.
