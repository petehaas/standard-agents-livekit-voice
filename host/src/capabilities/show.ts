import { VOICE_PROTOCOL, type ShowMetadata } from '../../../agent/src/voice/protocol.ts';
import type { HostStream } from '../bridge.js';
import { log } from '../log.js';

/** The caller's screen, as the show capability sees it. */
export interface OrderScreen {
  showOrder(payload: string): Promise<string>;
}

/**
 * Serve `livekit.show`: forward the order card to the caller with a LiveKit
 * RPC, then end the stream.
 */
export async function serveShow(stream: HostStream, screen: OrderScreen) {
  const meta = stream.metadata as Partial<ShowMetadata>;
  if (meta.protocol !== VOICE_PROTOCOL) throw new Error(`Unsupported voice protocol ${String(meta.protocol)}.`);
  if (!meta.card || typeof meta.card !== 'object') throw new Error('Show needs an order card.');

  const orderNumber = typeof meta.card.orderNumber === 'string' ? meta.card.orderNumber : 'unknown';
  log.info('show', `order ${orderNumber}`);
  const response = await screen.showOrder(JSON.stringify(meta.card));
  log.info('show', `caller answered ${response}`);
}
