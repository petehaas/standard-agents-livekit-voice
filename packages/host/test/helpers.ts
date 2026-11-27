/**
 * Test doubles: synthetic audio, and a mock Standard Agents runtime that
 * speaks the Builder's bridge protocol (stream_open / stream_opened /
 * stream_data / stream_end / stream_abort) with the same settle semantics as
 * ThreadStreams in @standardagents/builder 0.45.10.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RuntimeStreamRequest, RuntimeStreamResult, RuntimeStreams } from '@standardagents/spec';
import { FRAME_SAMPLES } from '../src/mic.js';

// ─── Audio ─────────────────────────────────────────────────────────────────

export function speechFrame(amplitude = 8000, frequency = 220, sampleRate = 16_000): Int16Array {
  const frame = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i++) {
    frame[i] = Math.round(amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
  }
  return frame;
}

export function silenceFrame(noise = 20): Int16Array {
  const frame = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i++) frame[i] = Math.round((Math.random() * 2 - 1) * noise);
  return frame;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Mock runtime ──────────────────────────────────────────────────────────

interface ClientStream {
  controller: ReadableStreamDefaultController<Uint8Array>;
  opened: ((result: { ok: boolean; error?: string }) => void) | null;
  settleDone: (result: { ok: boolean; error?: string }) => void;
}

export class MockRuntime {
  readonly server: Server;
  private readonly wss = new WebSocketServer({ noServer: true });
  private socket: WebSocket | null = null;
  private streams = new Map<string, ClientStream>();
  readonly connections: { url: string; authorization?: string }[] = [];

  constructor(private readonly apiKey = 'agtbldr_test_key') {
    this.server = createServer((_req, res) => res.writeHead(404).end());
    this.server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      this.connections.push({ url, authorization: req.headers.authorization });
      if (!/^\/api\/threads\/[^/]+\/bridge/.test(url) || req.headers.authorization !== `Bearer ${this.apiKey}`) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n{"error":"Unauthorized"}');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws));
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close() {
    this.socket?.close();
    this.wss.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private attach(ws: WebSocket) {
    this.socket = ws;
    ws.send(JSON.stringify({ type: 'bridge_ready', threadId: 'thread-1', owner: true, current_owner: null }));
    ws.on('message', (data) => {
      const text = data.toString();
      if (text === 'ping') return ws.send('pong');
      const frame = JSON.parse(text) as { type: string; id?: string; data?: string; error?: string };
      const state = frame.id ? this.streams.get(frame.id) : undefined;
      if (!state || !frame.id) return;
      switch (frame.type) {
        case 'stream_opened':
          state.opened?.({ ok: true });
          state.opened = null;
          return;
        case 'stream_error':
          this.settle(frame.id, { ok: false, error: frame.error ?? 'Client stream error.' });
          return;
        case 'stream_data':
          state.controller.enqueue(new Uint8Array(Buffer.from(frame.data ?? '', 'base64')));
          return;
        case 'stream_end':
          this.settle(frame.id, { ok: true });
          return;
        case 'stream_abort':
          this.settle(frame.id, { ok: false, error: frame.error ?? 'Client aborted the stream.' });
          return;
      }
    });
  }

  private settle(id: string, result: { ok: boolean; error?: string }) {
    const state = this.streams.get(id);
    if (!state) return;
    this.streams.delete(id);
    if (state.opened) state.opened(result);
    try {
      if (result.ok) state.controller.close();
      else state.controller.error(new Error(result.error));
    } catch {
      // already closed
    }
    state.settleDone(result);
  }

  /** The `state.runtimeStreams` an agent sees, backed by the bridge socket. */
  readonly runtimeStreams: RuntimeStreams = {
    open: async (request: RuntimeStreamRequest): Promise<RuntimeStreamResult> => {
      const socket = this.socket;
      if (!socket) return { ok: false, error: 'No execution host.', code: 'unavailable' };
      const id = crypto.randomUUID();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
      let settleDone!: ClientStream['settleDone'];
      const done = new Promise<{ ok: boolean; error?: string }>((resolve) => (settleDone = resolve));
      const state: ClientStream = { controller, opened: null, settleDone };
      this.streams.set(id, state);

      const opened = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        state.opened = resolve;
        setTimeout(() => resolve({ ok: false, error: 'timeout' }), request.timeoutMs ?? 30_000).unref();
        socket.send(JSON.stringify({ type: 'stream_open', id, tool: request.capability, meta: request.metadata ?? {} }));
      });
      if (!opened.ok) {
        this.streams.delete(id);
        return { ok: false, error: opened.error ?? 'Stream open failed.', code: 'refused' };
      }

      const abort = (error?: string) => {
        if (!this.streams.has(id)) return;
        socket.send(JSON.stringify({ type: 'stream_abort', id, error: error ?? null }));
        this.settle(id, error ? { ok: false, error } : { ok: true });
      };
      const writable = new WritableStream<Uint8Array>({
        write: (chunk) => {
          if (!this.streams.has(id)) throw new Error('The client stream is closed.');
          socket.send(JSON.stringify({ type: 'stream_data', id, data: Buffer.from(chunk).toString('base64') }));
        },
        close: () => {
          if (this.streams.has(id)) socket.send(JSON.stringify({ type: 'stream_end', id }));
        },
      });
      let closed = false;
      return {
        ok: true,
        stream: {
          readable,
          writable,
          closed: done,
          close: (reason?: string) => {
            if (closed) return;
            closed = true;
            abort(reason);
          },
        },
      };
    },
  };
}
