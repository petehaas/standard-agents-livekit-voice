# @petehaas/standard-agents-livekit-host

An independent project, not affiliated with Standard Agents or LiveKit.

An execution host that connects a [Standard Agent Specification](https://standardagentspec.org) 0.2.0 thread to a [LiveKit](https://livekit.io) room. It serves the `livekit.*` runtime-stream capabilities from [`@petehaas/standard-agents-livekit-voice`](../voice). It plays the agent's audio into the room and runs Silero voice activity detection on the caller's mic. It also decides where the caller's turn ends and handles barge-in.

```bash
npm install @petehaas/standard-agents-livekit-host
```

## Start a call

```ts
import { resolveToken, startVoiceHost } from '@petehaas/standard-agents-livekit-host';

const baseUrl = 'http://127.0.0.1:5173';
const host = await startVoiceHost({
  runtime: { baseUrl, apiKey: await resolveToken(baseUrl) },
  agentId: 'my_voice_agent',
  threadEnv: { VOICE_TTS_PROVIDER: 'deepgram' },   // choices only, never keys
  livekit: { url: 'wss://…livekit.cloud', apiKey: 'API…', apiSecret: '…', room: 'support-1' },
  agentName: 'Support',
  onEnd: (reason) => console.log('call ended:', reason),
});

const callerToken = await host.callerToken();   // microphone-only; give it to the caller's page
await host.callerConnected;                     // the agent now drives the call
```

The caller's page joins the room with that token. It can register a LiveKit RPC method `show_card` to receive cards, and listen on the `sa-voice.events` data topic for captions and timing. Both are optional.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `vad.threshold` | `0.5` | Silero speech probability |
| `vad.marginDb`, `vad.minSpeechDb` | `12`, `-48` | loudness fallback when Silero cannot load |
| `turn.minSpeechMs`, `turn.prerollMs` | `240`, `300` | shortest real turn; audio kept from before speech starts |
| `bargeIn.bargeInEnabled`, `bargeIn.bargeInMs` | `true`, `480` | whether and how fast caller speech cuts the agent off |

The lower-level pieces are exported too: `ExecutionHostBridge`, `serveSpeak`, `serveListen`, `MicTap`, `SileroVad`, and others.

## Runtime support

The spec defines runtime streams from the agent's side, but not yet how an execution host attaches to a runtime. This host attaches the way Standard Agents Builder does, described in [docs/bridge-protocol.md](../../docs/bridge-protocol.md). Terms such as "execution owner", "bridge", and the `media_host` client kind are Builder's, not the spec's. Another runtime needs its own attach step; the capability handlers (`serveSpeak`, `serveListen`, and the rest) don't depend on it.

Node 22+. Includes [Silero VAD](https://github.com/snakers4/silero-vad) (`models/silero_vad.onnx`, MIT). MIT license.
