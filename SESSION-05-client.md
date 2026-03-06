# Atrium — Claude Code Session 5
## World Client: glTF-Transform Document + Three.js Renderer

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
- `src/presence.js` — presence registry
- `src/tick.js` — per-session tick loop
- `src/index.js` — entry point, loads space.gltf via WORLD_PATH env var
- 60 passing tests

**`tools/protocol-inspector/index.html`** — single-file interactive protocol debugger
- Unique auto-generated client ID per tab
- Type dropdown with templates for all 11 SOP message types (note: this is a
  known issue — the dropdown currently exposes server-only types; see fix below)
- "Show tick messages" checkbox
- Message log with inbound/outbound entries, click-to-expand
- Scenarios: "Full handshake", "Clock sync", "Ping flood", "Move crate"

**`tests/fixtures/space.gltf`** — minimal test fixture
- Nodes: `crate-01` at `[1, 0, 0]`, `lamp-01` at `[3, 0, 0]`
- No geometry, no materials — just named nodes with translations

All packages use ES modules (`import`/`export`). No TypeScript. No build step.
Node.js v20. Test runner: `node --test`.

---

## Goal

Two deliverables this session:

1. **Upgrade `tests/fixtures/space.gltf`** — add real geometry and materials so
   there is something to render in the client viewport.

2. **`tests/client/index.html`** — a single-file world client. Left panel is the
   SOP messaging UI (evolved from the protocol inspector). Right panel is a
   Three.js viewport driven by a glTF-Transform Document synced with the server.

**The magic moment / acceptance test:**
- World client open in one browser tab
- Protocol inspector open in a second tab
- Both connected to the running server
- Send a `send` message from the inspector moving `crate-01`
- The crate moves in the world client viewport in real time — no reload, no
  manual DOM manipulation, just the Document mutation flowing through
  `DocumentView` into Three.js automatically

**Definition of done:** The magic moment works end-to-end.

---

## Coding Conventions

- Single-file HTML — all JS inline in `<script type="module">`, all CSS inline
  in `<style>`. No external files, no build step.
- Imports via `esm.sh` CDN only — see pinned versions below.
- ES modules throughout. No CommonJS, no global `var`.
- No TypeScript.
- File header comment (inside the `<script>` block):
  ```
  // SPDX-License-Identifier: MIT
  // Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
  ```

---

## Part 1 — Upgrade `tests/fixtures/space.gltf`

Replace the existing minimal fixture with a version that has real geometry and
materials. Keep the same node names and base translations so all 60 existing
server tests continue to pass without modification.

**New scene contents:**

**`ground-plane`** — a flat box mesh, 10 × 0.05 × 10 units, centered at the
origin, sitting at y = 0. Material: matte mid-grey (`[0.5, 0.5, 0.5]`).

**`crate-01`** — a box mesh, 0.5 × 0.5 × 0.5 units, translation `[1, 0.25, 0]`
(sitting on the ground plane). Material: warm orange-brown (`[0.6, 0.35, 0.1]`).

**`lamp-01`** — a parent node at `[3, 0, 0]` with two children:
- `lamp-stand` — a tall thin cylinder, radius 0.05, height 1.5, centered at
  `[0, 0.75, 0]` relative to parent. Material: dark grey (`[0.2, 0.2, 0.2]`).
- `lamp-shade` — a cone (represented as a cylinder with top radius 0 and bottom
  radius 0.3, height 0.4), centered at `[0, 1.6, 0]` relative to parent.
  Material: warm cream (`[0.9, 0.85, 0.6]`).

**glTF encoding notes:**
- All geometry encoded as inline `buffers` (base64 `data:` URI) — no external
  `.bin` files. The fixture must be fully self-contained as a single `.gltf` file.
- Use `PBR metallic-roughness` materials with `baseColorFactor`, `metallicFactor: 0`,
  `roughnessFactor: 1.0` for all meshes.
- Cylinder and cone geometry: generate as proper indexed triangle meshes with
  `POSITION` and `NORMAL` accessors. Use 16 radial segments minimum.
- The `extras.atrium` world metadata on the root must be preserved exactly as it
  is in the current fixture.
- All existing node names (`crate-01`, `lamp-01`) must be preserved. The new
  child nodes (`lamp-stand`, `lamp-shade`, `ground-plane`) are additions.

**Generating the geometry:**
Write a one-off Node.js script `tests/fixtures/generate-space.js` that:
- Uses `@gltf-transform/core` (already installed) to build the Document
  programmatically
- Creates all geometry, accessors, materials in code
- Writes the result to `tests/fixtures/space.gltf` using `NodeIO`

Run the script once to generate the fixture, then commit the output. The script
is the source of truth — the `.gltf` is the generated artifact.

---

## Part 2 — `tests/client/index.html`

### CDN Imports — Pinned Versions

Use `esm.sh` with explicit version pins and shared dependency resolution:

```javascript
// Three.js — use a consistent version throughout
import * as THREE from 'https://esm.sh/three@0.163.0'
import { OrbitControls } from 'https://esm.sh/three@0.163.0/addons/controls/OrbitControls.js'

// glTF-Transform — core + view, pinned to same version, sharing three
import { WebIO } from 'https://esm.sh/@gltf-transform/core@4.1.0'
import { KHRONOS_EXTENSIONS } from 'https://esm.sh/@gltf-transform/extensions@4.1.0'
import { DocumentView } from 'https://esm.sh/@gltf-transform/view@4.1.0?deps=three@0.163.0'
```

The `?deps=three@0.163.0` parameter on the `@gltf-transform/view` import is
**critical** — it forces `esm.sh` to resolve Three.js to the same instance as
the top-level import. Without this, `instanceof` checks break and
`DocumentView` cannot attach to the scene. If `esm.sh` version resolution
fails at runtime, try appending `&bundle` to force inlining.

**Fallback note:** If `DocumentView` fails to wire up correctly despite the
above, the fallback is: load the scene with `WebIO`, apply mutations to the
Document manually, then re-export with `WebIO.writeJSON()` and reload via
`THREE.GLTFLoader`. This is explicitly the fallback of last resort — the
primary path must be attempted first.

---

### Layout

Two-column layout, full viewport height, no scroll.

```
┌──────────────────────────────────────────────────────────────────┐
│ ATRIUM  [ws://localhost:3000]  [Connect] [Disconnect]  ● Connected│
├───────────────────────┬──────────────────────────────────────────┤
│ Send Message          │                                          │
│                       │                                          │
│ Type [send        ▾]  │         Three.js viewport                │
│                       │         (orbit controls)                 │
│ {                     │                                          │
│   "type": "send",     │                                          │
│   "node": "crate-01", │                                          │
│   ...                 │                                          │
│ }                     │                                          │
│                       │                                          │
│ [Send]  [Reset]       ├──────────────────────────────────────────┤
├───────────────────────┤ Message Log                              │
│                       │ [x] Show tick messages  [Clear]          │
│                       │                                          │
│                       │ 14:23:01 → hello                         │
│                       │ 14:23:01 ← hello  id:server-abc          │
│                       │ 14:23:02 ← set  crate-01.translation     │
│                       │                                          │
└───────────────────────┴──────────────────────────────────────────┘
```

The left column is fixed width (~360px). The right column fills remaining space
and is split vertically: viewport on top (fills available height), log on bottom
(~200px fixed height, scrollable).

---

### Left Panel — SOP Messaging

Evolved from `tools/protocol-inspector/index.html`. Carry over:
- Auto-generated client UUID on page load (`crypto.randomUUID()`) — stable for
  page lifetime, used in the `hello` template
- JSON editor textarea pre-filled from templates on type select
- [Send] button — parse-validates JSON before sending, shows inline error if invalid
- [Reset] — resets editor to current type's template

**Client-only type dropdown — important:**
The type dropdown must only surface message types that a client is permitted to
send. The SOP protocol has a strict client/server direction split. The
`validate(direction, message)` function in `@atrium/protocol` encodes this:
`'client'` direction = sendable by a client, `'server'` direction = sent only
by the server.

The dropdown must contain **only these 5 types**:
- `hello`
- `ping`
- `send`
- `add`
- `remove`

Server-only types — `pong`, `tick`, `set`, `join`, `leave`, `error` — must
**not** appear in the dropdown. Exposing them causes operator errors (e.g.
attempting to send a `leave` from the client, which the server will reject as
an `UNKNOWN_MESSAGE`).

This rule applies equally to both UIs built this session:
`tests/client/index.html` and `tools/protocol-inspector/index.html`.

Message templates — same as the inspector, with these two updated:

**`hello` template** (auto-fills generated UUID):
```json
{
  "type": "hello",
  "id": "<generated-uuid>",
  "capabilities": { "tick": { "interval": 1000 } }
}
```

**`send` template**:
```json
{
  "type": "send",
  "seq": 1,
  "node": "crate-01",
  "field": "translation",
  "value": [2.0, 0.25, 0.0]
}
```

---

### Right Panel — Message Log

- Scrollable log, newest entries at bottom
- Each entry: timestamp, direction arrow (→ outbound, ← inbound), type, key
  fields inline (e.g. `← set  crate-01.translation  [2,0.25,0]`)
- Click to expand full JSON
- Inbound entries: left-aligned, muted blue tint
- Outbound entries: right-aligned, muted green tint
- "Show tick messages" checkbox — checked by default, hides/shows tick entries
  in real time (filter on display only, ticks still stored internally)
- [Clear] button

---

### Right Panel — Three.js Viewport

**Setup:**
- `THREE.WebGLRenderer` filling the panel, `antialias: true`
- `THREE.PerspectiveCamera` at `[0, 2, 6]` looking at `[0, 0.5, 0]`
- `OrbitControls` attached to the camera
- `THREE.AmbientLight` at intensity 0.4
- `THREE.DirectionalLight` at `[5, 10, 5]`, intensity 1.0, casting shadows
- `renderer.shadowMap.enabled = true`
- Resize observer on the panel — renderer and camera aspect update on resize

**Scene loading:**

On successful `hello` handshake (i.e. when the server `hello` response is
received), load `space.gltf` from a configurable URL. Default path:
`../../tests/fixtures/space.gltf` (relative to `tests/client/`). The path
should be settable via a field in the UI or a JS constant at the top of the
file named `WORLD_GLTF_PATH`.

Loading sequence:
```javascript
const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
const document = await io.read(WORLD_GLTF_PATH)
const documentView = new DocumentView(document)
const sceneDef = document.getRoot().getDefaultScene()
const group = documentView.view(sceneDef)
threeScene.add(group)
```

The `document` and `documentView` instances are stored in module-level
variables so SOP message handlers can access them.

**SOP → Document mutations:**

When a `set` message arrives from the server, apply it to the local Document:

```javascript
function applySet(msg) {
  // msg: { type: 'set', node: string, field: string, value: any }
  const node = document.getRoot().listNodes()
    .find(n => n.getName() === msg.node)
  if (!node) return
  switch (msg.field) {
    case 'translation': node.setTranslation(msg.value); break
    case 'rotation':    node.setRotation(msg.value);    break
    case 'scale':       node.setScale(msg.value);       break
    case 'extras':      node.setExtras(msg.value);      break
  }
  // DocumentView picks up the change automatically — no further action needed
}
```

When an `add` message arrives:
```javascript
function applyAdd(msg) {
  // msg: { type: 'add', node: { name, translation?, rotation?, scale?, extras? }, parent? }
  const newNode = document.createNode(msg.node.name)
  if (msg.node.translation) newNode.setTranslation(msg.node.translation)
  if (msg.node.rotation)    newNode.setRotation(msg.node.rotation)
  if (msg.node.scale)       newNode.setScale(msg.node.scale)
  if (msg.node.extras)      newNode.setExtras(msg.node.extras)
  if (msg.parent) {
    const parent = document.getRoot().listNodes().find(n => n.getName() === msg.parent)
    if (parent) parent.addChild(newNode)
  } else {
    document.getRoot().getDefaultScene().addChild(newNode)
  }
}
```

When a `remove` message arrives:
```javascript
function applyRemove(msg) {
  // msg: { type: 'remove', node: string }
  const node = document.getRoot().listNodes().find(n => n.getName() === msg.node)
  if (node) node.dispose()
}
```

**Message dispatch — the full inbound handler:**

```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  logMessage('inbound', msg)
  switch (msg.type) {
    case 'hello':  onServerHello(msg);  break
    case 'set':    applySet(msg);       break
    case 'add':    applyAdd(msg);       break
    case 'remove': applyRemove(msg);    break
    case 'join':   onJoin(msg);         break
    case 'leave':  onLeave(msg);        break
    case 'tick':   /* handled by log */ break
    case 'error':  onError(msg);        break
  }
}
```

**`onServerHello`**: triggers `space.gltf` load as described above, updates
connection status indicator to "Connected".

**`onJoin` / `onLeave`**: log the event (e.g. "peer abc123 joined / left"),
no visual representation of other avatars this session.

**`onError`**: log the error message visibly in the log panel with a red tint.

**Graceful degradation**: if the WebSocket is unreachable or the `hello`
handshake fails, the viewport should still render `space.gltf` if it can
be loaded directly (static mode). The connection status shows "Offline".
This is the "browser model" principle — static first, multiplayer second.

---

### Connection Flow

1. Page loads → viewport initializes with empty scene + grid helper for context
2. User clicks [Connect] → WebSocket opens to the server URL field value
3. Client immediately sends `hello` (using the template from the send panel,
   or auto-sent — **auto-send the hello** on connect so the user doesn't have
   to manually trigger it)
4. Server responds with `hello` → client loads `space.gltf`, populates viewport
5. Server sends `tick` messages → filtered per checkbox
6. User or remote peer sends mutations → Document updates → Three.js updates

The server URL field should default to `ws://localhost:3000`.

---

### Visual Design

- Dark theme: background `#1a1a1a`, panels `#242424`, log `#1e1e1e`
- Monospace font for JSON editor and log entries
- Left panel: subtle right border separator
- Status indicator: filled circle, green = connected, yellow = connecting,
  red = disconnected/error
- Viewport background: `#2a2a2a` (dark grey, not pure black)
- Keep it clean and tool-like — this is a developer tool, not a game UI

---

### What the File Serves From

`tests/client/index.html` is opened directly in a browser, served from the
filesystem or from a simple HTTP server. The `space.gltf` path is relative.
The simplest dev workflow:

```bash
# from repo root
cd tests
npx serve .
# open http://localhost:3000/client/index.html
# server running on ws://localhost:3000 simultaneously — use a different port
```

**Port conflict note:** The Atrium server runs on port 3000 by default. If
serving `tests/` via HTTP on the same machine, use a different port for the
HTTP server (e.g. `npx serve -l 5173 .`). The WebSocket URL field in the
client defaults to `ws://localhost:3000` regardless.

---

## What NOT to Touch This Session

- `packages/protocol` — do not modify schemas or validator
- `packages/server` — do not modify any server code
- `tools/protocol-inspector/index.html` — **one targeted fix only**: restrict
  the type dropdown to the 5 client-sendable types (hello, ping, send, add,
  remove). No other changes to the inspector.
- Avatar embodiment — not this session (join/leave logged only, no visual)
- Physics — not this session
- Persistence — not this session
- `packages/client` scaffold — not this session (the client lives in
  `tests/client/` for now, promoted to `packages/client` in a future session)

---

## When Done

1. Run `pnpm test` from `packages/server` — all 60 tests must still pass
   (the upgraded `space.gltf` must not break any existing test)
2. Start the server:
   ```bash
   WORLD_PATH=tests/fixtures/space.gltf node packages/server/src/index.js
   ```
3. Serve the tests directory:
   ```bash
   npx serve -l 5173 tests/
   ```
4. Open `http://localhost:5173/client/index.html` in a browser tab
5. Click [Connect] — verify the hello handshake completes and `space.gltf`
   loads: ground plane, crate, and lamp visible in the viewport
6. Open `tools/protocol-inspector/index.html` in a second tab, connect to
   `ws://localhost:3000`
7. **The magic moment:** from the inspector, send:
   ```json
   {
     "type": "send",
     "seq": 1,
     "node": "crate-01",
     "field": "translation",
     "value": [4.0, 0.25, 0.0]
   }
   ```
8. Verify the crate moves in the world client viewport in real time
9. Send a `remove` for `crate-01` from the inspector — verify it disappears
   from the viewport
10. Report any issues encountered, especially around `DocumentView` CDN
    peer dependency resolution

---

## Session Log

To be filled in by Claude Code after the session.
