# Atrium — Claude Code Session 3
## World State: glTF-Transform + send/set/add/remove

---

## Context

Atrium is an open multiplayer 3D world platform built on glTF and WebSockets.
This is a pnpm monorepo. The following has already been built and tested:

**`packages/protocol`** — SOP message schemas and Ajv validator
- `src/index.js` — exports `validate(direction, message)`
- `src/schemas/` — 12 JSON schema files for all SOP message types
- 33 passing tests

**`packages/server`** — SOP session lifecycle
- `src/session.js` — WebSocket server, hello/ping/pong/error/keepalive
- `src/tick.js` — per-session tick loop
- `src/index.js` — entry point on port 3000
- 7 passing tests

**`tools/protocol-inspector/index.html`** — interactive protocol debugger

All packages use ES modules (`import`/`export`). No TypeScript. No build step.
Node.js v20. Test runner: `node --test`.

---

## Goal

Add real world state to the server. The server loads a `space.gltf` file into a
glTF-Transform Document on startup and handles `send`/`set`/`add`/`remove`
messages against the live Document. Mutations are broadcast to all connected
clients as `set` messages.

**Deliverables:**
1. `packages/server/src/world.js` — glTF-Transform Document wrapper
2. `packages/server/src/session.js` — updated to handle world messages
3. `tests/fixtures/space.gltf` — minimal test fixture
4. `packages/server/test/world.test.js` — world state tests
5. `tools/protocol-inspector/index.html` — updated templates for world messages

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

## New Package Dependency

Add `@gltf-transform/core` to `packages/server/package.json`:

```json
"dependencies": {
  "@gltf-transform/core": "^4.0.0",
  "@atrium/protocol": "workspace:*",
  "ws": "^8.0.0"
}
```

Run `pnpm install` from repo root after updating.

---

## Test Fixture — `tests/fixtures/space.gltf`

Create this file at the repo root level in `tests/fixtures/`.
It is a minimal but valid glTF 2.0 file with named nodes that tests can
mutate and query. It must have at least:

- A root scene
- A node named `"crate-01"` with a translation of `[1.0, 0.0, 0.0]`
- A node named `"lamp-01"` with a translation of `[3.0, 0.0, 0.0]`
- `extras.atrium` world metadata on the root

```json
{
  "asset": { "version": "2.0", "generator": "Atrium test fixture" },
  "extras": {
    "atrium": {
      "version": "0.1.0",
      "world": {
        "name": "Test World",
        "maxUsers": 10,
        "navigation": "WALK",
        "capabilities": {
          "tick": { "interval": 1000 },
          "physics": false,
          "chat": false
        }
      }
    }
  },
  "scene": 0,
  "scenes": [{ "name": "Scene", "nodes": [0, 1] }],
  "nodes": [
    {
      "name": "crate-01",
      "translation": [1.0, 0.0, 0.0]
    },
    {
      "name": "lamp-01",
      "translation": [3.0, 0.0, 0.0]
    }
  ]
}
```

---

## What to Build

### 1. `packages/server/src/world.js`

Exports `createWorld(gltfPath)` — loads a `space.gltf` and returns a world
object that wraps the glTF-Transform Document.

**Responsibilities:**

**Loading:**
- Use `NodeIO` from `@gltf-transform/core` to read the `.gltf` file
- Store the Document internally
- Parse `root.getExtras().atrium.world` for world metadata (maxUsers,
  capabilities, etc.) — expose as `world.meta`

**Node lookup:**
- `world.getNode(name)` — find a node by name, return null if not found
- Nodes are looked up by scanning `document.getRoot().listNodes()`

**Mutations — these are the core operations:**

`world.setField(nodeName, field, value)`:
- Find the node by name — return `{ ok: false, code: 'NODE_NOT_FOUND' }` if missing
- Apply the mutation to the glTF-Transform Node:
  - `'translation'` → `node.setTranslation(value)`
  - `'rotation'` → `node.setRotation(value)`
  - `'scale'` → `node.setScale(value)`
  - `'extras'` → `node.setExtras(value)`
  - Any unknown field → return `{ ok: false, code: 'INVALID_FIELD' }`
- Return `{ ok: true }`

`world.addNode(nodeDescriptor, parentName)`:
- Create a new Node in the Document: `document.createNode(nodeDescriptor.name)`
- Apply translation/rotation/scale/extras/extensions if present in descriptor
- If `parentName` provided, find parent node and add as child;
  otherwise add to root scene
- Return `{ ok: true, node: createdNode }` or `{ ok: false, code: 'NODE_NOT_FOUND' }`

`world.removeNode(nodeName)`:
- Find node by name — return `{ ok: false, code: 'NODE_NOT_FOUND' }` if missing
- Dispose the node: `node.dispose()`
- Return `{ ok: true }`

**Reading:**
- `world.getNodeTranslation(name)` — returns `[x, y, z]` array or null
- `world.listNodeNames()` — returns array of all node names in the document

**Returns:** `{ meta, getNode, setField, addNode, removeNode, getNodeTranslation, listNodeNames }`

---

### 2. `packages/server/src/session.js` — updated

Add handlers for `send`, `add`, and `remove` client messages.
The world instance is passed into `createSessionServer`.

Update signature to: `createSessionServer({ port, maxUsers, world })`

**`send` handler** (client requests a field mutation):
- Validate message with `@atrium/protocol`
- Call `world.setField(msg.node, msg.field, msg.value)`
- If result is `{ ok: false, code: 'NODE_NOT_FOUND' }` → send error `NODE_NOT_FOUND`
- If result is `{ ok: false, code: 'INVALID_FIELD' }` → send error `INVALID_FIELD`
- On success: increment seq, broadcast `set` message to ALL connected sessions
  (including the sender):
  ```json
  {
    "type": "set",
    "seq": N,
    "node": "crate-01",
    "field": "translation",
    "value": [1, 0, 0],
    "serverTime": <Date.now()>
  }
  ```

**`add` handler** (client adds a node):
- Validate message
- Call `world.addNode(msg.node, msg.parent)`
- On `NODE_NOT_FOUND` (parent not found) → send error `NODE_NOT_FOUND`
- On success: broadcast `add` message to ALL connected sessions including sender:
  ```json
  {
    "type": "add",
    "seq": N,
    "format": "gltf",
    "parent": "scene-root",
    "node": { ... }
  }
  ```

**`remove` handler** (client removes a node):
- Validate message
- Call `world.removeNode(msg.node)`
- On `NODE_NOT_FOUND` → send error `NODE_NOT_FOUND`
- On success: broadcast `remove` message to ALL connected sessions including sender:
  ```json
  {
    "type": "remove",
    "seq": N,
    "node": "crate-01"
  }
  ```

**Broadcast helper:**
- `broadcast(sessions, message)` — sends JSON-stringified message to all
  sessions whose `ws.readyState === WebSocket.OPEN`

---

### 3. `packages/server/src/index.js` — updated

Load `space.gltf` on startup using `createWorld`, pass the world instance
into `createSessionServer`.

The path to `space.gltf` should be configurable via a `WORLD_PATH` environment
variable, defaulting to `./space.gltf`.

Log on startup:
```
Atrium world loaded: <worldName> (<N> nodes)
Atrium server listening on ws://localhost:3000
```

---

## Tests — `packages/server/test/world.test.js`

Use Node built-in test runner. Load the test fixture from
`../../../tests/fixtures/space.gltf` (relative to test file).

**Required test cases:**

1. **loads space.gltf and exposes world meta** — verify `world.meta.name === 'Test World'`
2. **finds a node by name** — `world.getNode('crate-01')` returns non-null
3. **returns null for unknown node** — `world.getNode('does-not-exist')` returns null
4. **sets translation on a node** — call `setField('crate-01', 'translation', [5, 0, 0])`,
   then verify `world.getNodeTranslation('crate-01')` returns `[5, 0, 0]`
5. **returns NODE_NOT_FOUND for unknown node** — `setField('ghost', 'translation', [0,0,0])`
   returns `{ ok: false, code: 'NODE_NOT_FOUND' }`
6. **returns INVALID_FIELD for unknown field** — `setField('crate-01', 'color', 'red')`
   returns `{ ok: false, code: 'INVALID_FIELD' }`
7. **adds a node** — call `addNode({ name: 'box-01', translation: [0, 1, 0] })`,
   verify `world.getNode('box-01')` returns non-null
8. **removes a node** — call `removeNode('crate-01')`,
   verify `world.getNode('crate-01')` returns null
9. **returns NODE_NOT_FOUND when removing unknown node**

Also add these integration tests to `packages/server/test/session.test.js`,
using the same test fixture loaded into a world instance passed to
`createSessionServer`:

10. **send message mutates world and broadcasts set** — complete handshake,
    send `{ type: 'send', seq: 1, node: 'crate-01', field: 'translation', value: [9, 0, 0] }`,
    verify client receives a `set` message with matching node/field/value
11. **send to unknown node returns NODE_NOT_FOUND error**
12. **add message broadcasts add to all clients** — connect two clients, both
    complete handshake, first client sends `add`, verify second client receives
    the broadcast `add` message
13. **remove message broadcasts remove to all clients** — connect two clients,
    first sends `remove` for `crate-01`, verify second receives `remove`

---

## Protocol Inspector Updates — `tools/protocol-inspector/index.html`

Update the message templates for world state message types:

**`send` template:**
```json
{
  "type": "send",
  "seq": 1,
  "node": "crate-01",
  "field": "translation",
  "value": [1.0, 0.0, 0.0]
}
```

**`add` template:**
```json
{
  "type": "add",
  "seq": 1,
  "format": "gltf",
  "parent": null,
  "node": {
    "name": "new-node",
    "translation": [0.0, 0.0, 0.0],
    "rotation": [0, 0, 0, 1]
  }
}
```

**`remove` template:**
```json
{
  "type": "remove",
  "seq": 1,
  "node": "crate-01"
}
```

Add a new scenario: **"Move crate"** — sends a hello handshake followed by a
`send` message moving `crate-01` to `[5, 0, 0]`. This scenario requires the
server to be running with `space.gltf` loaded.

---

## What NOT to Touch This Session

- `packages/protocol` — already complete, do not modify schemas or validator
- `packages/gltf-extension` — not this session
- `packages/client` — not this session
- `join`/`leave` — not this session
- Authority checking — not this session (all mutations accepted unconditionally)
- Physics — not this session
- Persistence / snapshotting — not this session

---

## When Done

1. Run `pnpm test` from `packages/server` — all tests must pass
2. Start the server: `WORLD_PATH=tests/fixtures/space.gltf node src/index.js`
3. Open `tools/protocol-inspector/index.html`
4. Connect, run the "Move crate" scenario
5. Verify the `set` broadcast is received back in the log
6. Open a second inspector tab, connect both, send `add` from one, verify
   the other receives the broadcast
7. Report any issues encountered
