import { describe, it, expect } from 'vitest';

describe('ggwave loopback', () => {
  it('encodes and decodes using single instance (like README)', async () => {
    const ggwave_factory = (await import('ggwave')).default;
    const ggwave = await ggwave_factory();

    // Single instance, default params (like the README example)
    const params = ggwave.getDefaultParameters();
    const instance = ggwave.init(params);

    const payload = 'QRT:42:100';
    const waveform = ggwave.encode(
      instance, payload,
      ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 10
    );

    console.log(`Waveform: ${waveform.constructor.name}, length=${waveform.length}, first 5: [${Array.from(waveform.slice(0, 5))}]`);
    console.log(`Min: ${Math.min(...waveform.slice(0, 1000))}, Max: ${Math.max(...waveform.slice(0, 1000))}`);

    // Direct decode (same instance, raw waveform — like README)
    const result = ggwave.decode(instance, waveform);
    console.log(`Direct result: ${result ? `length=${result.length}, type=${result.constructor.name}` : 'null'}`);

    if (result && result.length > 0) {
      const text = new TextDecoder().decode(result);
      console.log(`Decoded: "${text}"`);
      expect(text).toBe(payload);
    } else {
      // Try chunked decode
      console.log('Direct failed, trying chunked...');

      const instance2 = ggwave.init(ggwave.getDefaultParameters());
      let decoded: string | null = null;

      for (let offset = 0; offset < waveform.length; offset += 1024) {
        const end = Math.min(offset + 1024, waveform.length);
        const chunk = waveform.slice(offset, end);
        const res = ggwave.decode(instance2, chunk);
        if (res && res.length > 0) {
          decoded = new TextDecoder().decode(res);
          console.log(`Chunked decode at offset ${offset}: "${decoded}"`);
          break;
        }
      }

      ggwave.free(instance2);
      expect(decoded).toBe(payload);
    }

    ggwave.free(instance);
  });
});
