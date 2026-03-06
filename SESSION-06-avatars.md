# Atrium — Claude Code Session 6
## Avatar Embodiment: Presence in the World

---

## Context

Atrium is an open multiplayer 3D world platform built on glTF and WebSockets.
This is a pnpm monorepo. The following has already been built and tested:

**`packages/protocol`** — SOP message schemas and Ajv validator
- `src/index.js` — exports `validate(direction, message)`
- `src/schemas/` — 12 JSON schema files for all SOP message types
- 33 passing tests

**`packages/server`** — SOP server with session lifecycle, world state, presence
- `src/session.js` — hello/ping/pong/tick/keepalive, send/set/add/remove, join/leave
- `src/world.js` — glTF-Transform Document wrapper
- `src/presence.js` — presence registry (tracks connected clients by ID)
- `src/tick.js` — per-session tick loop
- `src/index.js` — entry point, loads space.gltf via WORLD_PATH env var
- 26 passing tests

**`tools/protocol-inspector/index.html`** — single-file interactive protocol debugger
- Type dropdown restricted to 5 client-sendable types: hello, ping, send, add, remove

**`tests/fixtures/space.gltf`** — world fixture with real geometry
- ground-plane, crate-01, lamp-01 (with lamp-stand and lamp-shade children)
- All geometry embedded as base64 data URIs, PBR materials

**`tests/client/index.html`** — single-file world client
- Two-column layout: SOP messaging panel left, Three.js viewport + message log right
- glTF-Transform Document as runtime, DocumentView syncs to Three.js automatically
- Orbit camera mode with OrbitControls
- Handles set/add/remove/join/leave from server
- join/leave currently logged only — no visual avatar representation

All packages use ES modules. No TypeScript. No build step. Node.js v20.
Test runner: `node --test`.

---

## Goal

Add avatar embodiment: each connected client has a position in the world.
When a client moves, other clients see a visual stand-in move in real time.

**Deliverables:**
1. **`packages/protocol/src/schemas/view-client.json`** — new schema
2. **`packages/protocol/src/schemas/view-server.json`** — new schema
3. **`packages/protocol/src/index.js`** — updated to validate `view`
4. **`packages/protocol/test/validate.test.js`** — updated with `view` tests
5. **`packages/server/src/presence.js`** — updated to store position
6. **`packages/server/src/session.js`** — updated to handle `view` messages
7. **`packages/server/test/avatar.test.js`** — new avatar/view tests
8. **`tests/client/index.html`** — Walk camera mode, avatar rendering,
   `view` broadcasting
9. **`tools/protocol-inspector/index.html`** — add `view` to dropdown

**Definition of done / magic moment:**
- Two browser tabs, both connected to the running server
- Tab 1 in Walk mode: WASD to move, mouse drag to look
- Tab 2 in Orbit mode: watching the scene
- Tab 1 moves → a colored capsule moves in Tab 2's viewport in real time

---

## Coding Conventions

Same as all previous sessions:
- ES modules throughout
- Every `.js` file starts with the SPDX license header
- Use `@atrium/protocol` for all message validation
- Node built-in test runner only (`node --test`)
- No TypeScript, no build step
- Single-file HTML — all JS and CSS inline, no external files

---

## Design Notes

### Avatars are not world nodes

Avatar representations are **client-side only**. They are NOT added to the
glTF-Transform Document and NOT part of the world scene graph. Avatars are
transient runtime presence — they exist only while a client is connected and
have no persistence. The glTF Document represents persistent world state.
Mixing transient avatar geometry into it would conflate two separate concerns.

### The `view` message

`view` is a new SOP message type that carries a client's current observer
state — where they are in the world. It is semantically distinct from `send`:
`send` mutates the shared world, `view` broadcasts ephemeral self-state.

Key properties:
- **Fire-and-forget.** No acknowledgement, no confirmation. If a `view`
  message is dropped, the next one corrects it.
- **Last-write-wins.** No sequencing guarantees needed.
- **Not echoed back to sender.** The server relays `view` to all connected
  clients *except* the sender. You already know where you are.
- **Not persisted.** The server stores only the latest position in the
  presence registry, for bootstrapping newcomers. It is never written to
  the world Document.
- **Extensible.** The schema includes optional `look`, `move`, and `velocity`
  fields reserved for the real client. The test client sends `position` only.
  Clients that omit optional fields are valid. Clients that include them have
  them relayed faithfully.

---

## Part 1 — Protocol Changes (`packages/protocol`)

### New schema: `view-client.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "view (client)",
  "type": "object",
  "required": ["type", "position"],
  "additionalProperties": false,
  "properties": {
    "type": { "const": "view" },
    "position": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3,
      "maxItems": 3
    },
    "look": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3,
      "maxItems": 3,
      "description": "Unit vector: direction the client is looking"
    },
    "move": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3,
      "maxItems": 3,
      "description": "Unit vector: direction the client is moving (may differ from look)"
    },
    "velocity": {
      "type": "number",
      "minimum": 0,
      "description": "Scalar speed in units/second"
    }
  }
}
```

### New schema: `view-server.json`

The server broadcast adds `id` so recipients know which peer this belongs to:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "view (server)",
  "type": "object",
  "required": ["type", "id", "position"],
  "additionalProperties": false,
  "properties": {
    "type": { "const": "view" },
    "id": { "type": "string", "minLength": 1 },
    "position": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3,
      "maxItems": 3
    },
    "look": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3,
      "maxItems": 3
    },
    "move": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3,
      "maxItems": 3
    },
    "velocity": {
      "type": "number",
      "minimum": 0
    }
  }
}
```

### `packages/protocol/src/index.js` — updated

Register both new schemas in the validator. `view` dispatches to
`view-client.json` for `direction === 'client'` and `view-server.json` for
`direction === 'server'`.

### `packages/protocol/test/validate.test.js` — new tests

1. **valid client view — position only** — `{ type: 'view', position: [1,0,0] }` passes client validation
2. **valid client view — all optional fields** — position + look + move + velocity all pass
3. **invalid client view — missing position** — fails validation
4. **invalid client view — position wrong length** — `position: [1, 0]` fails
5. **valid server view** — `{ type: 'view', id: 'abc', position: [1,0,0] }` passes server validation
6. **invalid server view — missing id** — fails validation
7. **invalid server view — missing position** — fails validation

---

## Part 2 — Server Changes

### `packages/server/src/presence.js` — updated

Add position to each presence entry.

Updated entry shape: `{ id, joinedAt, position }`
- `position` — `[x, y, z]`, defaults to `[0, 0, 0]`

New method: `presence.setPosition(id, position)` — updates the stored
position for an existing entry. No-op if ID not found. Returns updated
entry or null.

---

### `packages/server/src/session.js` — updated

**Add `broadcastExcept` helper** (alongside existing `broadcast`):

```javascript
function broadcastExcept(sessions, excludeSession, message) {
  const json = JSON.stringify(message)
  for (const [, s] of sessions) {
    if (s !== excludeSession && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(json)
    }
  }
}
```

**New `view` handler:**

```javascript
case 'view': {
  // Store latest position for newcomer bootstrap
  presence.setPosition(session.id, msg.position)

  // Build outbound server view message — add id, relay optional fields
  const outbound = {
    type: 'view',
    id: session.id,
    position: msg.position,
    ...(msg.look               && { look: msg.look }),
    ...(msg.move               && { move: msg.move }),
    ...(msg.velocity !== undefined && { velocity: msg.velocity })
  }

  // Relay to all clients EXCEPT the sender
  broadcastExcept(sessions, session, outbound)
  break
}
```

Validate the outbound message with `validate('server', outbound)` before
sending, consistent with all other server messages. Log and skip if invalid.

**Updated join sequence — include position in bootstrap:**

When sending `join` bootstrap messages to the newcomer about existing clients,
include each existing client's current position from presence:

```javascript
// Bootstrap: tell newcomer about each existing client
for (const entry of presence.list()) {
  sendToSession(newSession, {
    type: 'join',
    seq: nextSeq(),
    id: entry.id,
    position: entry.position
  })
}

// Announce newcomer to existing clients with default position
for (const [, existingSession] of sessions) {
  sendToSession(existingSession, {
    type: 'join',
    seq: nextSeq(),
    id: newClientId,
    position: [0, 0, 0]
  })
}
```

Check the existing `join-server.json` schema — add `position` as an optional
`[x, y, z]` array if it is not already present. Do not break existing tests.

---

### `packages/server/test/avatar.test.js`

Use Node built-in test runner. Start a fresh server on port 3003 in `before`,
close in `after`. Load the test fixture.

**Required test cases:**

1. **view broadcasts to other clients** — connect A and B, both handshake,
   A sends `{ type: 'view', position: [1, 0, 0] }`, verify B receives a
   `view` message with `id` matching A's client ID and matching position

2. **view is NOT echoed back to sender** — connect A, handshake, A sends
   `view`, verify A does NOT receive a `view` back

3. **view updates presence position** — connect A, handshake, A sends
   `view` with `position: [3, 0, 0]`, verify `presence.get(A-id).position`
   equals `[3, 0, 0]`

4. **join bootstrap includes current position** — connect A, handshake,
   A sends `view` with `position: [2, 0, 0]`, connect B, verify B's
   bootstrap `join` for A includes `position: [2, 0, 0]`

5. **newcomer join sent to existing clients has default position** —
   connect A, handshake, connect B, verify A's `join` notification for B
   includes `position: [0, 0, 0]`

6. **view with optional fields relayed correctly** — connect A and B,
   A sends `view` with position + look + move + velocity, verify B
   receives all fields intact

---

## Part 3 — Test Client (`tests/client/index.html`)

### Camera Mode Combo Box

Add a `Camera:` label and `<select>` to the header bar, right of the
connection status:

```
ATRIUM  [ws://localhost:3000]  [Connect] [Disconnect]  ● Connected  Camera: [Orbit ▾]
```

Options: `Orbit`, `Walk`. Switching is immediate, no reload. Camera position
preserved on switch where possible. Avatar position only broadcasts in Walk
mode.

---

### Orbit Mode

Unchanged from Session 5. OrbitControls as implemented. No `view` broadcasting.

---

### Walk Mode

**Camera:** on switch to Walk, position at `[0, 1.7, 3]` facing origin.
Disable OrbitControls, enable Walk controller.

**WASD movement:**
- W/S — forward/backward along XZ facing direction
- A/D — strafe left/right
- Speed: 4 units/second
- Y locked at 1.7 units

**Mouse drag to look:**
- Mouse button down in viewport → track drag
- Mouse move while held → rotate yaw and pitch
- Mouse up → stop
- Pitch clamped ±80°
- Sensitivity: 0.2° per pixel

**`view` broadcasting:**
Each animation frame in Walk mode, if position changed beyond threshold
(0.001 units), send:

```javascript
function broadcastView() {
  if (!wsConnected || !clientId) return
  const pos = camera.position.toArray()
  if (!positionChanged(pos, lastBroadcastPos, 0.001)) return
  sendMessage({ type: 'view', position: pos })
  lastBroadcastPos = [...pos]
}
```

Position only — do not send `look`, `move`, or `velocity` from the test
client. Those are reserved for the real client.

---

### Avatar Rendering

**Registry:** `Map<clientId, THREE.Group>`. Pure Three.js objects — NOT in
the glTF Document.

**Capsule geometry per peer:**
- `CylinderGeometry(0.25, 0.25, 1.0)` — body at `[0, 1.2, 0]`
- `SphereGeometry(0.25, 16, 8)` — bottom cap at `[0, 0.7, 0]`
- `SphereGeometry(0.25, 16, 8)` — top cap at `[0, 1.7, 0]`
- `ConeGeometry(0.1, 0.3, 8)` — nose/direction indicator at `[0, 1.5, -0.3]`
  pointing in -Z

All parts share one `MeshLambertMaterial`. Color from client ID:

```javascript
function colorFromId(id) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) & 0xffffffff
  const hue = (hash & 0xffff) / 0xffff
  return new THREE.Color().setHSL(hue, 0.7, 0.5)
}
```

**Own avatar:** never rendered. Filter `view` messages where
`msg.id === clientId`.

**On `join`:** create capsule, add to `threeScene`, store in registry.
Apply `position` from the join message if present, otherwise place at origin.

**On `leave`:** remove capsule from `threeScene`, dispose, delete from registry.

**On inbound `view`:**
```javascript
function onView(msg) {
  if (msg.id === clientId) return
  const group = avatars.get(msg.id)
  if (!group) return
  group.position.set(...msg.position)
}
```

---

### Message Log — View Filter

Add **"Show view messages"** checkbox to the log panel header. Unchecked by
default. Same behavior as tick filter — display only, messages still stored.

```
Message Log   [ ] Show tick messages   [ ] Show view messages   [Clear]
```

Any message with `type === 'view'` is a view message.

---

### Protocol Inspector (`tools/protocol-inspector/index.html`)

Add `view` as a 6th client-sendable type in the dropdown. Template:

```json
{
  "type": "view",
  "position": [0.0, 1.7, 0.0]
}
```

---

## What NOT to Touch This Session

- `packages/gltf-extension` — not this session
- `packages/client` promotion — not this session
- `look`, `move`, `velocity` — define in schema, do not send from test client
- Physics — not this session
- Persistence — not this session

---

## When Done

1. Run `pnpm test` from `packages/protocol` — all tests pass including new
   `view` schema tests
2. Run `pnpm test` from `packages/server` — all tests pass including new
   avatar tests
3. Start the server:
   ```bash
   WORLD_PATH=tests/fixtures/space.gltf node packages/server/src/index.js
   ```
4. Serve the test client:
   ```bash
   npx serve -l 5173 tests/
   ```
5. Open `http://localhost:5173/client/index.html` in two browser tabs
6. Tab 1: switch to **Walk**, move with WASD + mouse drag
7. Tab 2: stay in **Orbit**, watch the scene
8. **Magic moment:** Tab 1's colored capsule moves in Tab 2's viewport in
   real time
9. Disconnect Tab 1 — capsule disappears from Tab 2
10. Reconnect Tab 1 — Tab 2 receives `join`, capsule reappears at origin
11. Switch Tab 2 to Walk — Tab 1's capsule visible from first-person
12. Open protocol inspector — verify `view` is in the dropdown
13. Report any issues, especially around Walk controller feel and avatar
    positioning

---

## Session Log

To be filled in by Claude Code after the session.
