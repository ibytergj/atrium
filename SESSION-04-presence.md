# Atrium — Claude Code Session 4
## Presence: join/leave + Inspector Fixes

---

## Context

Atrium is an open multiplayer 3D world platform built on glTF and WebSockets.
This is a pnpm monorepo. The following has already been built and tested:

**`packages/protocol`** — SOP message schemas and Ajv validator
- 12 message types including `join` and `leave` — schemas already exist
- `validate(direction, message)` already handles join/leave validation

**`packages/server`** — SOP server with session lifecycle and world state
- `src/session.js` — hello/ping/pong/tick/keepalive, send/set/add/remove
- `src/world.js` — glTF-Transform Document wrapper
- `src/tick.js` — per-session tick loop
- `src/index.js` — entry point, loads space.gltf on startup
- 20 passing tests

**`tools/protocol-inspector/index.html`** — interactive protocol debugger

All packages use ES modules (`import`/`export`). No TypeScript. No build step.
Node.js v20. Test runner: `node --test`.

---

## Goal

Add presence tracking to the server so clients are notified when others join
and leave. Fix the protocol inspector to generate unique client IDs and add
a tick message filter.

**Deliverables:**
1. `packages/server/src/presence.js` — presence tracking module
2. `packages/server/src/session.js` — updated to use presence
3. `packages/server/test/presence.test.js` — presence tests
4. `tools/protocol-inspector/index.html` — two inspector fixes

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

## What to Build

### 1. `packages/server/src/presence.js`

Exports `createPresence()` — a simple presence registry.

**Responsibilities:**

- Tracks connected clients in a `Map` keyed by client ID
- Each entry: `{ id, joinedAt }`

**API:**

`presence.add(id)` — register a client by ID. Returns the entry.

`presence.remove(id)` — remove a client by ID. Returns the removed entry or null.

`presence.get(id)` — return entry for a client ID, or null.

`presence.list()` — return array of all current entries.

`presence.has(id)` — return boolean.

**Returns:** `{ add, remove, get, list, has }`

---

### 2. `packages/server/src/session.js` — updated

Import and use `createPresence`. The presence instance is created inside
`createSessionServer` alongside the sessions Map.

**On successful `hello` handshake:**

After registering the session and starting the tick loop, add the client
to presence and handle the join sequence in this order:

1. Send `join` to all EXISTING connected clients (everyone already in the
   session map before this client) announcing the newcomer:
   ```json
   {
     "type": "join",
     "seq": N,
     "id": "<new client id>"
   }
   ```

2. Send a `join` message back to the NEW client for each already-connected
   client (presence bootstrap — so the newcomer knows who is already there):
   ```json
   {
     "type": "join",
     "seq": N,
     "id": "<existing client id>"
   }
   ```

3. Add the new client to the presence registry via `presence.add(id)`.

Note: step 1 must happen BEFORE step 3 so the newcomer doesn't receive
their own join in the bootstrap.

**On client disconnect (`ws.on('close')`):**

1. Remove from sessions Map (already done)
2. Stop tick loop (already done)
3. Remove from presence via `presence.remove(id)`
4. Broadcast `leave` to all remaining connected sessions:
   ```json
   {
     "type": "leave",
     "seq": N,
     "id": "<departed client id>"
   }
   ```

Only broadcast `leave` if the client had completed the hello handshake
(i.e. was registered in presence). Clients that disconnect before completing
hello should not trigger a `leave` broadcast.

**`join` and `leave` messages must be validated** with `validate('server', msg)`
before sending, same as all other outbound server messages. If validation
fails, log the error but do not send.

---

### 3. `packages/server/test/presence.test.js`

Use Node built-in test runner. Use `ws` package as WebSocket client.
Start a fresh server on port 3002 in `before`, close it in `after`.
Load the test fixture from `../../../tests/fixtures/space.gltf`.

**Required test cases:**

1. **newcomer receives join for each existing client** — connect client A,
   complete handshake, connect client B, complete handshake, verify client B
   receives a `join` message with `id` matching client A's ID

2. **existing clients receive join for newcomer** — connect client A,
   complete handshake, connect client B, complete handshake, verify client A
   receives a `join` message with `id` matching client B's ID

3. **client receives no join for itself** — connect client A, complete
   handshake, verify client A does NOT receive a `join` with its own ID
   during bootstrap (it's the only client)

4. **remaining clients receive leave on disconnect** — connect client A and
   client B, both complete handshake, disconnect client A, verify client B
   receives a `leave` message with `id` matching client A's ID

5. **leave is not broadcast for pre-handshake disconnect** — connect a client
   but do NOT send hello, immediately disconnect, verify no `leave` message
   is broadcast to other connected clients

6. **presence list is accurate** — connect two clients, both complete
   handshake, verify `presence.list()` has two entries, disconnect one,
   verify `presence.list()` has one entry

Each test should open and close its own WebSocket connections. Use async/await
with Promise-based WebSocket helpers consistent with the existing test style
in `session.test.js`.

---

## Protocol Inspector Fixes — `tools/protocol-inspector/index.html`

### Fix 1 — Auto-generate client ID

On page load, generate a UUID using the browser's built-in API:

```javascript
const clientId = crypto.randomUUID()
```

Pre-fill the `hello` message template with this generated ID so every
browser tab gets a unique identity. The ID should be visible in the
template editor so the user can see and optionally override it.

The generated ID should be stable for the lifetime of the page — regenerated
only on page reload, not on every connect/disconnect.

### Fix 2 — "Show tick messages" checkbox

Add a checkbox to the log panel header area:

```
Message Log                    [x] Show tick messages   [Clear] [Export JSON]
```

- Checked by default (ticks are shown)
- When unchecked, tick messages are hidden from the log display
- Already-received ticks that are in the log should be hidden immediately
  when the checkbox is unchecked (filter applied to existing entries)
- Ticks are still received and stored internally — the checkbox only
  controls display, not reception
- The count of hidden ticks does NOT need to be shown

---

## What NOT to Touch This Session

- `packages/protocol` — do not modify schemas or validator
- `packages/gltf-extension` — not this session
- `packages/client` — not this session
- Avatar data in `join` messages — not this session (id only)
- Authority checking — not this session
- Physics — not this session
- Persistence / snapshotting — not this session

---

## When Done

1. Run `pnpm test` from `packages/server` — all tests must pass
2. Start the server: `WORLD_PATH=tests/fixtures/space.gltf node src/index.js`
3. Open `tools/protocol-inspector/index.html` in **two browser tabs**
4. Verify each tab has a different auto-generated ID in the hello template
5. Connect and handshake both tabs
6. Verify tab 1 receives a `join` for tab 2 and vice versa
7. Uncheck "Show tick messages" in one tab — verify ticks disappear from log
8. Disconnect one tab — verify the other receives a `leave` message
9. Report any issues encountered
