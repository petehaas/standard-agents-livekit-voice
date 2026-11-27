/**
 * Call events for the caller's screen: captions, presence, and the
 * voice-to-voice latency of each turn. Sent as LiveKit data packets on
 * CALL_EVENTS_TOPIC. Purely cosmetic; nothing in the call depends on them.
 */
export type CallEvent =
  | { type: 'caption'; role: 'agent' | 'caller'; text: string }
  | { type: 'latency'; responseMs: number; sttMs?: number }
  | { type: 'interrupted'; heardMs: number };

export interface CallEvents {
  emit(event: CallEvent): void;
}

/**
 * Measures the gap the caller actually feels: from the end of their turn
 * (the host's endpointing decision) to the first agent audio frame played.
 * That span covers STT, the reply model, and TTS time to first byte.
 */
export class TurnClock {
  private endedAt: number | null = null;
  private sttMs: number | undefined;

  callerFinished() {
    this.endedAt = Date.now();
    this.sttMs = undefined;
  }

  noteStt(ms: number | undefined) {
    this.sttMs = ms;
  }

  /** Returns the latency once, on the first audio after a caller turn. */
  agentStarted(): { responseMs: number; sttMs?: number } | null {
    if (this.endedAt === null) return null;
    const result = { responseMs: Date.now() - this.endedAt, sttMs: this.sttMs };
    this.endedAt = null;
    return result;
  }
}
