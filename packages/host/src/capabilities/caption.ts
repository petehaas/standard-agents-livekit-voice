import { VOICE_PROTOCOL, type CaptionMetadata } from 'standardagent-livekit-voice/protocol';
import type { HostStream } from '../bridge.js';
import type { CallEvents, TurnClock } from '../events.js';

/** Serve `livekit.caption`: forward the caller's transcript to their screen, then end the stream. */
export async function serveCaption(stream: HostStream, events: CallEvents, clock?: TurnClock) {
  const meta = stream.metadata as Partial<CaptionMetadata>;
  if (meta.protocol !== VOICE_PROTOCOL) throw new Error(`Unsupported voice protocol ${String(meta.protocol)}.`);
  if (typeof meta.text !== 'string' || !meta.text.trim()) return;
  clock?.noteStt(typeof meta.sttMs === 'number' ? meta.sttMs : undefined);
  events.emit({ type: 'caption', role: 'caller', text: meta.text.slice(0, 500) });
}
