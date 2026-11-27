# @petehaas/standard-agents-livekit-voice

The runtime side of a voice call for agents built on the [Standard Agent Specification](https://standardagentspec.org) 0.2.0. An independent project, not affiliated with Standard Agents or LiveKit. A side B handler speaks each side A reply and listens for the caller's answer, all through `state.runtimeStreams`. It never touches LiveKit. An execution host such as [`@petehaas/standard-agents-livekit-host`](../host) answers the streams.

```bash
npm install @petehaas/standard-agents-livekit-voice
```

## Use it in an agent

```ts
// agents/handlers/voice_caller.ts
import { defineHandler } from '@standardagents/spec';
import { voiceCallerHandler } from '@petehaas/standard-agents-livekit-voice';
export default defineHandler(voiceCallerHandler());

// agents/tools/end_call.ts
import { defineTool } from '@standardagents/spec';
import { endCallTool } from '@petehaas/standard-agents-livekit-voice';
export default defineTool(endCallTool);

// agents/agents/my_voice_agent.ts
export default defineAgent({
  name: 'my_voice_agent',
  sideA: { prompt: 'my_prompt', stopOnResponse: true },   // tools: ['end_call', ...]
  sideB: { handler: 'voice_caller' },
  env: { VOICE_STT_PROVIDER: 'openai', VOICE_TTS_PROVIDER: 'openai', VOICE_STT_LANGUAGE: 'en' },
});
```

The package exports option objects, not finished definitions, so your own files still read `export default defineHandler(...)` and `defineTool(...)`. Some runtimes check that statically.

Side A's prompt should know three tokens the handler sends: `[caller connected]` (the first message), `[no response]` (silence), and `[unintelligible]` (sound with no words).

To put a card on the caller's screen from a tool, call `showCard(state.runtimeStreams, card)`.

## Configuration

Read from thread env through `state.env()`:

| Variable | Values |
| --- | --- |
| `VOICE_STT_PROVIDER` | `openai` (default), `deepgram` (live transcription while the caller talks) |
| `VOICE_TTS_PROVIDER` | `openai` (default), `deepgram`, `elevenlabs` |
| `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | provider keys |
| `VOICE_STT_LANGUAGE`, `VOICE_STT_KEYTERMS` | language hint, comma-separated words to expect |
| `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_TTS_INSTRUCTIONS`, `DEEPGRAM_MODEL`, `DEEPGRAM_TTS_MODEL`, `ELEVENLABS_MODEL` | model and voice overrides |

Or pass your own providers: `voiceCallerHandler({ loadVoice: async (state) => ({ stt, tts }) })`.

## The protocol

`@petehaas/standard-agents-livekit-voice/protocol` has no dependencies. It defines the capability names (`livekit.speak`, `livekit.listen`, `livekit.show`, `livekit.caption`, `livekit.hangup`), the metadata for each, and the audio format: 16-bit mono PCM, 24 kHz out and 16 kHz in. Any host that serves these capabilities works with this package.

## Requirements

A runtime that implements runtime streams (`ThreadState.runtimeStreams`, Standard Agent Specification 0.2.0), with `fetch` and `WebSocket` available. Tested on Standard Agents Builder (Cloudflare Workers) and in Node 22+.

This is a helper library, not a packed agent package, so it doesn't carry the spec's `standardagent` keyword. Your agent package does.

MIT license.
