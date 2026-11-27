import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { deepgramLive } from 'standardagent-livekit-voice';

/** A stand-in for Deepgram's live endpoint: one final result per audio message, flushed on CloseStream. */
async function fakeDeepgram(behavior: 'ok' | 'reject') {
  const wss = new WebSocketServer({ port: 0, handleProtocols: (protocols) => (protocols.has('token') ? 'token' : false) });
  await new Promise((resolve) => wss.once('listening', resolve));
  const seen = { bytes: 0, protocols: [] as string[] };
  wss.on('connection', (socket, request) => {
    seen.protocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
    if (behavior === 'reject') {
      socket.close(1008, 'bad auth');
      return;
    }
    let words = 0;
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        seen.bytes += (data as Buffer).byteLength;
        words++;
        return;
      }
      if (JSON.parse(String(data)).type === 'CloseStream') {
        const transcript = Array.from({ length: words }, (_, i) => `word${i + 1}`).join(' ');
        socket.send(JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript }] } }));
        socket.send(JSON.stringify({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'interim' }] } }));
        socket.close(1000);
      }
    });
  });
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/v1/listen`;
  return { url, seen, close: () => new Promise((resolve) => wss.close(resolve)) };
}

const open = (url: string, protocols: string[]) => new WebSocket(url, protocols);

test('live STT buffers until open, sends audio, and returns final results on finish', async () => {
  const server = await fakeDeepgram('ok');
  try {
    const live = deepgramLive(server.url, 'dg_test_key', open);
    live.push(new Uint8Array(3200));
    live.push(new Uint8Array(3200));
    live.push(new Uint8Array(0)); // ignored
    const transcript = await live.finish();
    assert.equal(transcript, 'word1 word2');
    assert.equal(server.seen.bytes, 6400);
    assert.deepEqual(server.seen.protocols, ['token', 'dg_test_key']);
  } finally {
    await server.close();
  }
});

test('live STT with no audio never connects', async () => {
  let opened = false;
  const live = deepgramLive('ws://127.0.0.1:1/unused', 'k', (url, protocols) => {
    opened = true;
    return new WebSocket(url, protocols);
  });
  assert.equal(await live.finish(), '');
  assert.equal(opened, false);
});

test('live STT rejects on an abnormal close so the turn can fall back to batch', async () => {
  const server = await fakeDeepgram('reject');
  try {
    const live = deepgramLive(server.url, 'k', open);
    live.push(new Uint8Array(3200));
    await assert.rejects(live.finish());
  } finally {
    await server.close();
  }
});

test('a reply the model emitted twice is spoken once', async () => {
  const { collapseRepeat } = await import('standardagent-livekit-voice');
  const once = 'Please say the name in English, and I’ll look up the order.';
  assert.equal(collapseRepeat(once + once), once);
  assert.equal(collapseRepeat(once), once);
  assert.equal(collapseRepeat('ha ha '), 'ha ha ');
});

test('a transcript that trails off keeps the turn open; a finished one does not', async () => {
  const { soundsUnfinished } = await import('standardagent-livekit-voice');
  for (const text of ['Okay. And', 'Okay, and.', 'It was for my', 'Um', 'So, uh...', 'The order is,']) {
    assert.equal(soundsUnfinished(text), true, text);
  }
  for (const text of ['', 'Maya Chen.', 'Thanks a lot.', 'When is it arriving?', 'What is it for?', 'Sandra', "That's what it is.", "I'd like that."]) {
    assert.equal(soundsUnfinished(text), false, text);
  }
});

test('a reply that also calls a tool is a preamble, not a turn', async () => {
  const { hasToolCalls } = await import('standardagent-livekit-voice');
  assert.equal(hasToolCalls({ tool_calls: '[{"id":"call_1","type":"function"}]' }), true);
  assert.equal(hasToolCalls({ tool_calls: '[]' }), false);
  assert.equal(hasToolCalls({ tool_calls: null }), false);
  assert.equal(hasToolCalls({}), false);
});

test('a reply that repeats the preamble the caller just heard is not spoken twice', async () => {
  const { repeatsPrevious } = await import('standardagent-livekit-voice');
  const preamble = 'Hi, thanks for calling Harbor Goods. What’s your three-digit order number?';
  assert.equal(repeatsPrevious('What’s your three-digit order number?', preamble), true);
  assert.equal(repeatsPrevious('Order 111 shipped yesterday.', preamble), false);
  assert.equal(repeatsPrevious('What’s your order number?', undefined), false);
});
