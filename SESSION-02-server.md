# Atrium — Claude Code Session 2
## SOP Server: Session Lifecycle + Protocol Inspector

---

## Context

Atrium is an open multiplayer 3D world platform built on glTF and WebSockets.
This is a pnpm monorepo. The following has already been built and tested:

- `packages/protocol` — SOP message schemas (JSON Schema) and Ajv validator
  - `src/index.js` — exports `validate(direction, message)`
  - `src/schemas/` — 12 JSON schema files for all SOP message types
  - `test/validate.test.js` — 33 passing tests

All packages use ES modules (`import`/`export`). No TypeScript. No build step.
Node.js v20. Test runner: `node --test`.

---

## Goal

Build the SOP server session lifecycle and the protocol inspector tool.

**Deliverables:**
1. `packages/server/src/session.js` — WebSocket session server
2. `packages/server/src/tick.js` — per-session tick loop
3. `packages/server/src/index.js` — entry point
4. `packages/server/test/session.test.js` — tests
5. `tools/protocol-inspector/index.html` — interactive protocol inspector

**Definition of done:** `pnpm test` passes in `packages/server`.

---

## Coding Conventions

- ES modules throughout (`import`/`export`, `"type": "module"` already set)
- Every `.js` file starts with:
  ```
  // SPDX-License-Identifier: MIT
  // Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
  ```
- Use `@atrium/protocol` for all message validation — never inline schema logic
- Node built-in test runner only (`node --test`) — no Jest, no Mocha
- No TypeScript, no build step

---

## Package Dependencies

`packages/server/package.json` already declares:
- `ws` — WebSocket server
- `@atrium/protocol` — workspace dependency (already installed)

Run `pnpm install` from repo root if needed before starting.

---

## What to Build

### 1. `packages/server/src/tick.js`

Exports a single function `createTickLoop(session, intervalMs)`.

- Sets an interval that sends a `tick` message to `session.ws` every `intervalMs`
- Each tick increments and includes the server's global sequence counter
- Tick message shape: `{ type: 'tick', seq: N, serverTime: Date.now() }`
- Returns a `stop()` function that clears the interval
- The session object is `{ ws, id, capabilities, alive }`

### 2. `packages/server/src/session.js`

Exports `createSessionServer({ port, maxUsers })`.

**Responsibilities:**

**Connection handling:**
- Create a `WebSocketServer` on the given port (default 3000)
- Track connected sessions in a `Map` keyed by client ID
- Each session object: `{ ws, id, capabilities, seq, alive, tickStop }`

**Message handling:**
- Parse incoming JSON — send `UNKNOWN_MESSAGE` error on parse failure
- Validate every message with `validate('client', msg)` from `@atrium/protocol`
- Send `UNKNOWN_MESSAGE` error if validation fails
- Dispatch to handler by `msg.type`
- Any message type other than `hello` sent before handshake → `AUTH_FAILED` error

**`hello` handler:**
- Reject with `WORLD_FULL` error and close connection if `sessions.size >= maxUsers`
- Register session in the Map
- Negotiate tick interval: take client's requested interval, enforce minimum of 50ms
- Send server hello: `{ type: 'hello', id: serverUUID, seq: currentSeq, serverTime: Date.now(), capabilities: { tick: { interval: negotiated, minInterval: 50 } } }`
- Start tick loop for this session via `createTickLoop`

**`ping` handler:**
- Respond immediately: `{ type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() }`

**Disconnect handling:**
- Remove session from Map on `ws.close`
- Stop the session's tick loop

**Keepalive:**
- Every 30 seconds, ping all connected sessions via `ws.ping()`
- On `ws.pong`, set `session.alive = true`
- Sessions that don't respond within one keepalive cycle get terminated

**Monotonic sequence counter:**
- Single server-wide counter, increments on every broadcast
- Used in hello (current seq) and tick messages

**Error helper:**
- `sendError(ws, seq, code, message)` — sends `{ type: 'error', code, message, seq? }`
- Valid error codes (from schema): `PERMISSION_DENIED`, `NODE_NOT_FOUND`,
  `INVALID_FIELD`, `INVALID_VALUE`, `WORLD_FULL`, `AUTH_FAILED`,
  `RATE_LIMITED`, `UNKNOWN_MESSAGE`

**Returns:** `{ wss, sessions }`

### 3. `packages/server/src/index.js`

Entry point. Creates and starts the session server on port 3000.
Logs: `Atrium server listening on ws://localhost:3000`

---

## Tests — `packages/server/test/session.test.js`

Use Node built-in test runner. Use `ws` package as WebSocket client.
Start a fresh server on port 3001 in `before`, close it in `after`.

**Required test cases:**

1. **completes hello handshake** — send hello, receive server hello with correct shape
2. **server hello contains negotiated tick interval** — request 2000ms, verify response has interval ≥ 50
3. **rejects message before hello with AUTH_FAILED** — send `send` message before hello, expect error with code AUTH_FAILED
4. **responds to ping with pong** — complete handshake, send ping with clientTime, verify pong has both clientTime and serverTime
5. **sends tick messages after handshake** — complete handshake, wait for at least one tick message, verify shape
6. **rejects connection when world full** — start server with maxUsers: 1, connect two clients, second should receive WORLD_FULL error
7. **handles client disconnect cleanly** — connect, disconnect, verify session removed from sessions Map

Each test should open and close its own WebSocket connection. Use callbacks or
async/await with a helper that wraps WebSocket events in Promises.

---

## Protocol Inspector — `tools/protocol-inspector/index.html`

Single self-contained HTML file. No framework. No build step. Vanilla JS only.
Must work when opened directly in a browser pointed at a running server.

**Layout (two-column):**
```
┌─────────────────────────────────────────────────────────────┐
│ ATRIUM Protocol Inspector                                    │
├─────────────────────────────────────────────────────────────┤
│ Server: [ws://localhost:3000    ] [Connect] [Disconnect]     │
│ Status: ● Connected                                          │
├──────────────────────┬──────────────────────────────────────┤
│ Send Message         │ Message Log                           │
│                      │                                       │
│ Type [hello      ▾]  │ 14:23:01 → hello (client)            │
│                      │ 14:23:01 ← hello (server)            │
│ {                    │ 14:23:02 ← tick  seq:1                │
│   "type": "hello",  │ 14:23:03 ← tick  seq:2                │
│   ...               │                                       │
│ }                    │                                       │
│                      │                                       │
│ [Send]  [Reset]      │ [Clear]  [Export JSON]                │
└──────────────────────┴──────────────────────────────────────┘
```

**Behaviors:**
- Type dropdown lists all 11 SOP message types
- Selecting a type pre-fills the editor with a valid JSON template for that type
- [Send] validates JSON (basic parse check) before sending — shows inline error if invalid
- Log entries show timestamp, direction (→ outbound, ← inbound), type, and seq if present
- Clicking a log entry expands to show full JSON
- Inbound and outbound entries visually distinguished (color or symbol)
- [Clear] clears the log
- [Export JSON] downloads the full log as a `.json` file
- Scenarios dropdown with these prebuilt sequences:
  - "Full handshake" — sends hello, waits for response
  - "Clock sync" — sends hello then ping
  - "Ping flood" — sends 5 pings in sequence
- Connection status indicator updates on connect/disconnect/error

**Message templates (pre-fill on type select):**
- `hello`: `{ "type": "hello", "id": "inspector-01", "capabilities": { "tick": { "interval": 1000 } } }`
- `ping`: `{ "type": "ping", "clientTime": <current timestamp> }`
- `send`: `{ "type": "send", "seq": 1, "node": "my-node", "field": "translation", "value": [0, 0, 0] }`
- `add`: `{ "type": "add", "seq": 1, "node": { "name": "new-node", "translation": [0, 0, 0] } }`
- `remove`: `{ "type": "remove", "seq": 1, "node": "my-node" }`
- Others: minimal valid template based on schema

---

## What NOT to Touch This Session

- `packages/protocol` — already complete, do not modify
- `packages/gltf-extension` — not this session
- `packages/client` — not this session
- World state, SOM, glTF loading — not this session
- `send`/`set`/`add`/`remove` handling on the server — not this session
- `join`/`leave` — not this session

---

## When Done

1. Run `pnpm test` from `packages/server` — all tests must pass
2. Open `tools/protocol-inspector/index.html` in a browser
3. Connect to `ws://localhost:3000` with server running
4. Complete a full handshake and verify tick messages appear in the log
5. Report any issues encountered
