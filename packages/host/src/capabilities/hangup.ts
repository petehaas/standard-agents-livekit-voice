import type { HangupMetadata } from 'standardagent-livekit-voice/protocol';
import type { HostStream } from '../bridge.js';
import { log } from '../log.js';

/** Serve `livekit.hangup`: acknowledge at once, then leave the room. */
export async function serveHangup(stream: HostStream, onHangup: (reason: string) => void) {
  const meta = stream.metadata as Partial<HangupMetadata>;
  const reason = typeof meta.reason === 'string' ? meta.reason : 'The agent ended the call.';
  log.info('hangup', reason);
  // Let the stream end first, so the runtime's turn finishes cleanly.
  setTimeout(() => onHangup(reason), 0);
}
