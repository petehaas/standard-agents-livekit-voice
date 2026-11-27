import { VOICE_PROTOCOL, type ShowMetadata } from '@petehaas/standard-agents-livekit-voice/protocol';
import type { HostStream } from '../bridge.js';
import { log } from '../log.js';

/** The caller's screen, as the show capability sees it. */
export interface CardScreen {
  showCard(payload: string): Promise<string>;
}

/**
 * Serve `livekit.show`: forward the card to the caller with a LiveKit
 * RPC, then end the stream.
 */
export async function serveShow(stream: HostStream, screen: CardScreen) {
  const meta = stream.metadata as Partial<ShowMetadata>;
  if (meta.protocol !== VOICE_PROTOCOL) throw new Error(`Unsupported voice protocol ${String(meta.protocol)}.`);
  if (!meta.card || typeof meta.card !== 'object') throw new Error('Show needs a card object.');

  log.info('show', `card ${Object.keys(meta.card).slice(0, 4).join(', ')}`);
  const response = await screen.showCard(JSON.stringify(meta.card));
  log.info('show', `caller answered ${response}`);
}
