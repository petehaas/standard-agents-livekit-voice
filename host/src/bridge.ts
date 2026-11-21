/**
 * A minimal execution host for Standard Agents Builder.
 *
 * It holds the thread's bridge WebSocket, claims execution ownership, and
 * serves runtime streams: when agent code calls `state.runtimeStreams.open()`,
 * the runtime sends `stream_open` here and this client routes it to the
 * handler registered for that capability.
 *
 * The frames below are the Builder's bridge protocol as of
 * @standardagents/builder 0.45.10. The specification does not define this
 * wire format yet; see docs/bridge-protocol.md.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { log } from './log.js';

/** The runtime splits writes at 256 KiB; we do the same. */
const MAX_CHUNK_BYTES = 256 * 1024;
const PING_INTERVAL_MS = 20_000;

type Frame = { type: string; [key: string]: unknown };

/** Host-side view of one runtime stream. */
export interface HostStream {
  readonly id: string;
  readonly capability: string;
  readonly metadata: Record<string, unknown>;
  /** Bytes the runtime writes (runtime → host). Ends when the runtime closes its writable. */
  readonly inbound: AsyncIterable<Uint8Array>;
  /** Fires once if the runtime aborts the stream. */
  readonly aborted: AbortSignal;
  /** Send bytes to the runtime (host → runtime). */
  write(bytes: Uint8Array): void;
  /** Finish the stream successfully. The runtime settles it as `{ ok: true }`. */
  end(): void;
  /** Fail the stream. The runtime settles it as `{ ok: false, error }`. */
  fail(error: string): void;
}

export type CapabilityHandler = (stream: HostStream) => Promise<void>;

export interface BridgeOptions {
  /** Builder base URL, for example http://127.0.0.1:5173 */
  baseUrl: string;
  apiKey: string;
  threadId: string;
  clientId: string;
  clientName: string;
  clientKind: string;
}

/** A queue that turns pushed chunks into an async iterable. */
class ByteQueue implements AsyncIterable<Uint8Array> {
  private chunks: Uint8Array[] = [];
  private waiting: {
    resolve: (result: IteratorResult<Uint8Array>) => void;
    reject: (error: Error) => void;
  } | null = null;
  private ended = false;
  private error: Error | null = null;

  push(chunk: Uint8Array) {
    if (this.ended) return;
    if (this.waiting) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve({ value: chunk, done: false });
    } else {
      this.chunks.push(chunk);
    }
  }

  end(error?: Error) {
    if (this.ended) return;
    this.ended = true;
    this.error = error ?? null;
    if (this.waiting) {
      const { resolve, reject } = this.waiting;
      this.waiting = null;
      if (error) reject(error);
      else resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: () => {
        const chunk = this.chunks.shift();
        if (chunk) return Promise.resolve({ value: chunk, done: false });
        if (this.ended) {
          if (this.error) return Promise.reject(this.error);
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve, reject) => {
          this.waiting = { resolve, reject };
        });
      },
    };
  }
}

interface StreamState {
  queue: ByteQueue;
  abort: AbortController;
  finished: boolean;
}

export class ExecutionHostBridge extends EventEmitter {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, CapabilityHandler>();
  private streams = new Map<string, StreamState>();
  private ping: NodeJS.Timeout | null = null;
  private closing = false;
  private attempt = 0;

  constructor(private readonly options: BridgeOptions) {
    super();
  }

  /** Register the handler for a capability name. */
  serve(capability: string, handler: CapabilityHandler): this {
    this.handlers.set(capability, handler);
    return this;
  }

  /** Open the bridge and resolve once the runtime confirms this client owns execution. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(`/api/threads/${encodeURIComponent(this.options.threadId)}/bridge`, this.options.baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('client_id', this.options.clientId);
      url.searchParams.set('client_name', this.options.clientName);
      url.searchParams.set('client_kind', this.options.clientKind);
      // Take ownership even if an older host for this thread is still connected.
      url.searchParams.set('claim', 'takeover');

      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.options.apiKey}` } });
      this.ws = ws;
      let ready = false;

      ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => reject(new Error(`Bridge refused (${res.statusCode}): ${body.slice(0, 300)}`)));
      });
      ws.on('error', (error) => {
        if (!ready) reject(error);
        else log.warn('bridge', `socket error: ${error.message}`);
      });
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const text = data.toString();
        if (text === 'pong') return;
        let frame: Frame;
        try {
          frame = JSON.parse(text) as Frame;
        } catch {
          return;
        }
        if (frame.type === 'bridge_ready') {
          if (frame.owner !== true) {
            reject(new Error(`Connected, but another client owns this thread (${JSON.stringify(frame.current_owner)}).`));
            ws.close();
            return;
          }
          ready = true;
          this.attempt = 0;
          this.startPing();
          log.info('bridge', `execution owner for thread ${this.options.threadId}`);
          resolve();
          return;
        }
        this.onFrame(frame);
      });
      ws.on('close', (code, reason) => {
        this.stopPing();
        this.failAllStreams('The bridge connection closed.');
        if (this.closing) return;
        if (!ready) {
          reject(new Error(`Bridge closed before ready (${code} ${reason.toString()})`));
          return;
        }
        if (code === 4001) {
          log.warn('bridge', 'superseded by a newer connection from this client; not reconnecting');
          this.emit('superseded');
          return;
        }
        this.reconnect();
      });
    });
  }

  async close() {
    this.closing = true;
    this.stopPing();
    this.failAllStreams('The execution host is shutting down.');
    this.ws?.close(1000, 'host shutdown');
  }

  // ─── Frames from the runtime ─────────────────────────────────────────────

  private onFrame(frame: Frame) {
    const id = typeof frame.id === 'string' ? frame.id : null;
    switch (frame.type) {
      case 'stream_open':
        if (id) void this.open(id, String(frame.tool ?? ''), (frame.meta as Record<string, unknown>) ?? {});
        return;
      case 'stream_data': {
        const state = id ? this.streams.get(id) : undefined;
        if (state && typeof frame.data === 'string') state.queue.push(new Uint8Array(Buffer.from(frame.data, 'base64')));
        return;
      }
      case 'stream_end': {
        // Half-close: the runtime is done writing. We may still write and must still end.
        const state = id ? this.streams.get(id) : undefined;
        state?.queue.end();
        return;
      }
      case 'stream_abort': {
        const state = id ? this.streams.get(id) : undefined;
        if (!state) return;
        const error = typeof frame.error === 'string' ? frame.error : 'The runtime aborted the stream.';
        state.finished = true;
        this.streams.delete(id!);
        state.abort.abort(new Error(error));
        state.queue.end(new Error(error));
        return;
      }
      case 'owner_changed':
        log.warn('bridge', `execution owner changed to ${JSON.stringify(frame.owner)}`);
        this.emit('owner_changed', frame.owner);
        return;
      case 'superseded':
        return;
      case 'tool_request':
      case 'tool_call':
        // Forwarded tool calls are a separate Builder feature this host does not serve.
        log.warn('bridge', `ignoring ${frame.type} for ${String(frame.tool)}: this host serves runtime streams only`);
        return;
      default:
        return;
    }
  }

  private async open(id: string, capability: string, metadata: Record<string, unknown>) {
    const handler = this.handlers.get(capability);
    if (!handler) {
      this.send({ type: 'stream_error', id, error: `This execution host has no "${capability}" capability.` });
      return;
    }
    const state: StreamState = { queue: new ByteQueue(), abort: new AbortController(), finished: false };
    this.streams.set(id, state);
    this.send({ type: 'stream_opened', id });

    const stream: HostStream = {
      id,
      capability,
      metadata,
      inbound: state.queue,
      aborted: state.abort.signal,
      write: (bytes) => {
        if (state.finished || bytes.byteLength === 0) return;
        for (let offset = 0; offset < bytes.byteLength; offset += MAX_CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, offset + MAX_CHUNK_BYTES);
          this.send({ type: 'stream_data', id, data: Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64') });
        }
      },
      end: () => this.finish(id, state, { type: 'stream_end', id }),
      fail: (error) => this.finish(id, state, { type: 'stream_abort', id, error }),
    };

    try {
      await handler(stream);
      stream.end(); // no-op if the handler already ended or failed it
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      log.error(capability, text);
      stream.fail(text);
    }
  }

  private finish(id: string, state: StreamState, frame: Frame) {
    if (state.finished) return;
    state.finished = true;
    this.streams.delete(id);
    state.queue.end();
    this.send(frame);
  }

  private failAllStreams(error: string) {
    for (const [id, state] of this.streams) {
      state.finished = true;
      state.abort.abort(new Error(error));
      state.queue.end(new Error(error));
      this.streams.delete(id);
    }
  }

  // ─── Plumbing ────────────────────────────────────────────────────────────

  private send(frame: Frame) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private startPing() {
    this.stopPing();
    // The thread answers the text frame "ping" with "pong".
    this.ping = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }

  private reconnect() {
    const delay = Math.min(10_000, 500 * 2 ** this.attempt++);
    log.warn('bridge', `connection lost; reconnecting in ${delay} ms`);
    setTimeout(() => {
      if (this.closing) return;
      this.connect().catch((error: Error) => {
        log.error('bridge', `reconnect failed: ${error.message}`);
        this.reconnect();
      });
    }, delay);
  }
}
