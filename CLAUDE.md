# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

QR Transfer — offline file transfer via QR codes with audio feedback channel. Builds into a **single self-contained HTML file** (no server, no external assets). Hosted at https://qr.aionda.com. GitHub: https://github.com/AiondaDotCom/qrtransfer

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

Deploy workflow:
1. `npm run build`
2. `git checkout gh-pages && yes | cp dist/index.html index.html && git add index.html && git commit -m "message" && git push origin gh-pages && git checkout main`

The `gh-pages` branch has a `CNAME` file pointing to `qr.aionda.com` (Cloudflare proxy enabled). **IMPORTANT:** Cloudflare and phone browsers aggressively cache the JS. Always bump the version in both `package.json` and `src/index.html` footer when deploying. The user checks the version number in the footer to confirm they have the latest code.

## Architecture

**Data flow (send):** File → `protocol.createChunks()` (gzip + base64 + split) → `Sender` renders QR codes to canvas via `qrcode` lib → auto-cycles through chunks. Also supports text mode (`createTextChunks`).

**Data flow (receive):** Camera → `Receiver.scanLoop()` (requestAnimationFrame + `jsqr`) → `protocol.parsePacket()` → accumulate in Map → `protocol.assembleChunks()` (concat + decompress + CRC32 verify) → download or display text.

**Audio feedback flow:** Receiver → `AudioEncoder` plays FSK tones via speaker → Sender's `AudioDecoder` listens via mic → decodes bitfield → `Sender.handleAudioFeedback()` updates playlist to skip confirmed chunks.

**Key files:**
- `src/protocol.ts` — chunking, compression (pako), CRC32, serialization
- `src/sender.ts` — `Sender` class with optional audio feedback (adaptive playlist)
- `src/receiver.ts` — `Receiver` class with optional audio feedback (tone playback)
- `src/audio-modem.ts` — FSK modem: AudioEncoder, AudioDecoder, CRC-8, Goertzel algorithm
- `src/feedback.ts` — bitfield encoding/decoding for audio feedback
- `src/main.ts` — DOM wiring, tabs, settings, chunk grid visualization
- `src/index.html` — HTML structure
- `src/styles.css` — dark theme UI

## Audio Modem ("Bell 202 Pro")

The audio feedback uses FSK (Frequency Shift Keying) to send chunk position data from receiver to sender through air (phone speaker → laptop mic).

**Parameters (hard-won through extensive testing):**
- Frequencies: **1500 Hz** (bit 0) / **4500 Hz** (bit 1) — 3000 Hz apart, non-harmonic
- Baud rate: **10 baud** (100ms per bit, 4800 samples at 48kHz for Goertzel)
- Preamble: **4 bytes** (32 alternating bits for reliable sync lock)
- Sync word: **0xD5** (detected via sliding window for bit-alignment tolerance)
- No length byte (payload is always 6 bytes — eliminates a corruption point)
- CRC-8 on payload

**Frame format:**
```
[0xAA×4][0xD5][offsetHi][offsetLo][bitfield 4B][CRC-8]
= 12 bytes = 96 bits = 9.6 seconds per frame
```

**Sliding window:** The bitfield covers 32 chunks starting at the first missing chunk. As chunks get confirmed, the window slides forward to cover the entire file.

**Key lessons learned during development:**
1. Browser audio processing (echoCancellation, autoGainControl, noiseSuppression) DESTROYS FSK signals — must disable in getUserMedia constraints
2. AudioContext sample rate varies by device (44100, 48000, etc.) — use `ctx.sampleRate` dynamically, never hardcode
3. Looping audio with `source.loop=true` needs silence gap between frames, otherwise decoder can't reset
4. ScriptProcessorNode must NOT do heavy processing in callbacks — use ring buffer + setInterval
5. The length byte in the frame was the #1 corruption point — removed it, use fixed 6-byte payload
6. 1200/2400 Hz (original Bell 202) are harmonically related — 2400 is an overtone of 1200, making discrimination hard. 1500/4500 Hz (non-harmonic, 3000 Hz apart) is much better
7. Slower baud = more reliable. 50 baud had ~30% CRC success, 10 baud should be much better
8. Phone browser JS caching is aggressive — version must be bumped and user must verify footer version
9. ggwave (WASM library) was tried but failed: requires 4096+ sample chunks, looping caused marker collision, and the complexity wasn't worth it for our simple feedback use case
10. WAV file analysis with Node.js is the best debugging tool — record with `rec /tmp/feedback.wav trim 0 30`, then decode offline

**Testing audio changes:**
1. Generate test WAV: create waveform programmatically in Node.js, save as 32-bit PCM WAV at 48000 Hz
2. Decode test WAV: run the exact decoder state machine in Node.js on the WAV data
3. Live test: deploy, load on both devices (check version!), open browser console for `[MODEM]` logs

## QR Protocol

**Chunk format (JSON per QR code):**
- Chunk 0 metadata: filename (`n`), file size (`s`), CRC32 hash (`h`), type (`tp`: "t" for text)
- All chunks: version (`v`=1), index (`i`), total (`t`), base64 data (`d`)
- Chunks scanned in any order; receiver assembles by index

**Default settings:** chunk size 300B, speed 100ms

## Testing

91 tests across 3 files:
- `tests/protocol.test.ts` — CRC32, base64, compression, chunking, assembly, text mode
- `tests/feedback.test.ts` — bitfield encoding/decoding, feedback packets
- `tests/audio-modem.test.ts` — CRC-8, frame building/parsing, Goertzel, FSK loopback

Note: test data must not compress too well or you get single-chunk results. Use pseudo-random patterns like `(i * 137 + 83) % 256`.

## Legal

Footer must contain Impressum link (https://aionda.com/impressum/) — legally required for German companies with public websites.
