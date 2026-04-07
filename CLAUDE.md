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

**IMPORTANT:** Cloudflare and phone browsers aggressively cache JS. Always bump the version in both `package.json` AND `src/index.html` footer. The user checks the footer version to confirm they have the latest code. The phone may show the new version number but still run old JS — frequency analysis of WAV recordings proved this.

## Architecture

**Data flow (send):** File → `protocol.createChunks()` (gzip + base64 + split) → `Sender` renders QR codes to canvas via `qrcode` lib → auto-cycles through chunks. Also supports text mode (`createTextChunks`).

**Data flow (receive):** Camera → `Receiver.scanLoop()` (requestAnimationFrame + `jsqr`) → `protocol.parsePacket()` → accumulate in Map → `protocol.assembleChunks()` (concat + decompress + CRC32 verify) → download or display text.

**Audio feedback flow:** Receiver → `AudioEncoder` plays FSK tones via speaker → Sender's `AudioDecoder` listens via mic → decodes range → `Sender.handleAudioFeedback()` updates playlist to skip confirmed chunks.

**Calibration flow:** Sender shows QR `{"cal":"low"}` → Receiver plays tone → Sender measures peak frequency → repeat for high tone → `{"cal":"done"}` → modem starts with calibrated frequencies.

**Key files:**
- `src/protocol.ts` — chunking, compression (pako), CRC32, serialization
- `src/sender.ts` — `Sender` class with audio feedback (adaptive playlist) + calibration
- `src/receiver.ts` — `Receiver` class with audio feedback (tone playback) + calibration tone player
- `src/audio-modem.ts` — FSK modem: AudioEncoder, AudioDecoder, CRC-8, Goertzel, CalibrationMic, CalibrationTonePlayer
- `src/feedback.ts` — bitfield encoding/decoding (used by some tests, not by current modem)
- `src/main.ts` — DOM wiring, tabs, settings, chunk grid visualization
- `src/index.html` — HTML structure
- `src/styles.css` — dark theme UI

## Audio Modem ("Bell 202 Pro")

The audio feedback uses FSK (Frequency Shift Keying) to send chunk range data from receiver to sender through air (phone speaker → laptop mic).

**Current parameters (v4.1.0):**
- Frequencies: **2000 Hz** (bit 0) / **3500 Hz** (bit 1) — ratio 1.75, non-harmonic, 1500 Hz apart
- Baud rate: **10 baud** (100ms per bit, 4800 samples at 48kHz for Goertzel)
- Preamble: **4 bytes** (32 alternating bits)
- Sync word: **0xD5** (detected via sliding window)
- Payload: **2 bytes** (start/4 + length = contiguous received range)
- CRC-8 on payload
- No length byte in frame

**Frame format:**
```
[0xAA×4][0xD5][start][length][CRC-8] = 8 bytes = 64 bits = 6.4 seconds
```

- `start`: chunk range start divided by 4 (1 byte, covers chunks 0-1020)
- `length`: number of contiguous chunks (1 byte, max 255)
- Sender skips the confirmed range and shows only missing chunks

**Calibration:**
Before modem starts, sender shows QR codes asking receiver to play calibration tones:
1. `{"cal":"low"}` → receiver plays 2000 Hz in 3-beep pattern (beep-pause-beep-pause-beep)
2. Sender detects 2+ beep transitions, measures peak frequency (±300 Hz sweep, then ±50 Hz fine)
3. `{"cal":"high"}` → same for 3500 Hz
4. `{"cal":"done"}` → receiver starts modem, sender uses measured frequencies for decoder

**Frequency selection — critical lessons:**
- 1200/2400 Hz (Bell 202): harmonically related (2:1) — 2400 is overtone of 1200, cross-contamination
- 1500/4500 Hz: also harmonically related (3:1) — 4500 is 3rd harmonic of 1500, ratio 1.2:1 through speaker
- 600/1050 Hz: too low for laptop speakers, failed
- 1000/1750 Hz: pleasant sound but poor discrimination through laptop speaker→mic
- **2000/3500 Hz: WORKS** — ratio 1.75 (non-integer), both in speaker sweet spot, verified CRC OK through air

**What works (verified through actual speaker→mic air transmission):**
- Empty payload `[0x00,0x00]` → CRC OK ✓
- High water mark `highWater=42` → CRC OK ✓
- Range `start=10,len=38` (chunks 40-77) → CRC OK ✓
- Calibration: measured 998-1004 Hz and 1745-1792 Hz from phone ✓

**What doesn't work reliably yet:**
- Longer payloads (6+ bytes) degrade due to room echo accumulating over frame duration
- iPhone→laptop has lower success rate than laptop→laptop (different speaker characteristics)
- ggwave WASM library failed through speaker→mic despite multiple fix attempts

**Key lessons learned:**
1. Browser audio processing (echoCancellation, autoGainControl, noiseSuppression) DESTROYS FSK signals — must disable in getUserMedia constraints
2. AudioContext sample rate varies by device (44100, 48000) — use `ctx.sampleRate` dynamically
3. Looping audio needs 500ms+ silence gap between frames for decoder to reset
4. ScriptProcessorNode must NOT do heavy processing in callbacks — use ring buffer + setInterval(500ms)
5. Length byte in frame was #1 corruption point — removed, use fixed payload size
6. Non-harmonic frequency pairs are ESSENTIAL — any integer ratio causes cross-contamination
7. Shorter frames = more reliable. 2 bytes payload works, 6 bytes doesn't
8. Phone browser caching is extremely aggressive — WAV frequency analysis proved phone was sending old frequencies despite showing new version
9. ggwave needs 4096+ sample chunks, silence in loops, Int8 format — but still failed through air
10. Self-testing with `play` + `rec` (sox) is the fastest way to verify changes — no phone needed
11. Calibration works: QR-based tone request → 3-beep pattern detection → frequency measurement
12. 10 baud (100ms/bit) with 4800 samples gives Goertzel enough data for reliable frequency detection

**Testing audio changes (self-test without phone):**
```bash
# 1. Generate WAV with modem signal
node /tmp/gen_test.js  # creates /tmp/test.wav

# 2. Play through speaker and record from mic simultaneously
play /tmp/test.wav & rec /tmp/recorded.wav trim 0 15; kill %1

# 3. Decode the recording
node /tmp/decode_test.js  # reads /tmp/recorded.wav
```

This tests the full speaker→air→mic path on the laptop itself. If it decodes here, it should work with phones too (though phone speakers have different characteristics).

## QR Protocol

**Chunk format (JSON per QR code):**
- Chunk 0 metadata: filename (`n`), file size (`s`), CRC32 hash (`h`), type (`tp`: "t" for text)
- All chunks: version (`v`=1), index (`i`), total (`t`), base64 data (`d`)
- Chunks scanned in any order; receiver assembles by index

**Calibration QR codes:** `{"cal":"low"}`, `{"cal":"high"}`, `{"cal":"done"}` — detected by receiver's `handleQRData` before checking for data packets.

**Default settings:** chunk size 300B, speed 100ms

## Testing

91 tests across 3 files:
- `tests/protocol.test.ts` — CRC32, base64, compression, chunking, assembly, text mode
- `tests/feedback.test.ts` — bitfield encoding/decoding, feedback packets
- `tests/audio-modem.test.ts` — CRC-8, frame building/parsing, Goertzel, FSK loopback

Note: test data must not compress too well or you get single-chunk results. Use pseudo-random patterns like `(i * 137 + 83) % 256`.

## Known Issues / TODO

1. Decoder starts twice (two ScriptProcessorNodes created) — need to prevent double `startListening()` call
2. Calibration 3-beep detection sometimes triggers on room noise (threshold=15 may need tuning)
3. Phone→laptop audio decoding is less reliable than laptop→laptop (different speaker frequency response)
4. Transfer should use batch sending (chunks 0-31 repeatedly, then 32-63, etc.) when audio feedback is enabled — this ensures sequential reception which maximizes audio feedback utility

## Legal

Footer must contain Impressum link (https://aionda.com/impressum/) — legally required for German companies with public websites.
