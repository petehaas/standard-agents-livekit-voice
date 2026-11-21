import { defineHandler } from '@standardagents/spec';
import type { TextToSpeech } from '../../src/voice/providers.ts';
import { SPEAK_SAMPLE_RATE } from '../../src/voice/protocol.ts';
import { listen, speak } from '../../src/voice/streams.ts';

/** 600 ms of a quiet 440 Hz tone, in 100 ms chunks. Stands in for a TTS provider. */
const toneTts: TextToSpeech = {
  name: 'tone',
  async synthesize() {
    const samples = new Int16Array(SPEAK_SAMPLE_RATE * 0.6);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.round(2000 * Math.sin((2 * Math.PI * 440 * i) / SPEAK_SAMPLE_RATE));
    }
    const bytes = new Uint8Array(samples.buffer);
    const chunk = (SPEAK_SAMPLE_RATE / 10) * 2;
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + chunk));
        offset += chunk;
      },
    });
  },
};

export default defineHandler({
  description: 'Runs one speak, one listen, and one refused open, then reports the results.',
  execute: async (state, message) => {
    if (message.role !== 'user') return;
    const streams = state.runtimeStreams;
    if (!streams) {
      await state.injectMessage({ role: 'assistant', content: JSON.stringify({ error: 'This runtime has no runtimeStreams.' }) });
      return;
    }

    const spoken = await speak(streams, toneTts, 'probe tone', { bargeIn: false });
    const heard = await listen(streams, { endSilenceMs: 300, noSpeechTimeoutMs: 3_000, maxUtteranceMs: 5_000 });
    const refused = await streams.open({ capability: 'livekit.does_not_exist', timeoutMs: 3_000 });
    if (refused.ok) refused.stream.close();

    await state.injectMessage({
      role: 'assistant',
      content: JSON.stringify({
        speak: spoken,
        listen: heard.ok ? { ok: true, bytes: heard.pcm.byteLength, speechMs: heard.speechMs } : heard,
        unknownCapability: refused.ok ? 'opened (unexpected)' : { code: refused.code, error: refused.error },
      }),
    });
  },
});
