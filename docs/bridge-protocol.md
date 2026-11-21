# The execution host bridge, as implemented by Standard Agents Builder

The Standard Agent Specification defines `state.runtimeStreams.open()` from the agent's side: a capability name, opaque metadata, and a two-way byte stream. It does not yet say how an **execution host** connects to a runtime and answers those opens. This page records how Standard Agents Builder does it, so that another host (like the one in this repo) can interoperate.

It describes `@standardagents/builder` **0.45.10**. It comes from reading that package and was checked against it in this repo's tests (`npm run probe`). It is not a published contract and may change.

## Connecting

```
GET /api/threads/{threadId}/bridge?client_id=…&client_name=…&client_kind=…&claim=…
Upgrade: websocket
Authorization: Bearer <API key or session token>
```

| Query parameter | Meaning |
| --- | --- |
| `client_id` | Stable id for this host. A newer socket with the same id supersedes the older one (close code `4001`). |
| `client_name`, `client_kind` | Free text, shown as the thread's owner. |
| `claim` | `if_unowned` (default when `client_id` is set), `if_stale`, `takeover`, or `none`. |

The runtime records one **execution owner** per thread. Only the owner's socket receives `stream_open`. On connect the runtime replies:

```json
{ "type": "bridge_ready", "threadId": "…", "owner": true, "current_owner": { "client_id": "…", "generation": 2 } }
```

A takeover is refused (`claim_refused: "in_flight"`) while forwarded calls are in flight. Other sockets on the thread get `owner_changed` when ownership moves.

Keepalive: send the text frame `ping`; the thread answers `pong`.

## Streams

All frames are JSON text. Payload bytes are base64, at most 256 KiB per frame.

| Direction | Frame | Meaning |
| --- | --- | --- |
| runtime → host | `{"type":"stream_open","id","tool","meta"}` | `tool` is the capability name, `meta` the metadata. |
| host → runtime | `{"type":"stream_opened","id"}` | Accept. `open()` resolves `{ ok: true }`. |
| host → runtime | `{"type":"stream_error","id","error"}` | Refuse. `open()` resolves `{ ok: false, code: "refused" }`. |
| both | `{"type":"stream_data","id","data"}` | Bytes, in order. |
| runtime → host | `{"type":"stream_end","id"}` | The agent closed its writable. **Half-close**: the host may keep writing. |
| host → runtime | `{"type":"stream_end","id"}` | The host is done. The runtime settles the whole stream as `{ ok: true }`. |
| both | `{"type":"stream_abort","id","error"}` | Abort. The other side's reads error and `closed` settles `{ ok: false }`. |

Things a host has to get right:

- **The host's `stream_end` ends the stream in both directions.** After it, the agent's writes throw `The client stream is closed.` This repo relies on that: on a barge-in, the host ends the speak stream, and the agent's next write fails, which cancels the TTS request.
- No answer within the open timeout (`timeoutMs`, default 30 s) resolves `open()` with `code: "timeout"`.
- No connected owner resolves `code: "unavailable"`. A thread whose owner disconnected waits for it to reconnect, up to the timeout.
- A stream opened in a subagent thread is proxied through the nearest ancestor with a bridge.

## What a spec-level version could add

Notes from building this demo, offered as input to a proposal:

1. **A host connection contract.** Any runtime that implements `runtimeStreams` needs an answer to "how does a host attach?". The frame set above is small, and it could be specified as-is or in an abstract form.
2. **Capability discovery.** Today an agent learns a capability is missing only by opening it. A host could announce its capabilities on connect (`bridge_ready.capabilities`), and `ThreadState` could expose them.
3. **Well-known capability names.** Opaque names keep the spec small, but voice is common enough that a shared vocabulary (`audio.speak`, `audio.listen`) plus a shared metadata shape (format, rate, channels) would let agent packages and hosts mix and match. `agent/src/voice/protocol.ts` here is one candidate.
4. **Out-of-band status on a stream.** The speak capability returns its playback report as an NDJSON line on the byte stream. A small typed status channel would be cleaner for control messages like "interrupted at 1.7 s".
